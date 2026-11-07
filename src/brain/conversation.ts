import { randomInt, randomUUID } from "node:crypto";
import { config, type Config } from "../config.ts";
import { logEvent, type Db } from "../db.ts";
import { matchEntity } from "../lib/entities.ts";
import { redactForLog, scanUtterance } from "../lib/lexicon.ts";
import { indianMobile } from "../lib/phone.ts";
import { admitCaller, applyMisusePolicy, complaintsToday, findDuplicateComplaint, type AdmissionDecision, type FlagReason } from "../policy.ts";
import { analyzeTurn, llmAvailable } from "./llm.ts";
import type { TurnAnalysis, TurnInput } from "./prompt.ts";
import { FIELD_KEYS, PHONE_OPTIONAL_ASK, cleanFieldValue, emptyFields, missingRequired, type FieldKey, type Fields } from "./fields.ts";
import { decideLanguage, heuristicAnalyze, isAffirmative, isDone } from "./heuristic.ts";
import * as M from "./messages.ts";
import type { Lang } from "./messages.ts";
import { mirrorToWebApp } from "../webapp.ts";

type Need = FieldKey | "mobile_confirm" | "entity_confirm" | "optional_details";

export interface CallState {
  lang: Lang;
  phase: "collecting" | "confirming" | "wrap_up" | "done";
  /** References of complaints registered on this call (a caller may file more than one). */
  filedRefs?: string[];
  fields: Fields;
  callerIdMobile: string | null;
  mobileConfirmed: boolean;
  entity: { verified: boolean; unverifiedAccepted: boolean; attempts: number; candidate: string | null };
  optionalAsked: boolean;
  lastNeed: Need | null;
  strikes: { offTopic: number; abuse: number; silence: number };
  history: { role: "agent" | "caller"; text: string; cls?: string }[];
  ended: boolean;
  endReason?: string;
  lastTurnAt?: number;
  /** How many closing lines were spoken after the call ended (the platform may not hang up at once). */
  closingsAfterEnd?: number;
}

export interface CallRow {
  id: string;
  phone: string | null;
  started_at: number;
  status: string;
  turns: number;
  flagged: number;
  complaint_id: string | null;
  state: string;
}

export interface TurnResult {
  reply: string;
  endCall: boolean;
  lang: Lang;
}

const QUESTIONS: Record<Exclude<Need, "entity_confirm">, Record<Lang, string>> = {
  complaint_description: { en: "Could you please tell me briefly what happened?", hi: "कृपया संक्षेप में बताइए, क्या हुआ था?" },
  registered_entity_name: {
    en: "Thank you. Which broker, mutual fund or company is your complaint against?",
    hi: "धन्यवाद। आपकी शिकायत किस broker, mutual fund या company के खिलाफ़ है?",
  },
  complainant_name: { en: "Thank you. May I have your full name, please?", hi: "धन्यवाद। कृपया अपना पूरा नाम बताइए।" },
  mobile_number: { en: "Could you please tell me your 10-digit mobile number?", hi: "कृपया अपना 10 अंकों का मोबाइल नंबर बताइए।" },
  mobile_confirm: {
    en: "Thank you. Is the number you're calling from the best number to reach you?",
    hi: "धन्यवाद। क्या जिस नंबर से आप कॉल कर रहे हैं, उसी पर आपसे संपर्क किया जाए?",
  },
  optional_details: {
    en: "Roughly when did this happen, how much money is involved, and have you already complained to the firm? You can skip any of these.",
    hi: "यह लगभग कब हुआ, कितनी राशि का मामला है, और क्या आपने पहले company से शिकायत की है? चाहें तो छोड़ भी सकते हैं।",
  },
  // Not asked on the phone, but keep the map total.
  complainant_address: { en: "", hi: "" },
  email: { en: "", hi: "" },
  pan: { en: "", hi: "" },
  date_of_birth: { en: "", hi: "" },
  complaint_category: { en: "", hi: "" },
  complaint_nature: { en: "", hi: "" },
  date_of_issue: { en: "", hi: "" },
  amount_involved: { en: "", hi: "" },
  prior_complaint_to_entity: { en: "", hi: "" },
  reference_numbers: { en: "", hi: "" },
  supporting_documents_mentioned: { en: "", hi: "" },
};

function newState(callerIdMobile: string | null): CallState {
  return {
    lang: "en",
    phase: "collecting",
    fields: emptyFields(),
    callerIdMobile,
    mobileConfirmed: false,
    entity: { verified: false, unverifiedAccepted: false, attempts: 0, candidate: null },
    optionalAsked: false,
    lastNeed: null,
    strikes: { offTopic: 0, abuse: 0, silence: 0 },
    history: [],
    ended: false,
  };
}

// ---------------------------------------------------------------- call lifecycle

export interface StartCallResult {
  callId: string;
  decision: AdmissionDecision;
}

/** Records the attempt and runs admission. Idempotent per (provider, providerCallId). */
export function startCall(
  db: Db,
  p: { provider: string; providerCallId: string | null; phone: string | null; now?: number; cfg?: Config },
): StartCallResult {
  const now = p.now ?? Date.now();
  if (p.providerCallId) {
    const existing = db
      .prepare("SELECT id, admitted, reject_reason FROM calls WHERE provider = ? AND provider_call_id = ?")
      .get(p.provider, p.providerCallId) as { id: string; admitted: number; reject_reason: string | null } | undefined;
    if (existing) {
      return {
        callId: existing.id,
        decision: existing.admitted
          ? { admitted: true, reason: "ok" }
          : { admitted: false, reason: (existing.reject_reason ?? "blocked") as Exclude<AdmissionDecision, { admitted: true }>["reason"] },
      };
    }
  }
  const decision = admitCaller(db, p.phone, { now, cfg: p.cfg });
  const callId = randomUUID();
  db.prepare(
    `INSERT INTO calls (id, provider, provider_call_id, phone, started_at, admitted, reject_reason, status, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    callId,
    p.provider,
    p.providerCallId,
    p.phone,
    now,
    decision.admitted ? 1 : 0,
    decision.admitted ? null : decision.reason,
    decision.admitted ? "active" : "rejected",
    JSON.stringify(newState(indianMobile(p.phone))),
  );
  logEvent(db, { callId, phone: p.phone, type: decision.admitted ? "call_admitted" : "call_rejected", detail: decision });
  return { callId, decision };
}

export function getCall(db: Db, callId: string): CallRow | undefined {
  return db.prepare("SELECT id, phone, started_at, status, turns, flagged, complaint_id, state FROM calls WHERE id = ?").get(callId) as
    | CallRow
    | undefined;
}

function saveState(db: Db, callId: string, state: CallState, extra: { turnsDelta?: number } = {}) {
  db.prepare("UPDATE calls SET state = ?, turns = turns + ? WHERE id = ?").run(JSON.stringify(state), extra.turnsDelta ?? 0, callId);
}

function endCall(
  db: Db,
  call: CallRow,
  state: CallState,
  reason: string,
  flag: FlagReason | null,
  cfg: Config,
  now: number,
): void {
  state.ended = true;
  state.phase = "done";
  state.endReason = reason;
  const status = flag ? "ended_by_guardrail" : "completed";
  db.prepare("UPDATE calls SET status = ?, flagged = ?, flag_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(
    status,
    flag ? 1 : 0,
    flag,
    now,
    call.id,
  );
  logEvent(db, { callId: call.id, phone: call.phone, type: "call_ended_by_agent", detail: { reason, flag } });
  // Apply the misuse policy immediately, so the next call is screened even if the provider's
  // end-of-call webhook is late or never arrives.
  if (flag && call.phone) {
    const res = applyMisusePolicy(db, call.phone, flag, { now, cfg });
    if (res.blocked) logEvent(db, { callId: call.id, phone: call.phone, type: "auto_block", detail: res });
  }
}

/**
 * Undo a turn whose HTTP request the voice platform cancelled (the caller kept talking, so the
 * reply was never spoken). The platform re-sends the words with the next request.
 * Turns that ended the call (complaint filed, guardrail hang-up) are kept.
 */
export function discardCancelledTurn(db: Db, callId: string, before: CallRow) {
  const now = getCall(db, callId);
  if (!now || now.status !== "active") return false;
  db.prepare("UPDATE calls SET state = ?, turns = ? WHERE id = ?").run(before.state, before.turns, callId);
  logEvent(db, { callId, phone: now.phone, type: "turn_cancelled_by_platform" });
  return true;
}

/** Called from the provider's end-of-call webhook. */
export function finalizeCall(db: Db, callId: string, p: { durationSec?: number | null; providerStatus?: string; now?: number }) {
  const call = getCall(db, callId);
  if (!call) return;
  const now = p.now ?? Date.now();
  const status = call.status === "active" ? (call.complaint_id ? "completed" : "abandoned") : call.status;
  db.prepare("UPDATE calls SET status = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(status, now, callId);
  logEvent(db, { callId, phone: call.phone, type: "call_finalized", detail: p });
}

// ---------------------------------------------------------------- turn handling

function nextNeed(s: CallState): Need | null {
  const f = s.fields;
  if (!f.complaint_description) return "complaint_description";
  if (!f.registered_entity_name) return "registered_entity_name";
  if (!s.entity.verified && !s.entity.unverifiedAccepted && s.entity.candidate) return "entity_confirm";
  if (!f.complainant_name) return "complainant_name";
  if (!f.mobile_number) return s.callerIdMobile && !s.mobileConfirmed ? "mobile_confirm" : "mobile_number";
  if (!s.optionalAsked && PHONE_OPTIONAL_ASK.some((k) => !f[k])) return "optional_details";
  return null;
}

function stillNeeded(s: CallState): Need[] {
  const out: Need[] = [];
  const f = s.fields;
  if (!f.complaint_description) out.push("complaint_description");
  if (!f.registered_entity_name) out.push("registered_entity_name");
  if (!f.complainant_name) out.push("complainant_name");
  if (!f.mobile_number) out.push(s.callerIdMobile ? "mobile_confirm" : "mobile_number");
  if (!s.optionalAsked) out.push("optional_details");
  return out;
}

const OPTIONAL_PARTS: Record<"date_of_issue" | "amount_involved" | "prior_complaint_to_entity", Record<Lang, string>> = {
  date_of_issue: { en: "roughly when this happened", hi: "यह लगभग कब हुआ" },
  amount_involved: { en: "how much money is involved", hi: "कितनी राशि का मामला है" },
  prior_complaint_to_entity: { en: "whether you have already complained to the firm", hi: "क्या आपने पहले company से शिकायत की है" },
};

/** Ask only for the optional details the caller has not already given. */
function optionalQuestion(s: CallState): string {
  const parts = (Object.keys(OPTIONAL_PARTS) as (keyof typeof OPTIONAL_PARTS)[]).filter((k) => !s.fields[k]).map((k) => OPTIONAL_PARTS[k][s.lang]);
  if (parts.length === 3) return QUESTIONS.optional_details[s.lang];
  if (s.lang === "hi") return `${parts.join(", और ")}? चाहें तो छोड़ भी सकते हैं।`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Could you also tell me ${list}? You can skip this.`;
}

function question(need: Need, s: CallState): string {
  if (need === "entity_confirm") return M.entityConfirm(s.lang, s.entity.candidate ?? s.fields.registered_entity_name ?? "");
  if (need === "optional_details") return optionalQuestion(s);
  return QUESTIONS[need][s.lang];
}

/** Resolve a freshly heard entity name against the registry. Returns a reply override if needed. */
function resolveEntity(s: CallState, spoken: string): string | null {
  const m = matchEntity(spoken);
  if (m && m.score >= 0.8) {
    s.fields.registered_entity_name = m.entity.name;
    s.fields.complaint_category ??= m.entity.category;
    s.entity = { ...s.entity, verified: true, candidate: null };
    return null;
  }
  if (m && m.score >= 0.6) {
    s.fields.registered_entity_name = m.entity.name;
    s.fields.complaint_category ??= m.entity.category;
    s.entity = { ...s.entity, verified: false, candidate: m.entity.name };
    return null; // nextNeed() will ask entity_confirm
  }
  s.entity.attempts += 1;
  if (s.entity.attempts >= 2) {
    // SEBI regulates far more entities than our demo registry; accept, but mark unverified.
    s.fields.registered_entity_name = spoken;
    s.entity = { ...s.entity, unverifiedAccepted: true, candidate: null };
    return null;
  }
  s.fields.registered_entity_name = null;
  return M.entityNotRecognised(s.lang, spoken);
}

const DEVANAGARI = /[\u0900-\u097F]/;
// Only the server registers complaints and ends calls; a model reply must never claim either.
const FALSE_CLAIM = /registered|reference number|complaint (is|has been) (filed|lodged)|दर्ज (हो|कर) (गई|दी|दिया|लिया)|शिकायत दर्ज हो|रेफरेंस|समाप्त/i;

/** Model replies are used only if they are speakable in the call language and make no false claims. */
function usableModelReply(reply: string, lang: Lang): boolean {
  const r = reply.trim();
  if (!r || M.hasEndMarker(r) || FALSE_CLAIM.test(r)) return false;
  if (r.split(/\s+/).length > 45) return false;
  // Sarvam's Hindi voice reads Devanagari well and Roman-script Hindi badly.
  if (lang === "hi" && !DEVANAGARI.test(r)) return false;
  if (lang === "en" && DEVANAGARI.test(r)) return false;
  return true;
}

/**
 * Bolna re-sends earlier caller fragments when the caller speaks in pieces (barge-in), e.g.
 * "yes so" then "yes so maine axis finance...". Keep only what is new since the last caller turn.
 */
function newWords(utterance: string, s: CallState): string {
  const prev = [...s.history].reverse().find((h) => h.role === "caller")?.text;
  if (!prev) return utterance;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const u = norm(utterance);
  const p = norm(prev);
  if (u.length > p.length && u.startsWith(p)) return u.slice(p.length).trim();
  return utterance;
}

/** TTS reads "9861110080" as one big number; say long digit runs one digit at a time. */
function speakable(text: string): string {
  return text.replace(/\d{6,}/g, (d) => d.split("").join(" "));
}

/** Clears the complaint details for a second complaint on the same call; keeps who the caller is. */
function startNextComplaint(s: CallState) {
  const keep: FieldKey[] = ["complainant_name", "mobile_number", "email", "pan", "date_of_birth", "complainant_address"];
  const fresh = emptyFields();
  for (const k of keep) fresh[k] = s.fields[k];
  s.fields = fresh;
  s.entity = { verified: false, unverifiedAccepted: false, attempts: 0, candidate: null };
  s.optionalAsked = false;
  s.lastNeed = null;
  s.phase = "collecting";
}

function complaintRef(): string {
  return `SWR-${randomInt(100000, 1000000)}`;
}

async function analyze(input: TurnInput): Promise<TurnAnalysis> {
  if (!llmAvailable()) return heuristicAnalyze(input);
  try {
    return await analyzeTurn(input);
  } catch (err) {
    console.error("[analyze] LLM failed, using heuristic:", (err as Error).message);
    return heuristicAnalyze(input);
  }
}

export async function handleTurn(
  db: Db,
  callId: string,
  rawUtterance: string,
  opts: { now?: number; cfg?: Config } = {},
): Promise<TurnResult> {
  const cfg = opts.cfg ?? config;
  const now = opts.now ?? Date.now();
  const call = getCall(db, callId);
  if (!call) return { reply: M.lines.alreadyEnded.en, endCall: true, lang: "en" };
  const s = JSON.parse(call.state) as CallState;

  const say = (text: string, endCall = false): TurnResult => {
    s.history.push({ role: "agent", text });
    saveState(db, callId, s);
    return { reply: text, endCall, lang: s.lang };
  };
  const end = (text: string, reason: string, flag: FlagReason | null): TurnResult => {
    endCall(db, call, s, reason, flag, cfg, now);
    return say(text, true);
  };

  // After the goodbye the platform may keep the line open for a moment. "Thanks", "ok", "bye" get one
  // short line, never the full goodbye again. A caller who clearly asks for more help ("I have one more
  // complaint") gets the call back, unless a guardrail, the time limit or the daily limit ended it.
  const SOFT_ENDS = ["caller_stopped", "caller_done", "silence"];
  const after = newWords(rawUtterance.trim(), s);
  const wantsMore = after.split(/\s+/).filter(Boolean).length >= 3 && !isDone(after);
  if (s.ended && !(wantsMore && !call.flagged && SOFT_ENDS.includes(s.endReason ?? ""))) {
    const first = !s.closingsAfterEnd && !SOFT_ENDS.includes(s.endReason ?? "");
    s.closingsAfterEnd = (s.closingsAfterEnd ?? 0) + 1;
    if (after) s.history.push({ role: "caller", text: after });
    const line = first ? M.lines.alreadyEnded[s.lang] : M.lines.shortBye[s.lang];
    s.history.push({ role: "agent", text: line });
    saveState(db, callId, s);
    return { reply: line, endCall: true, lang: s.lang };
  }
  if (s.ended) {
    s.ended = false;
    s.phase = s.filedRefs?.length ? "wrap_up" : "collecting";
    s.endReason = undefined;
    s.closingsAfterEnd = 0;
    db.prepare("UPDATE calls SET status = 'active', ended_at = NULL WHERE id = ?").run(call.id);
    call.status = "active";
    logEvent(db, { callId, phone: call.phone, type: "call_reopened" });
  }
  if (s.ended || call.status !== "active") return { reply: M.lines.alreadyEnded[s.lang], endCall: true, lang: s.lang };

  // ---- hard limits
  if (now - call.started_at > cfg.maxCallSeconds * 1000 || call.turns >= cfg.maxTurns) {
    return end(M.lines.timeLimit[s.lang], "time_or_turn_limit", null);
  }

  const utterance = newWords(rawUtterance.trim(), s).slice(0, cfg.maxUtteranceChars);
  // Voice platforms re-send a turn within seconds after barge-in/retries; answer it again without
  // re-counting strikes. The window is short so a caller repeating themselves still gets strikes.
  const [prevCaller, prevAgent] = s.history.slice(-2);
  if (utterance && prevCaller?.role === "caller" && prevCaller.text === utterance && prevAgent?.role === "agent" && now - (s.lastTurnAt ?? 0) < 6_000) {
    return { reply: prevAgent.text, endCall: false, lang: s.lang };
  }
  s.lastTurnAt = now;
  saveState(db, callId, s, { turnsDelta: 1 });
  if (!utterance) {
    s.strikes.silence += 1;
    if (s.strikes.silence >= 3) return end(M.lines.callerStopped[s.lang], "silence", null);
    return say(M.lines.didNotHear[s.lang]);
  }
  s.strikes.silence = 0;
  s.history.push({ role: "caller", text: utterance });
  logEvent(db, { callId, phone: call.phone, type: "caller_turn", detail: redactForLog(utterance) });

  // ---- language: stable for the call, decided from the caller's own words
  const firstCallerTurn = s.history.filter((h) => h.role === "caller").length === 1;
  const langNow = decideLanguage(s.lang, utterance, firstCallerTurn);
  if (langNow) s.lang = langNow;

  // ---- after a complaint is registered: another complaint, or goodbye
  if (s.phase === "wrap_up") {
    const words = utterance.split(/\s+/).length;
    const yes = isAffirmative(utterance);
    if (words <= 6 && (yes === false || (isDone(utterance) && yes !== true))) {
      return end(M.goodbye(s.lang, s.filedRefs ?? []), "caller_done", null);
    }
    const asksForAnother =
      /\b(one more|another|other|second|ek aur|aur ek|dusri|doosri|ek or)\b.{0,20}\b(complaint|complain|shikayat|issue|problem)\b|(एक और|और एक|दूसरी).{0,12}(शिकायत|complaint)/i.test(utterance);
    if (asksForAnother && words <= 8) {
      startNextComplaint(s);
      return say(M.lines.anotherComplaint[s.lang]);
    }
    if (words <= 3) {
      if (yes === true) {
        startNextComplaint(s);
        return say(M.lines.anotherComplaint[s.lang]);
      }
      return say(M.lines.anythingElse[s.lang]);
    }
    startNextComplaint(s); // the caller went straight into the next complaint: process these words as its start
  }

  // ---- deterministic pre-filter
  const hit = scanUtterance(utterance);
  if (hit?.kind === "threat") return end(M.lines.threatEnd[s.lang], "threat", "threat");

  const needBefore = nextNeed(s);
  let analysis: TurnAnalysis;
  if (hit?.kind === "injection") {
    analysis = { ...heuristicAnalyze({ phase: "collecting", nextNeeded: "", stillNeeded: [], fields: s.fields, callerIdMobile: null, recent: [], utterance }), classification: "manipulation", classification_reason: `lexicon: ${hit.match}` };
  } else {
    analysis = await analyze({
      phase: s.phase === "confirming" ? "confirming" : "collecting",
      nextNeeded: needBefore ?? (s.phase === "confirming" ? "read_back_confirmation" : "nothing"),
      stillNeeded: stillNeeded(s),
      fields: s.fields,
      callerIdMobile: s.callerIdMobile,
      recent: s.history.slice(-9, -1),
      utterance,
      lexiconHint: hit?.kind === "profanity" ? `utterance contains profanity ("${hit.match}")` : undefined,
    });
  }
  // The model's guess is used only when the first turn's words were too few to tell.
  if (firstCallerTurn && !langNow) s.lang = analysis.language;
  const cls = hit?.kind === "profanity" ? "abusive" : analysis.classification;
  s.history[s.history.length - 1].cls = cls;
  logEvent(db, { callId, phone: call.phone, type: "turn_classified", detail: { cls, reason: analysis.classification_reason } });

  // A caller who asks to end the call gets a polite goodbye, never a misuse strike.
  if (analysis.caller_wants_to_stop && cls !== "threat" && cls !== "abusive" && s.phase !== "confirming") {
    return s.filedRefs?.length
      ? end(M.goodbye(s.lang, s.filedRefs), "caller_done", null)
      : end(M.lines.callerStopped[s.lang], "caller_stopped", null);
  }

  // ---- misuse handling
  let prefix = "";
  switch (cls) {
    case "threat":
      return end(M.lines.threatEnd[s.lang], "threat", "threat");
    case "abusive":
      s.strikes.abuse += 1;
      if (s.strikes.abuse >= cfg.abuseStrikesToEnd) return end(M.lines.abuseEnd[s.lang], "abuse", "abusive_language");
      // An angry but genuine caller may swear while giving details: keep the details.
      if (analysis.classification !== "on_topic") return say(M.lines.abuseWarning[s.lang]);
      prefix = M.lines.abuseWarning[s.lang] + " ";
      break;
    case "manipulation":
    case "off_topic":
    case "gibberish_or_prank": {
      s.strikes.offTopic += 1;
      const flag: FlagReason = cls === "manipulation" ? "manipulation_attempt" : "off_topic_or_prank";
      if (s.strikes.offTopic >= cfg.offTopicStrikesToEnd) return end(M.lines.offTopicEnd[s.lang], cls, flag);
      if (s.strikes.offTopic > cfg.offTopicStrikesToWarn) return say(M.lines.offTopicFinalWarning[s.lang]);
      return say(cls === "manipulation" ? M.lines.manipulationRedirect[s.lang] : M.lines.offTopicRedirect[s.lang]);
    }
    case "distress":
      return say(M.lines.distress[s.lang]);
  }

  if (analysis.caller_wants_to_stop && s.phase !== "confirming") return end(M.lines.callerStopped[s.lang], "caller_stopped", null);

  // ---- apply extracted details
  const yesNo = analysis.read_back_response !== "not_applicable" ? analysis.read_back_response === "confirmed" : isAffirmative(utterance);
  let override: string | null = null;
  let entityChanged = false;
  for (const key of FIELD_KEYS) {
    const v = cleanFieldValue(key, analysis.updates[key]);
    if (v === null) continue;
    if (key === "registered_entity_name") {
      if (v !== s.fields.registered_entity_name) entityChanged = true;
      continue;
    }
    s.fields[key] = v;
  }
  if (entityChanged) override = resolveEntity(s, cleanFieldValue("registered_entity_name", analysis.updates.registered_entity_name)!);

  if (needBefore === "entity_confirm" && !entityChanged) {
    if (yesNo === true) s.entity = { ...s.entity, verified: true, candidate: null };
    else if (yesNo === false) {
      s.fields.registered_entity_name = null;
      s.entity = { ...s.entity, candidate: null, attempts: s.entity.attempts + 1 };
    }
  }
  if (needBefore === "mobile_confirm" && !analysis.updates.mobile_number) {
    if (yesNo === true && s.callerIdMobile) s.fields.mobile_number = s.callerIdMobile;
    s.mobileConfirmed = true; // on "no", nextNeed() falls through to asking for the number
  }
  if (needBefore === "optional_details") s.optionalAsked = true;

  // ---- read-back / submission
  if (s.phase === "confirming") {
    if (analysis.caller_wants_to_stop) return end(M.lines.callerStopped[s.lang], "caller_stopped", null);
    if (yesNo === true && missingRequired(s.fields).length === 0) return submit(db, call, s, cfg, now, say, end);
    s.phase = "collecting"; // a correction: re-read once the fields are complete again
    const corrected = FIELD_KEYS.some((k) => cleanFieldValue(k, analysis.updates[k]) !== null);
    if (!corrected) {
      s.phase = "confirming";
      return say(prefix + (analysis.reply.trim() && !M.hasEndMarker(analysis.reply) ? analysis.reply.trim() : M.lines.whatToCorrect[s.lang]));
    }
  }

  if (override) return say(prefix + override);
  const need = nextNeed(s);
  s.lastNeed = need;
  if (need === null) {
    s.phase = "confirming";
    return say(
      prefix +
        M.readBack(s.lang, {
          name: s.fields.complainant_name!,
          entity: s.fields.registered_entity_name!,
          nature: s.fields.complaint_nature ?? (s.lang === "hi" ? "जैसा आपने बताया" : "the issue you described"),
          amount: s.fields.amount_involved,
          mobile: s.fields.mobile_number!,
        }),
    );
  }
  // Model replies are used for ordinary questions; special flows use fixed lines.
  const special = need === "entity_confirm" || need === "mobile_confirm" || need === "optional_details";
  const reply = !special && usableModelReply(analysis.reply, s.lang) ? speakable(analysis.reply.trim()) : question(need, s);
  return say(prefix + reply);
}

function submit(
  db: Db,
  call: CallRow,
  s: CallState,
  cfg: Config,
  now: number,
  say: (t: string) => TurnResult,
  end: (t: string, r: string, f: FlagReason | null) => TurnResult,
): TurnResult {
  const phone = call.phone ?? `unknown:${call.id}`;
  const entity = s.fields.registered_entity_name!;
  const dup = findDuplicateComplaint(db, phone, entity, now, cfg);
  if (dup) {
    s.phase = "wrap_up";
    logEvent(db, { callId: call.id, phone: call.phone, type: "duplicate_complaint", detail: { ref: dup.id, entity } });
    return say(M.duplicate(s.lang, dup.id, entity));
  }
  if (!cfg.allowlist.includes(phone) && complaintsToday(db, phone, now) >= cfg.maxComplaintsPerDay) {
    return end(M.lines.dailyComplaintLimit[s.lang], "daily_complaint_limit", null);
  }
  const ref = complaintRef();
  const payload = {
    reference: ref,
    channel: "phone",
    caller_id: call.phone,
    language: s.lang,
    entity_verified: s.entity.verified,
    fields: s.fields,
    transcript: s.history.map((h) => ({ role: h.role, text: h.text })),
  };
  db.prepare("INSERT INTO complaints (id, call_id, phone, entity, payload, created_at, mirror_status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    ref,
    call.id,
    phone,
    entity,
    JSON.stringify(payload),
    now,
    cfg.mirrorToWebApp ? "pending" : "off",
  );
  db.prepare("UPDATE calls SET complaint_id = ? WHERE id = ?").run(ref, call.id);
  call.complaint_id = ref;
  logEvent(db, { callId: call.id, phone: call.phone, type: "complaint_registered", detail: { ref, entity } });
  if (cfg.mirrorToWebApp) void mirrorToWebApp(db, ref, s.fields);
  s.filedRefs = [...(s.filedRefs ?? []), ref];
  s.phase = "wrap_up";
  return say(M.registered(s.lang, ref));
}

export function welcomeLine(lang: Lang = "en"): string {
  return M.WELCOME[lang];
}
