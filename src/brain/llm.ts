import { config } from "../config.ts";
import { claudeAnalyzeTurn, claudeAvailable, claudeComplete } from "./claude.ts";
import { glmAnalyzeTurn, glmAvailable, glmComplete } from "./glm.ts";
import type { TurnAnalysis, TurnInput } from "./prompt.ts";

// Model backends. LLM_PROVIDER picks the primary (default: glm when GLM_API_KEY is set, else
// cloudflare). Every other configured backend is a backup, tried in order when the primary fails
// or is slower than LLM_TIMEOUT_SEC; the conversation engine falls back to keywords after that.

export type ChatTurn = { role: "user" | "assistant"; content: string };
type Provider = "glm" | "cloudflare" | "claude";

function available(p: Provider): boolean {
  return p === "claude" ? claudeAvailable() : glmAvailable(p);
}

function chain(): Provider[] {
  const order: Provider[] = [config.llmProvider, "glm", "cloudflare", "claude"];
  return [...new Set(order)].filter(available);
}

function label(p: Provider): string {
  if (p === "claude") return `claude:${config.claudeModel}`;
  return p === "cloudflare" ? `cloudflare:${config.cfModel}` : `glm:${config.glmModel}`;
}

export function llmAvailable(): boolean {
  return chain().length > 0;
}

export function llmLabel(): string {
  const c = chain();
  return c.length ? c.map(label).join(" → ") : `${label(config.llmProvider)} (no key)`;
}

export async function analyzeTurn(input: TurnInput): Promise<TurnAnalysis> {
  let lastErr: unknown = new Error("no LLM configured");
  for (const p of chain()) {
    try {
      return p === "claude" ? await claudeAnalyzeTurn(input) : await glmAnalyzeTurn(p, input, config.llmTimeoutSec * 1000);
    } catch (err) {
      lastErr = err;
      console.error(`[llm] ${label(p)} failed:`, (err as Error).message);
    }
  }
  throw lastErr;
}

export async function complete(system: string, messages: ChatTurn[]): Promise<string> {
  const p = chain()[0];
  if (!p) return "";
  return p === "claude" ? claudeComplete(system, messages) : glmComplete(p, system, messages);
}
