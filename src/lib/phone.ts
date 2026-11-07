// Caller-ID normalisation. Indian numbers arrive in many shapes depending on the
// carrier/provider: "09876543210", "919876543210", "+91 98765-43210", "9876543210".

const WITHHELD = new Set(["", "anonymous", "unknown", "private", "restricted", "unavailable", "withheld"]);

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (WITHHELD.has(trimmed)) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  const bare = digits.replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(bare)) return null;
  if (digits.startsWith("+")) return `+${bare}`;
  if (bare.length === 10 && /^[6-9]/.test(bare)) return `+91${bare}`;
  if (bare.length === 11 && bare.startsWith("0")) return `+91${bare.slice(1)}`;
  if (bare.length === 12 && bare.startsWith("91")) return `+${bare}`;
  return `+${bare}`;
}

/** 10-digit Indian mobile (as the SCORES form expects), or null. */
export function indianMobile(e164: string | null): string | null {
  if (!e164?.startsWith("+91")) return null;
  const local = e164.slice(3);
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/** For logs and the dashboard: +91•••••43210 */
export function maskPhone(e164: string | null): string {
  if (!e164) return "withheld";
  return e164.length <= 6 ? "•••" : `${e164.slice(0, 3)}•••••${e164.slice(-5)}`;
}
