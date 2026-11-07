import { config, type Config } from "./config.ts";
import { logEvent, type Db } from "./db.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type AdmissionDecision =
  | { admitted: true; reason: "ok" | "allowlisted" }
  | { admitted: false; reason: AdmissionRejectReason; blockedUntil?: number; detail?: string };

export type AdmissionRejectReason =
  | "caller_id_withheld"
  | "country_not_allowed"
  | "blocked"
  | "hourly_limit"
  | "daily_limit"
  | "capacity";

export interface ActiveBlock {
  id: number;
  phone: string;
  reason: string;
  created_at: number;
  expires_at: number;
  created_by: string;
}

export function activeBlock(db: Db, phone: string, now = Date.now()): ActiveBlock | undefined {
  return db
    .prepare(
      "SELECT id, phone, reason, created_at, expires_at, created_by FROM blocks WHERE phone = ? AND lifted_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
    )
    .get(phone, now) as ActiveBlock | undefined;
}

/** Number of system blocks this phone has had in the last 90 days, used to escalate durations. */
function priorBlockCount(db: Db, phone: string, now: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM blocks WHERE phone = ? AND created_by = 'system' AND created_at > ?")
    .get(phone, now - 90 * DAY) as { n: number };
  return row.n;
}

export function blockNumber(
  db: Db,
  phone: string,
  reason: string,
  baseHours: number,
  opts: { by?: "system" | "admin"; now?: number; cfg?: Config } = {},
): number {
  const cfg = opts.cfg ?? config;
  const now = opts.now ?? Date.now();
  const by = opts.by ?? "system";
  const escalation = by === "system" ? Math.pow(cfg.repeatBlockMultiplier, priorBlockCount(db, phone, now)) : 1;
  const hours = Math.min(baseHours * escalation, cfg.maxBlockHours);
  const expiresAt = now + hours * HOUR;
  const existing = activeBlock(db, phone, now);
  if (existing && existing.expires_at >= expiresAt) return existing.expires_at;
  db.prepare("INSERT INTO blocks (phone, reason, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?)").run(
    phone,
    reason,
    now,
    expiresAt,
    by,
  );
  logEvent(db, { phone, type: "blocked", detail: { reason, hours, by } });
  return expiresAt;
}

export function unblockNumber(db: Db, phone: string, now = Date.now()): number {
  const res = db.prepare("UPDATE blocks SET lifted_at = ? WHERE phone = ? AND lifted_at IS NULL AND expires_at > ?").run(now, phone, now);
  logEvent(db, { phone, type: "unblocked", detail: { by: "admin" } });
  return Number(res.changes);
}

function countCalls(db: Db, phone: string, since: number): number {
  // Rejected attempts count too: a blocked number hammering the line keeps extending nothing,
  // but a number at its limit should not get a fresh window by retrying quickly.
  const row = db.prepare("SELECT COUNT(*) AS n FROM calls WHERE phone = ? AND started_at > ?").get(phone, since) as { n: number };
  return row.n;
}

function activeCallCount(db: Db, now: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM calls WHERE status = 'active' AND started_at > ?")
    .get(now - (config.maxCallSeconds + 120) * 1000) as { n: number };
  return row.n;
}

/**
 * Decide whether an incoming call may reach the agent. Pure read + block writes;
 * the caller of this function records the call attempt itself.
 */
export function admitCaller(db: Db, phone: string | null, opts: { now?: number; cfg?: Config } = {}): AdmissionDecision {
  const cfg = opts.cfg ?? config;
  const now = opts.now ?? Date.now();

  if (!phone) return { admitted: false, reason: "caller_id_withheld" };
  if (cfg.allowlist.includes(phone)) return { admitted: true, reason: "allowlisted" };
  if (!cfg.allowedCountryCodes.some((cc) => phone.startsWith(cc))) return { admitted: false, reason: "country_not_allowed" };

  const block = activeBlock(db, phone, now);
  if (block) return { admitted: false, reason: "blocked", blockedUntil: block.expires_at, detail: block.reason };

  // "this call" is attempt N+1
  const lastHour = countCalls(db, phone, now - HOUR);
  if (lastHour + 1 > cfg.maxCallsPerHour) {
    const until = blockNumber(db, phone, `More than ${cfg.maxCallsPerHour} calls within one hour`, cfg.hourlyBlockHours, { now, cfg });
    return { admitted: false, reason: "hourly_limit", blockedUntil: until };
  }
  const lastDay = countCalls(db, phone, now - DAY);
  if (lastDay + 1 > cfg.maxCallsPerDay) {
    const until = blockNumber(db, phone, `More than ${cfg.maxCallsPerDay} calls within 24 hours`, cfg.dailyBlockHours, { now, cfg });
    return { admitted: false, reason: "daily_limit", blockedUntil: until };
  }
  if (activeCallCount(db, now) >= cfg.maxConcurrentCalls) return { admitted: false, reason: "capacity" };

  return { admitted: true, reason: "ok" };
}

export type FlagReason = "abusive_language" | "off_topic_or_prank" | "manipulation_attempt" | "threat";

/**
 * Called when a call ends after being flagged as bad-faith. Blocks the number if it has
 * crossed the daily misuse threshold (or immediately for threats).
 */
export function applyMisusePolicy(
  db: Db,
  phone: string,
  reason: FlagReason,
  opts: { now?: number; cfg?: Config } = {},
): { blocked: boolean; until?: number } {
  const cfg = opts.cfg ?? config;
  const now = opts.now ?? Date.now();
  if (cfg.allowlist.includes(phone)) return { blocked: false };

  if (reason === "threat") {
    return { blocked: true, until: blockNumber(db, phone, "Threatening language on a call", cfg.threatBlockHours, { now, cfg }) };
  }
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM calls WHERE phone = ? AND flagged = 1 AND started_at > ?")
    .get(phone, now - DAY) as { n: number };
  if (row.n >= cfg.maxFlaggedCallsPerDay) {
    const until = blockNumber(
      db,
      phone,
      `${row.n} calls flagged for misuse within 24 hours (latest: ${reason.replace(/_/g, " ")})`,
      cfg.flaggedBlockHours,
      { now, cfg },
    );
    return { blocked: true, until };
  }
  return { blocked: false };
}

export function complaintsToday(db: Db, phone: string, now = Date.now()): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM complaints WHERE phone = ? AND created_at > ?").get(phone, now - DAY) as { n: number };
  return row.n;
}

export function findDuplicateComplaint(db: Db, phone: string, entity: string, now = Date.now(), cfg: Config = config) {
  return db
    .prepare("SELECT id, created_at FROM complaints WHERE phone = ? AND lower(entity) = lower(?) AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(phone, entity, now - cfg.duplicateWindowHours * HOUR) as { id: string; created_at: number } | undefined;
}
