import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.ts";
import { SYSTEM, TurnAnalysis, renderState, type TurnInput } from "./prompt.ts";
import type { ChatTurn } from "./llm.ts";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function claudeAnalyzeTurn(input: TurnInput): Promise<TurnAnalysis> {
  const response = await getClient().beta.messages.parse(
    {
      model: config.claudeModel,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: config.claudeEffort,
        format: betaZodOutputFormat(TurnAnalysis),
      },
      system: [{ type: "text", text: SYSTEM + "\n\nLatency-sensitive; begin your visible answer immediately.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderState(input) }],
    },
    { timeout: 12_000, maxRetries: 1 },
  );
  if (response.stop_reason === "refusal") throw new Error("model_refusal");
  if (!response.parsed_output) throw new Error(`no_parsed_output (stop_reason=${response.stop_reason})`);
  return response.parsed_output;
}

export async function claudeComplete(system: string, messages: ChatTurn[]): Promise<string> {
  const res = await getClient().beta.messages.create({
    model: config.claudeModel,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: system || undefined,
    messages,
  });
  if (res.stop_reason === "refusal") return "";
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}
