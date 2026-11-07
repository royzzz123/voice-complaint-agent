import { config } from "../config.ts";
import { FIELD_KEYS } from "./fields.ts";
import { SYSTEM, TurnAnalysis, renderState, type TurnInput } from "./prompt.ts";
import type { ChatTurn } from "./llm.ts";

// GLM via an OpenAI-compatible Chat Completions API: Cloudflare Workers AI or Z.ai.
// JSON mode guarantees valid JSON but not our schema, so the shape is spelled out in the
// prompt and validated with zod; anything malformed falls back to the heuristic analyzer.

interface Endpoint {
  url: string;
  key: string;
  model: string;
  extra: Record<string, unknown>;
}

function endpoint(provider: "glm" | "cloudflare"): Endpoint {
  if (provider === "cloudflare") {
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/ai/v1/chat/completions`,
      key: config.cfApiToken,
      model: config.cfModel,
      // Workers AI cannot switch GLM 5.3 reasoning off; "low" keeps turn latency down.
      extra: { reasoning_effort: "low" },
    };
  }
  return {
    url: `${config.glmBaseUrl.replace(/\/$/, "")}/chat/completions`,
    key: config.glmApiKey,
    model: config.glmModel,
    // GLM 5.x always thinks (Z.ai rejects "disabled"); "low" answers in ~1.5 s. GLM 4.x can switch it off.
    extra: /^glm-4/.test(config.glmModel) ? { thinking: { type: "disabled" } } : { reasoning_effort: "low" },
  };
}

export function glmAvailable(provider: "glm" | "cloudflare"): boolean {
  return provider === "cloudflare" ? Boolean(config.cfApiToken && config.cfAccountId) : Boolean(config.glmApiKey);
}

const JSON_SHAPE = `

## Output format
Return ONLY a JSON object with exactly these keys:
{
  "classification": one of "on_topic" | "small_talk" | "off_topic" | "gibberish_or_prank" | "abusive" | "threat" | "manipulation" | "distress",
  "classification_reason": short string,
  "language": "en" | "hi",
  "updates": { ${FIELD_KEYS.map((k) => `"${k}": string or null`).join(", ")} },
  "read_back_response": "confirmed" | "wants_changes" | "not_applicable",
  "caller_wants_to_stop": true | false,
  "reply": string
}`;

async function chat(provider: "glm" | "cloudflare", body: Record<string, unknown>, timeoutMs: number): Promise<string> {
  const ep = endpoint(provider);
  const res = await fetch(ep.url, {
    method: "POST",
    headers: { authorization: `Bearer ${ep.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: ep.model, temperature: 0.2, ...ep.extra, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
    errors?: { message?: string }[];
  };
  if (!res.ok) throw new Error(`GLM ${res.status}: ${json.error?.message ?? json.errors?.[0]?.message ?? "request failed"}`);
  return json.choices?.[0]?.message?.content ?? "";
}

export async function glmAnalyzeTurn(provider: "glm" | "cloudflare", input: TurnInput, timeoutMs: number): Promise<TurnAnalysis> {
  const content = await chat(
    provider,
    {
      max_tokens: 4000, // reasoning tokens count against this on Workers AI
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM + JSON_SHAPE },
        { role: "user", content: renderState(input) },
      ],
    },
    timeoutMs,
  );
  // Reasoning models can wrap the object in prose or fences; take the outermost {...}.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("GLM returned no JSON object");
  const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  // Models sometimes omit unchanged keys; treat missing updates as null.
  const updates = (raw.updates ?? {}) as Record<string, unknown>;
  raw.updates = Object.fromEntries(FIELD_KEYS.map((k) => [k, updates[k] == null ? null : String(updates[k])]));
  return TurnAnalysis.parse(raw);
}

export async function glmComplete(provider: "glm" | "cloudflare", system: string, messages: ChatTurn[]): Promise<string> {
  return (await chat(provider, { max_tokens: 500, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages] }, 10_000)).trim();
}
