// Fallback analyzer used when Claude is not configured or a request fails/times out.
// Keeps the line usable (and the guardrails deterministic) at lower conversational quality.

import { matchEntity } from "../lib/entities.ts";
import { emptyFields } from "./fields.ts";
import type { TurnAnalysis, TurnInput } from "./prompt.ts";

const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH = /\b(mera|meri|mere|mujhe|naam|paisa|paise|nahi|nahin|hai|hain|tha|thi|kiya|shikayat|haan|ji|theek)\b/i;
const INVESTOR_WORDS =
  /\b(broker|demat|share|shares|stock|trading|trade|mutual|fund|sip|redemption|payout|dividend|ipo|folio|account|complaint|shikayat|paisa|paise|money|refund|withdraw|sebi|scores|nse|bse|portfolio|kyc)\b|शिकायत|पैसा|पैसे|ब्रोकर|शेयर|फंड/i;
const YES = /\b(yes|yeah|yep|correct|right|sure|go ahead|haan|ha|haa|ji|theek|thik|sahi|bilkul|kar do)\b|हाँ|हां|सही|ठीक/i;
const NO = /\b(no|nope|wrong|galat|nahi|nahin|mat)\b|नहीं|गलत/i;
const STOP = /\b(bye|cancel|stop|end (the|this) call|cut (the|this) call|disconnect|hang up|band karo|band kar do|rakh do|rehne do|chhodo)\b|कॉल बंद|फ़ोन रख|फोन रख|रहने दो/i;

export function heuristicAnalyze(input: TurnInput): TurnAnalysis {
  const u = input.utterance;
  const language = DEVANAGARI.test(u) || HINGLISH.test(u) ? "hi" : "en";
  const updates = emptyFields();

  const name = u.match(/(?:my name is|i am|this is|mera naam|naam)\s+([A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*){0,2})/i);
  if (name) updates.complainant_name = name[1].replace(/\b(hai|he|and|from)\b.*$/i, "").trim().replace(/\b\w/g, (c) => c.toUpperCase());

  const mobile = u.replace(/[\s-]/g, "").match(/(?:\+?91)?([6-9]\d{9})/);
  if (mobile) updates.mobile_number = mobile[1];

  const amount = u.match(/(?:rs\.?|₹|rupees?)\s*([\d,]+)|([\d,]+)\s*(?:rs|rupees?|rupaye)/i);
  if (amount) updates.amount_involved = (amount[1] ?? amount[2]).replace(/,/g, "");

  const entity = matchEntity(u);
  if (entity && entity.score >= 0.8) {
    updates.registered_entity_name = entity.entity.name;
    updates.complaint_category = entity.entity.category;
  }

  const investorish = INVESTOR_WORDS.test(u) || Boolean(entity && entity.score >= 0.8) || Boolean(name) || Boolean(mobile) || Boolean(amount);
  if (investorish && u.split(/\s+/).length >= 6) {
    updates.complaint_description = [input.fields.complaint_description, u].filter(Boolean).join(" ").slice(0, 1500);
  }

  const words = u.trim().split(/\s+/).length;
  const answeringConfirm = input.phase === "confirming" || input.nextNeeded === "mobile_confirm" || input.nextNeeded === "entity_confirm";
  const classification: TurnAnalysis["classification"] =
    investorish || input.phase === "confirming" || (answeringConfirm && (YES.test(u) || NO.test(u))) || input.nextNeeded === "complainant_name" || input.nextNeeded === "optional_details"
      ? "on_topic"
      : words <= 3
        ? "small_talk"
        : "off_topic";

  return {
    classification,
    classification_reason: "heuristic fallback",
    language,
    updates,
    read_back_response: input.phase === "confirming" ? (YES.test(u) && !NO.test(u) ? "confirmed" : NO.test(u) ? "wants_changes" : "not_applicable") : "not_applicable",
    caller_wants_to_stop: STOP.test(u),
    reply: "",
  };
}

const ENGLISH = /\b(the|my|is|was|were|have|has|not|please|and|they|what|when|which|with|from|money|account|refund|payout|this|that|i'm|i am|it's|you)\b/i;
const HINGLISH_MORE = /\b(kya|kaun|kab|kaise|kyun|aap|aapka|bhai|sunao|batao|karna|karo|kar|ho|hua|gaya|gayi|diya|liya|abhi|kal|wala|wali|mein|se|ko|ka|ki|ke)\b/i;

/**
 * Language of a caller utterance from its words alone. Returns null when the words are too few
 * or neutral (a name, a number, "ok"), so the caller keeps the language of the call.
 */
export function detectLanguage(text: string): "en" | "hi" | null {
  if (DEVANAGARI.test(text)) return "hi";
  const hi = (text.match(new RegExp(HINGLISH.source, "gi"))?.length ?? 0) + (text.match(new RegExp(HINGLISH_MORE.source, "gi"))?.length ?? 0);
  const en = text.match(new RegExp(ENGLISH.source, "gi"))?.length ?? 0;
  if (hi === 0 && en === 0) return null;
  return hi >= en ? "hi" : "en";
}

/**
 * Language of the call, kept stable. A name, a number or one stray Devanagari character from
 * speech-to-text must not flip an English call to Hindi (or back). Returns the new language,
 * or null to keep the current one.
 */
export function decideLanguage(current: "en" | "hi", text: string, firstTurn: boolean): "en" | "hi" | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const dev = tokens.filter((t) => DEVANAGARI.test(t)).length;
  const latin = tokens.filter((t) => /[a-z]/i.test(t));
  const hiMarks = latin.filter((t) => HINGLISH.test(t) || HINGLISH_MORE.test(t)).length;
  const enMarks = latin.filter((t) => ENGLISH.test(t)).length;
  const hi = dev + hiMarks;
  const en = enMarks;
  if (firstTurn) {
    if (hi === 0 && en === 0) return null;
    return hi > en ? "hi" : "en";
  }
  if (tokens.length < 3) return null;
  if (current === "en" && hi >= 3 && hi > 1.5 * en) return "hi";
  if (current === "hi" && en >= 3 && en > 1.5 * hi) return "en";
  return null;
}

/** "No / that's all / thank you" at the end of a call. */
export function isDone(text: string): boolean {
  return /\b(no|nope|nothing|that'?s all|that is all|bas|nahi|nahin|bye|thank you|thanks|dhanyavaad|dhanyawad|shukriya)\b|नहीं|बस|धन्यवाद|शुक्रिया/i.test(text);
}

export function isAffirmative(text: string): boolean | null {
  if (YES.test(text) && !NO.test(text)) return true;
  if (NO.test(text)) return false;
  return null;
}
