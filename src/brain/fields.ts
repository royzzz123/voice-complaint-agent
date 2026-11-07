// Same field keys as the SwarComplaint web app (app/complaint schema), so a phone complaint
// maps 1:1 onto a web complaint.

export const FIELD_KEYS = [
  "complainant_name",
  "complainant_address",
  "email",
  "pan",
  "mobile_number",
  "date_of_birth",
  "registered_entity_name",
  "complaint_category",
  "complaint_nature",
  "complaint_description",
  "date_of_issue",
  "amount_involved",
  "prior_complaint_to_entity",
  "reference_numbers",
  "supporting_documents_mentioned",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];
export type Fields = Record<FieldKey, string | null>;

export const FIELD_LABELS: Record<FieldKey, string> = {
  complainant_name: "Full Name",
  complainant_address: "Address",
  email: "Email Address",
  pan: "PAN",
  mobile_number: "Mobile Number",
  date_of_birth: "Date of Birth",
  registered_entity_name: "SEBI-Regulated Entity",
  complaint_category: "Complaint Category",
  complaint_nature: "Nature of Complaint",
  complaint_description: "Complaint Description",
  date_of_issue: "Date / Period of Issue",
  amount_involved: "Amount Involved (₹)",
  prior_complaint_to_entity: "Already Complained to Entity?",
  reference_numbers: "Reference / Ticket Numbers",
  supporting_documents_mentioned: "Documents Mentioned",
};

/** Must be present before the agent reads back and asks to register. */
export const PHONE_REQUIRED: FieldKey[] = ["complaint_description", "registered_entity_name", "complainant_name", "mobile_number"];

/** Asked for once, in one combined question; the caller may skip them. */
export const PHONE_OPTIONAL_ASK: FieldKey[] = ["date_of_issue", "amount_involved", "prior_complaint_to_entity"];

export function emptyFields(): Fields {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as Fields;
}

export function missingRequired(f: Fields): FieldKey[] {
  return PHONE_REQUIRED.filter((k) => !f[k]?.trim());
}

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Normalise a model-proposed value; returns null for values that fail validation. */
export function cleanFieldValue(key: FieldKey, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (!v || /^(null|none|n\/a|unknown)$/i.test(v)) return null;
  switch (key) {
    case "mobile_number": {
      const d = v.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
      return /^[6-9]\d{9}$/.test(d) ? d : null;
    }
    case "pan":
      v = v.replace(/\s/g, "").toUpperCase();
      return PAN_RE.test(v) ? v : null;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    case "amount_involved": {
      const d = v.replace(/[,₹\s]|rs\.?|inr/gi, "");
      return /^\d+(\.\d+)?$/.test(d) ? d : null;
    }
    case "complainant_name":
      return v.length >= 2 && v.length <= 80 && !/\d/.test(v) ? v : null;
    default:
      return v.slice(0, 2000);
  }
}
