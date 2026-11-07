// Creates the Bolna inbound agent wired to this server, and (optionally) links a phone number.
//
//   BOLNA_API_KEY=...  PUBLIC_BASE_URL=https://<your-tunnel>  WEBHOOK_SECRET=...  npm run bolna:setup
//   add BOLNA_PHONE_NUMBER_ID=... to also attach the inbound number (ids: GET https://api.bolna.ai/phone-numbers/all)

import { config } from "../src/config.ts";
import { WELCOME } from "../src/brain/messages.ts";
import { AGENT_SIGNATURE } from "../src/providers/bolna.ts";

const API = "https://api.bolna.ai";
const key = process.env.BOLNA_API_KEY;
const base = process.env.PUBLIC_BASE_URL;
if (!key || !base || base.includes("localhost")) {
  console.error("Set BOLNA_API_KEY and a public PUBLIC_BASE_URL (e.g. a cloudflared tunnel URL).");
  process.exit(1);
}
if (!config.webhookSecret) {
  console.error("Set WEBHOOK_SECRET; Bolna must send it as the custom LLM key and lookup bearer token.");
  process.exit(1);
}

// The custom LLM (this server) ignores the content of this prompt apart from the signature and
// CALL_REF; it is written so that a human reading the Bolna dashboard understands the setup.
const systemPrompt = `${AGENT_SIGNATURE}
CALL_REF: {call_ref}
CALL_REF: {{call_ref}}
This agent's replies are produced by the SwarComplaint guarded engine at ${base}. Guardrails, extraction and
complaint registration happen server-side. Do not edit the two CALL_REF lines: they identify the call.`;

const body = {
  agent_config: {
    agent_name: "SwarComplaint SEBI complaint line",
    agent_welcome_message: `${WELCOME.en} आप हिंदी में भी बात कर सकते हैं।`,
    webhook_url: `${base}/bolna/webhook?token=${encodeURIComponent(config.webhookSecret)}`,
    tasks: [
      {
        task_type: "conversation",
        toolchain: { execution: "sequential", pipelines: [["transcriber", "llm", "synthesizer"]] },
        tools_config: {
          llm_agent: {
            agent_type: "simple_llm_agent",
            agent_flow_type: "streaming",
            llm_config: {
              provider: "custom",
              family: "openai",
              base_url: `${base}/v1`,
              model: "swarcomplaint-guarded",
              max_tokens: 300,
              temperature: 0.2,
            },
          },
          transcriber: {
            provider: "sarvam",
            model: process.env.BOLNA_STT_MODEL ?? "saaras:v3",
            language: "hi", // Sarvam's Hindi model also handles Hinglish and Indian English
            stream: true,
            encoding: "linear16",
            sampling_rate: 16000,
            endpointing: 400,
          },
          synthesizer: {
            provider: "sarvam",
            provider_config: { voice: "Priya", voice_id: "priya", model: "bulbul:v3", language: "hi", speed: 1.0 },
            stream: true,
            buffer_size: 150,
            audio_format: "wav",
          },
          input: { provider: process.env.BOLNA_TELEPHONY ?? "vobiz", format: "wav" },
          output: { provider: process.env.BOLNA_TELEPHONY ?? "vobiz", format: "wav" },
        },
        task_config: {
          call_terminate: config.maxCallSeconds + 30, // hard stop just after the server-side limit
          hangup_after_silence: 15,
          hangup_after_LLMCall: true,
          call_cancellation_prompt:
            "Hang up only if the assistant's most recent message contains the exact phrase 'This call will now end' or 'यह कॉल अब समाप्त'. Otherwise do not hang up.",
          number_of_words_for_interruption: 3,
          incremental_delay: 400,
          backchanneling: false,
          ambient_noise: false,
          disallow_unknown_numbers: true, // the caller-lookup API is the gatekeeper
          inbound_limit: config.maxCallsPerDay, // second line of defence, enforced by Bolna itself
          whitelist_phone_numbers: config.allowlist.length ? config.allowlist : null,
          check_if_user_online: true,
          trigger_user_online_message_after: 10,
          voicemail: false,
        },
      },
    ],
  },
  agent_prompts: { task_1: { system_prompt: systemPrompt } },
};

async function call(path: string, init: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const created = (await call("/v2/agent", { method: "POST", body: JSON.stringify(body) })) as { agent_id: string };
console.log(`✓ Agent created: ${created.agent_id}`);

if (process.env.BOLNA_PHONE_NUMBER_ID) {
  await call("/inbound/setup", {
    method: "POST",
    body: JSON.stringify({ agent_id: created.agent_id, phone_number_id: process.env.BOLNA_PHONE_NUMBER_ID }),
  });
  console.log("✓ Inbound number linked to the agent");
}

console.log(`
Finish in the Bolna dashboard (Agent → Calling/Inbound tab):
  1. Settings → Integrations → LLM → Custom LLM: set the API key to your WEBHOOK_SECRET.
  2. Inbound → "Database for inbound phone numbers": choose API, URL
       ${base}/bolna/caller-lookup
     Auth: Bearer token = WEBHOOK_SECRET. Keep "allow calls only from this database" ON.
  3. ${process.env.BOLNA_PHONE_NUMBER_ID ? "Number already linked." : "Deploy → My Numbers: buy/connect a number and assign it to this agent for inbound."}
  4. Call the number. Watch ${base}/admin?token=<ADMIN_TOKEN>
`);
