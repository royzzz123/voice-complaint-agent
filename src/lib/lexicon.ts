// Fast, deterministic checks that run before the model sees the utterance.
// They catch the unambiguous cases with no model latency; Claude handles everything subtler
// (off-topic talk, pranks, gibberish, veiled abuse).

const PROFANITY = [
  // English
  "fuck", "fucking", "fucker", "motherfucker", "bitch", "bastard", "asshole", "dickhead", "cunt", "whore", "slut",
  // Hinglish (romanised)
  "madarchod", "maderchod", "mc", "behenchod", "bhenchod", "bc", "chutiya", "chutiye", "chutiyapa", "gandu", "gaandu",
  "bhosdi", "bhosdike", "bhosadike", "bhosdiwale", "harami", "haramkhor", "randi", "lund", "lauda", "lavde", "lawde", "jhatu", "kamina", "kamine",
  // Devanagari
  "मादरचोद", "बहनचोद", "भेनचोद", "चूतिया", "चुतिया", "गांडू", "गाण्डू", "भोसडी", "भोसड़ी", "हरामी", "हरामखोर", "रंडी", "लौड़ा", "लौडा", "कमीना", "कमीने",
];

const THREAT_PATTERNS = [
  /\b(i('| wi)ll|gonna|going to)\s+(kill|shoot|stab|murder|bomb)\b/i,
  /\b(bomb|blast)\s+(laga|rakh|kar)/i,
  /\bjaan\s+se\s+maar/i,
  /\bmaar\s+(dunga|dalunga|daalunga|denge|dalenge)\b/i,
  /जान\s*से\s*मार/,
  /मार\s*(दूंगा|डालूंगा|देंगे|डालेंगे)/,
  /बम\s*(लगा|रख)/,
];

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompt)/i,
  /\b(system|developer)\s+prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(act|behave)\s+as\s+(a|an|my)\b/i,
  /\bpretend\s+(to\s+be|you)/i,
  /\b(jailbreak|dan mode|developer mode)\b/i,
  /\brepeat\s+after\s+me\b/i,
  /\b(instructions|rules)\s+(bhool|bhul)/i,
  /\bnaye\s+instructions\b/i,
  /निर्देश\s*(भूल|भुला)/,
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);
}

const PROFANITY_SET = new Set(PROFANITY);

export interface LexiconHit {
  kind: "profanity" | "threat" | "injection";
  match: string;
}

export function scanUtterance(text: string): LexiconHit | null {
  for (const re of THREAT_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: "threat", match: m[0] };
  }
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: "injection", match: m[0] };
  }
  const toks = tokens(text);
  // "mc"/"bc" are only abuse as standalone words; also avoid flagging "bc" in "BC 2024"-style refs
  for (const t of toks) {
    if (PROFANITY_SET.has(t)) {
      if ((t === "mc" || t === "bc") && toks.length > 12) continue;
      return { kind: "profanity", match: t };
    }
  }
  return null;
}

/** Mask PAN / phone / account-looking numbers before anything is written to logs. */
export function redactForLog(text: string): string {
  return text
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[PAN]")
    .replace(/\b(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, "[PHONE]")
    .replace(/\b\d{12,18}\b/g, "[ACCOUNT]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]");
}
