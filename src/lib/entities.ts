// Demo-grade list of SEBI-regulated entities with the spoken aliases callers actually use.
// For production, load SEBI's intermediary registry (https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes)
// plus AMFI's AMC list into this shape.

export interface RegulatedEntity {
  name: string;
  category: "Stock Broker" | "Depository Participant" | "Mutual Fund" | "Listed Company" | "Registrar / RTA" | "Investment Adviser" | "Exchange / Depository";
  aliases: string[];
}

export const ENTITIES: RegulatedEntity[] = [
  { name: "Zerodha Broking Limited", category: "Stock Broker", aliases: ["zerodha", "kite", "zerodha kite", "जीरोधा", "ज़ेरोधा"] },
  { name: "Groww Invest Tech Private Limited", category: "Stock Broker", aliases: ["groww", "grow", "ग्रो", "ग्रोव"] },
  { name: "Angel One Limited", category: "Stock Broker", aliases: ["angel one", "angel broking", "angel", "एंजेल वन"] },
  { name: "Upstox (RKSV Securities India Private Limited)", category: "Stock Broker", aliases: ["upstox", "rksv", "अपस्टॉक्स"] },
  { name: "ICICI Securities Limited", category: "Stock Broker", aliases: ["icici direct", "icici securities", "icici"] },
  { name: "HDFC Securities Limited", category: "Stock Broker", aliases: ["hdfc securities", "hdfc sky"] },
  { name: "Kotak Securities Limited", category: "Stock Broker", aliases: ["kotak securities", "kotak neo", "kotak"] },
  { name: "Motilal Oswal Financial Services Limited", category: "Stock Broker", aliases: ["motilal oswal", "motilal"] },
  { name: "Sharekhan Limited", category: "Stock Broker", aliases: ["sharekhan", "share khan"] },
  { name: "5paisa Capital Limited", category: "Stock Broker", aliases: ["5paisa", "five paisa"] },
  { name: "Dhan (Moneylicious Securities Private Limited)", category: "Stock Broker", aliases: ["dhan", "moneylicious"] },
  { name: "Paytm Money Limited", category: "Stock Broker", aliases: ["paytm money", "paytm"] },
  { name: "SBI Funds Management Limited (SBI Mutual Fund)", category: "Mutual Fund", aliases: ["sbi mutual fund", "sbi mf", "sbi"] },
  { name: "HDFC Asset Management Company Limited", category: "Mutual Fund", aliases: ["hdfc mutual fund", "hdfc amc", "hdfc mf", "hdfc"] },
  { name: "ICICI Prudential Asset Management Company Limited", category: "Mutual Fund", aliases: ["icici prudential", "icici pru", "icici mutual fund"] },
  { name: "Nippon Life India Asset Management Limited", category: "Mutual Fund", aliases: ["nippon", "nippon india", "reliance mutual fund"] },
  { name: "Axis Asset Management Company Limited", category: "Mutual Fund", aliases: ["axis mutual fund", "axis mf", "axis"] },
  { name: "Kotak Mahindra Asset Management Company Limited", category: "Mutual Fund", aliases: ["kotak mutual fund", "kotak mf"] },
  { name: "Aditya Birla Sun Life AMC Limited", category: "Mutual Fund", aliases: ["aditya birla", "birla sun life", "absl"] },
  { name: "Computer Age Management Services Limited (CAMS)", category: "Registrar / RTA", aliases: ["cams", "computer age"] },
  { name: "KFin Technologies Limited", category: "Registrar / RTA", aliases: ["kfintech", "kfin", "karvy fintech", "karvy"] },
  { name: "Central Depository Services (India) Limited (CDSL)", category: "Exchange / Depository", aliases: ["cdsl"] },
  { name: "National Securities Depository Limited (NSDL)", category: "Exchange / Depository", aliases: ["nsdl"] },
  { name: "Reliance Industries Limited", category: "Listed Company", aliases: ["reliance industries", "reliance", "ril"] },
  { name: "Tata Motors Limited", category: "Listed Company", aliases: ["tata motors"] },
  { name: "Infosys Limited", category: "Listed Company", aliases: ["infosys"] },
  { name: "Yes Bank Limited", category: "Listed Company", aliases: ["yes bank"] },
  { name: "Adani Enterprises Limited", category: "Listed Company", aliases: ["adani enterprises", "adani"] },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\b(pvt|private|ltd|limited|ltd\.|india|securities|broking|the)\b/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export interface EntityMatch {
  entity: RegulatedEntity;
  score: number; // 0..1
}

/** Best match for what the caller said. Score >= 0.8 is treated as verified. */
export function matchEntity(spoken: string | null | undefined): EntityMatch | null {
  if (!spoken) return null;
  const q = norm(spoken);
  if (!q) return null;
  let best: EntityMatch | null = null;
  for (const entity of ENTITIES) {
    for (const candidate of [entity.name, ...entity.aliases]) {
      const c = norm(candidate);
      if (!c) continue;
      let score: number;
      if (q === c) score = 1;
      // Alias said as whole words inside a longer phrase ("my zerodha account"): verified; longer aliases win ties.
      else if (new RegExp(`(^| )${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`, "u").test(q)) score = 0.85 + 0.1 * (c.length / q.length);
      else score = 1 - levenshtein(q, c) / Math.max(q.length, c.length);
      if (!best || score > best.score) best = { entity, score };
    }
  }
  return best;
}
