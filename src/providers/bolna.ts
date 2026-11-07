import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { config } from "../config.ts";
import { logEvent, type Db } from "../db.ts";
import { discardCancelledTurn, finalizeCall, getCall, handleTurn, startCall, type CallState } from "../brain/conversation.ts";
import { complete, llmAvailable } from "../brain/llm.ts";
import { hasEndMarker } from "../brain/messages.ts";
import { maskPhone, normalizePhone } from "../lib/phone.ts";

// Bolna wiring (see README "Bolna setup"):
//  1. Inbound "caller matching" API  -> GET  /bolna/caller-lookup   (runs before the agent answers)
//  2. Custom LLM (OpenAI-compatible) -> POST /v1/chat/completions   (every caller turn)
//  3. Call status webhook            -> POST /bolna/webhook
//
// Bolna does not pass call metadata to a custom LLM, so the caller-lookup response returns
// `call_ref`, which Bolna substitutes into the system prompt as "CALL_REF: <id>". The LLM endpoint
// reads it back from the system message to find the call.

export const AGENT_SIGNATURE = "[[SWARCOMPLAINT-PHONE-AGENT]]";
const MODEL_NAMES = ["swarcomplaint-guarded", "swarcomplaint-fly"];
// Tolerates either {var} or {{var}} substitution syntax.
const CALL_REF_RE = /CALL_REF:\s*\{*\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

type ChatMessage = { role: string; content?: string | null | Array<{ type: string; text?: string }> };

function text(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => p.text ?? "").join("");
  return "";
}

function bearerOk(header: string | undefined): boolean {
  if (!config.webhookSecret) return true; // dev mode; the server warns on boot
  return header === `Bearer ${config.webhookSecret}`;
}

/** Utterance(s) the caller spoke since the agent's last reply. */
function latestCallerText(messages: ChatMessage[]): string {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") break;
    if (m.role === "user") out.unshift(text(m));
  }
  return out.join(" ").trim();
}

function resolveCallId(db: Db, messages: ChatMessage[]): string | null {
  const system = messages.filter((m) => m.role === "system").map(text).join("\n");
  const m = system.match(CALL_REF_RE);
  if (m) return m[1];
  // Fallback when the lookup timed out / variable not substituted: the single most recent
  // active Bolna call. Safe at demo concurrency; logged so it is visible.
  const row = db
    .prepare("SELECT id FROM calls WHERE provider = 'bolna' AND status = 'active' AND started_at > ? ORDER BY started_at DESC LIMIT 2")
    .all(Date.now() - config.maxCallSeconds * 1000) as { id: string }[];
  if (row.length === 1) {
    logEvent(db, { callId: row[0].id, type: "call_ref_fallback" });
    return row[0].id;
  }
  return null;
}

function chunk(id: string, delta: Record<string, unknown>, finish: string | null = null) {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "swarcomplaint-guarded",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
}

/** Splits text into small speakable pieces so TTS can start early. */
function pieces(t: string): string[] {
  return t.match(/[^.?!।]+[.?!।]?\s*/g) ?? [t];
}

export function bolnaRoutes(db: Db) {
  const app = new Hono();

  // ---- 1. admission, before the agent answers. Must answer within 3s; this is pure SQLite.
  app.get("/bolna/caller-lookup", (c) => {
    if (!bearerOk(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
    const phone = normalizePhone(c.req.query("contact_number"));
    const executionId = c.req.query("execution_id") ?? null;
    const { callId, decision } = startCall(db, { provider: "bolna", providerCallId: executionId, phone });
    console.log(`[bolna] lookup ${maskPhone(phone)} -> ${decision.admitted ? "ADMIT" : `REJECT (${decision.reason})`}`);
    // Empty object = Bolna rejects the call (with "allow only callers from database" enabled).
    if (!decision.admitted) return c.json({});
    const state = JSON.parse(getCall(db, callId)!.state) as CallState;
    return c.json({ call_ref: callId, caller_known: state.callerIdMobile ? "yes" : "no" });
  });

  // ---- 2. custom LLM
  // Bolna validates the custom-LLM model name against this list. Every name runs the same engine;
  // more than one exists because Bolna will not register the same name twice.
  app.get("/v1/models", (c) =>
    c.json({ object: "list", data: MODEL_NAMES.map((id) => ({ id, object: "model", owned_by: "swarcomplaint" })) }),
  );

  app.post("/v1/chat/completions", async (c) => {
    if (!bearerOk(c.req.header("authorization"))) return c.json({ error: { message: "unauthorized" } }, 401);
    const body = (await c.req.json()) as { messages: ChatMessage[]; stream?: boolean };
    const messages = body.messages ?? [];
    const isAgentTurn = messages.some((m) => m.role === "system" && text(m).includes(AGENT_SIGNATURE));
    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    let reply: string;
    if (isAgentTurn) {
      const callId = resolveCallId(db, messages);
      const utterance = latestCallerText(messages);
      if (!callId) {
        console.warn("[bolna] could not resolve call for LLM turn");
        reply = "Sorry, I am having trouble on this line. Please call again in a few minutes. This call will now end.";
      } else {
        const before = getCall(db, callId);
        reply = (await handleTurn(db, callId, utterance)).reply;
        if (c.req.raw.signal.aborted && before) {
          discardCancelledTurn(db, callId, before);
          return new Response(null, { status: 499 }); // client closed; nothing to send
        }
      }
    } else {
      // Any auxiliary prompt Bolna sends through the custom LLM (e.g. hang-up evaluation, summaries).
      reply = await passthrough(messages);
    }

    if (!body.stream) {
      return c.json({
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "swarcomplaint-guarded",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      });
    }
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: chunk(completionId, { role: "assistant", content: "" }) });
      for (const p of pieces(reply)) await stream.writeSSE({ data: chunk(completionId, { content: p }) });
      await stream.writeSSE({ data: chunk(completionId, {}, "stop") });
      await stream.writeSSE({ data: "[DONE]" });
    });
  });

  // ---- 3. call status webhook
  app.post("/bolna/webhook", async (c) => {
    if (!bearerOk(c.req.header("authorization")) && c.req.query("token") !== config.webhookSecret) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const p = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      execution_id?: string;
      status?: string;
      conversation_duration?: number;
      telephony_data?: { from_number?: string; duration?: string | number };
    };
    const executionId = p.id ?? p.execution_id;
    if (!executionId) return c.json({ ok: true });
    const row = db.prepare("SELECT id FROM calls WHERE provider = 'bolna' AND provider_call_id = ?").get(executionId) as { id: string } | undefined;
    const terminal = ["completed", "call-disconnected", "failed", "no-answer", "busy", "canceled", "stopped", "error"];
    if (row && p.status && terminal.includes(p.status)) {
      finalizeCall(db, row.id, { durationSec: p.conversation_duration ?? null, providerStatus: p.status });
    } else if (row) {
      logEvent(db, { callId: row.id, type: "provider_status", detail: p.status });
    }
    return c.json({ ok: true });
  });

  return app;
}

async function passthrough(messages: ChatMessage[]): Promise<string> {
  // Without an LLM, answer the only auxiliary prompt we configure (hang-up check) deterministically.
  const ended = messages.some((m) => m.role === "assistant" && hasEndMarker(text(m)));
  if (!llmAvailable()) return ended ? "Yes" : "No";
  const system = messages.filter((m) => m.role === "system").map(text).join("\n\n");
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: text(m) || "(empty)" }));
  while (convo.length && convo[convo.length - 1].role === "assistant") convo.pop();
  if (!convo.length) convo.push({ role: "user", content: "Respond." });
  try {
    return (await complete(system, convo)) || (ended ? "Yes" : "No");
  } catch (err) {
    console.error("[bolna] passthrough failed:", (err as Error).message);
    return ended ? "Yes" : "No";
  }
}
