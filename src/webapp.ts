import { config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Fields } from "./brain/fields.ts";

// Mirrors a phone complaint into the existing SwarComplaint web app so it shows up in its
// /admin dashboard. That app keeps sessions in serverless memory, so extract + submit must
// hit the same warm instance back-to-back; failures are recorded, never surfaced to the caller.

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.webAppBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** A plain-English rendering the web app's extractor parses reliably. */
function canonicalTranscript(f: Fields): string {
  const parts = [
    f.complainant_name && `My name is ${f.complainant_name}.`,
    f.registered_entity_name && `My complaint is against ${f.registered_entity_name}.`,
    f.mobile_number && `My mobile number is ${f.mobile_number}.`,
    f.complaint_description,
    f.date_of_issue && `This happened in ${f.date_of_issue}.`,
    f.amount_involved && `The amount involved is ${f.amount_involved} rupees.`,
    f.prior_complaint_to_entity && `Already complained to the entity: ${f.prior_complaint_to_entity}.`,
    f.reference_numbers && `Reference numbers: ${f.reference_numbers}.`,
    f.email && `My email is ${f.email}.`,
    f.pan && `My PAN is ${f.pan}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

export async function mirrorToWebApp(db: Db, ref: string, fields: Fields): Promise<void> {
  const setStatus = (status: string, detail: string) =>
    db.prepare("UPDATE complaints SET mirror_status = ?, mirror_detail = ? WHERE id = ?").run(status, detail.slice(0, 500), ref);
  try {
    const extracted = await post<{ session_id: string }>("/api/complaint/extract", { transcript: canonicalTranscript(fields) });
    // Fill anything the web app's extractor missed, using the values the phone agent already validated.
    const typed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
    await post("/api/complaint/merge-followup", { session_id: extracted.session_id, new_transcript: "", typed_fields: typed }).catch(() => undefined);
    const submitted = await post<Record<string, unknown>>("/api/complaint/submit", { session_id: extracted.session_id });
    setStatus("mirrored", JSON.stringify(submitted));
  } catch (err) {
    setStatus("failed", (err as Error).message);
    console.warn(`[mirror] ${ref} not mirrored to web app: ${(err as Error).message}`);
  }
}
