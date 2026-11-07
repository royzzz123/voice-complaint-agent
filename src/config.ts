// All guardrail thresholds live here so they can be tuned per deployment via env.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: num("PORT", 8787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:8787",
  dbPath: process.env.DB_PATH ?? "./data/phone-agent.db",

  // Shared secret the voice platform sends on every webhook / tool call.
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",

  // One LLM call per turn does moderation, extraction and the spoken reply.
  // cloudflare: GLM 5.3 on Workers AI; glm: GLM on Z.ai; claude: Anthropic API.
  llmProvider: (process.env.LLM_PROVIDER ?? (process.env.GLM_API_KEY ? "glm" : process.env.CF_API_TOKEN ? "cloudflare" : "glm")) as
    | "cloudflare"
    | "glm"
    | "claude",
  // Seconds to wait for the primary model before trying the next configured one.
  llmTimeoutSec: num("LLM_TIMEOUT_SEC", 7),
  cfApiToken: process.env.CF_API_TOKEN ?? "",
  cfAccountId: process.env.CF_ACCOUNT_ID ?? "",
  cfModel: process.env.CF_MODEL ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
  glmApiKey: process.env.GLM_API_KEY ?? "",
  glmBaseUrl: process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4",
  glmModel: process.env.GLM_MODEL ?? "glm-5.3-flashx",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5",
  claudeEffort: (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high",

  // Existing SwarComplaint web app; finished phone complaints are mirrored there (best effort).
  webAppBaseUrl: process.env.WEB_APP_BASE_URL ?? "https://sebi-compliant-stt.vercel.app",
  mirrorToWebApp: (process.env.MIRROR_TO_WEB_APP ?? "true") === "true",

  // ---- Caller admission (checked before the agent speaks) ----
  allowedCountryCodes: list("ALLOWED_COUNTRY_CODES").length ? list("ALLOWED_COUNTRY_CODES") : ["+91"],
  allowlist: list("CALLER_ALLOWLIST"), // e.g. demo team numbers; never rate limited
  maxCallsPerHour: num("MAX_CALLS_PER_HOUR", 3),
  maxCallsPerDay: num("MAX_CALLS_PER_DAY", 6),
  hourlyBlockHours: num("HOURLY_BLOCK_HOURS", 24),
  dailyBlockHours: num("DAILY_BLOCK_HOURS", 24),
  maxConcurrentCalls: num("MAX_CONCURRENT_CALLS", 10),

  // ---- Misuse (bad-faith calls) ----
  // A call is "flagged" when it ends for abuse, prank/irrelevant talk or manipulation attempts.
  maxFlaggedCallsPerDay: num("MAX_FLAGGED_CALLS_PER_DAY", 2),
  flaggedBlockHours: num("FLAGGED_BLOCK_HOURS", 7 * 24),
  threatBlockHours: num("THREAT_BLOCK_HOURS", 30 * 24),
  // Each repeat block multiplies the duration (24h -> 48h -> 96h ...), capped.
  repeatBlockMultiplier: num("REPEAT_BLOCK_MULTIPLIER", 2),
  maxBlockHours: num("MAX_BLOCK_HOURS", 90 * 24),

  // ---- In-call limits ----
  offTopicStrikesToWarn: num("OFF_TOPIC_STRIKES_TO_WARN", 1),
  offTopicStrikesToEnd: num("OFF_TOPIC_STRIKES_TO_END", 3),
  abuseStrikesToEnd: num("ABUSE_STRIKES_TO_END", 2),
  maxTurns: num("MAX_TURNS", 30),
  maxCallSeconds: num("MAX_CALL_SECONDS", 600),
  maxUtteranceChars: num("MAX_UTTERANCE_CHARS", 1500),
  maxComplaintsPerDay: num("MAX_COMPLAINTS_PER_DAY", 3),
  duplicateWindowHours: num("DUPLICATE_WINDOW_HOURS", 24),
};

export type Config = typeof config;
