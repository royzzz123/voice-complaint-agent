import { serve } from "@hono/node-server";
import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { readFileSync } from "node:fs";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { finalizeCall, getCall, handleTurn, startCall, welcomeLine, type CallState } from "./brain/conversation.ts";
import { llmAvailable, llmLabel } from "./brain/llm.ts";
import { blockNumber, unblockNumber } from "./policy.ts";
import { bolnaRoutes } from "./providers/bolna.ts";
import { maskPhone, normalizePhone } from "./lib/phone.ts";

const db = openDb();
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, llm: llmLabel(), llmConfigured: llmAvailable() }));
app.route("/", bolnaRoutes(db));

// ------------------------------------------------------------------ admin
async function adminAuth(c: Context, next: Next) {
  if (!config.adminToken) return next();
  const token = c.req.header("x-admin-token") ?? getCookie(c, "admin_token") ?? c.req.query("token");
  if (token !== config.adminToken) return c.text("Unauthorized. Open /admin?token=<ADMIN_TOKEN>", 401);
  if (c.req.query("token")) setCookie(c, "admin_token", token, { httpOnly: true, sameSite: "Strict", path: "/" });
  return next();
}
app.use("/admin/*", adminAuth);
app.use("/admin", adminAuth);
app.use("/sim/*", adminAuth);

const adminHtml = readFileSync(new URL("./admin.html", import.meta.url), "utf8");
app.get("/admin", (c) => c.html(adminHtml));

app.get("/admin/api/overview", (c) => {
  const now = Date.now();
  const day = now - 86_400_000;
  const one = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const stats = {
    callsToday: one("SELECT COUNT(*) n FROM calls WHERE started_at > ?", day),
    rejectedToday: one("SELECT COUNT(*) n FROM calls WHERE admitted = 0 AND started_at > ?", day),
    flaggedToday: one("SELECT COUNT(*) n FROM calls WHERE flagged = 1 AND started_at > ?", day),
    complaintsToday: one("SELECT COUNT(*) n FROM complaints WHERE created_at > ?", day),
    activeBlocks: one("SELECT COUNT(DISTINCT phone) n FROM blocks WHERE lifted_at IS NULL AND expires_at > ?", now),
  };
  const calls = (
    db
      .prepare(
        "SELECT id, provider, phone, started_at, ended_at, admitted, reject_reason, status, flagged, flag_reason, turns, complaint_id, state FROM calls ORDER BY started_at DESC LIMIT 200",
      )
      .all() as Record<string, unknown>[]
  ).map(({ state, phone, ...r }) => {
    const s = JSON.parse(String(state)) as CallState;
    return { ...r, phone: maskPhone(phone as string | null), strikes: s.strikes, endReason: s.endReason ?? null, lang: s.lang, transcript: s.history };
  });
  const blocks = (
    db
      .prepare("SELECT phone, reason, created_at, expires_at, created_by FROM blocks WHERE lifted_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
      .all(now) as Record<string, unknown>[]
  ).map((b) => ({ ...b, phoneMasked: maskPhone(b.phone as string) }));
  const complaints = (
    db.prepare("SELECT id, call_id, phone, entity, payload, created_at, mirror_status FROM complaints ORDER BY created_at DESC LIMIT 200").all() as Record<
      string,
      unknown
    >[]
  ).map(({ payload, phone, ...r }) => {
    const p = JSON.parse(String(payload)) as { fields: unknown; language?: string; entity_verified?: boolean; transcript?: unknown[] };
    return { ...r, phone: maskPhone(phone as string), fields: p.fields, language: p.language ?? null, entityVerified: p.entity_verified ?? null, transcript: p.transcript ?? [] };
  });
  return c.json({ stats, calls, blocks, complaints, config: guardrailSummary() });
});

app.post("/admin/api/block", async (c) => {
  const { phone, hours, reason } = (await c.req.json()) as { phone: string; hours?: number; reason?: string };
  const p = normalizePhone(phone);
  if (!p) return c.json({ error: "invalid phone" }, 400);
  const until = blockNumber(db, p, reason || "Blocked by admin", hours ?? 24 * 7, { by: "admin" });
  return c.json({ ok: true, until });
});

app.post("/admin/api/unblock", async (c) => {
  const { phone } = (await c.req.json()) as { phone: string };
  const p = normalizePhone(phone);
  if (!p) return c.json({ error: "invalid phone" }, 400);
  return c.json({ ok: true, lifted: unblockNumber(db, p) });
});

// ------------------------------------------------------------------ simulator (same code path as a real call)
app.post("/sim/call", async (c) => {
  const { phone } = (await c.req.json()) as { phone: string };
  const p = normalizePhone(phone);
  const { callId, decision } = startCall(db, { provider: "simulator", providerCallId: null, phone: p });
  return c.json({ callId, decision, welcome: decision.admitted ? welcomeLine("en") : null });
});

app.post("/sim/turn", async (c) => {
  const { callId, text } = (await c.req.json()) as { callId: string; text: string };
  if (!getCall(db, callId)) return c.json({ error: "unknown call" }, 404);
  return c.json(await handleTurn(db, callId, text ?? ""));
});

app.post("/sim/hangup", async (c) => {
  const { callId } = (await c.req.json()) as { callId: string };
  finalizeCall(db, callId, { providerStatus: "caller_hung_up" });
  return c.json({ ok: true });
});

function guardrailSummary() {
  return {
    maxCallsPerHour: config.maxCallsPerHour,
    maxCallsPerDay: config.maxCallsPerDay,
    maxFlaggedCallsPerDay: config.maxFlaggedCallsPerDay,
    flaggedBlockHours: config.flaggedBlockHours,
    hourlyBlockHours: config.hourlyBlockHours,
    offTopicStrikesToEnd: config.offTopicStrikesToEnd,
    abuseStrikesToEnd: config.abuseStrikesToEnd,
    maxCallSeconds: config.maxCallSeconds,
    maxComplaintsPerDay: config.maxComplaintsPerDay,
    allowedCountryCodes: config.allowedCountryCodes,
  };
}

if (!config.webhookSecret) console.warn("⚠  WEBHOOK_SECRET is not set: provider endpoints are unauthenticated (dev only).");
if (!config.adminToken) console.warn("⚠  ADMIN_TOKEN is not set: /admin is open (dev only).");
if (!llmAvailable()) console.warn(`⚠  No API key for ${llmLabel()}: using the heuristic fallback analyzer.`);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`SwarComplaint phone agent on http://localhost:${info.port}  (admin: /admin, llm: ${llmLabel()})`);
});
