"""Builds cost-estimate.md (and .docx via pandoc). All figures computed here; edit the inputs and re-run."""
# ---------------- inputs ----------------
COMPLAINTS_3M = 17_000
MONTHS = 3
SCENARIOS = [("Low", 1), ("Expected", 3), ("High", 5)]  # minutes per call
INR_PER_USD = 92  # Bolna's own conversion on its pricing page: 6.00¢ = ₹5.52

# Bolna per-minute charges, cents (from cost_breakdown of 4 test calls, 12 Oct 2026)
PLATFORM, TELEPHONY, STT, TTS = 2.00, 0.50, 0.91, 1.25
# LLM: GLM-5.3-flashx on Z.ai, USD per 1M tokens
P_IN, P_OUT = 0.37, 1.25
IN_TOK, OUT_TOK = 1_850, 230      # measured: 1,718 in + 150-270 out (incl. reasoning) per turn; input grows a little with history
TURNS_PER_MIN = 3.5               # test calls: 6 turns/118 s, 8/128 s, 10/160 s
OVERHEAD = 1.30                   # cancelled + re-sent turns and hang-up checks
NUMBER_RENT = 5.00                # USD per month, Vobiz number

llm_turn_c = (IN_TOK * P_IN + OUT_TOK * P_OUT) / 1e6 * 100            # cents per model call
llm_min_c = llm_turn_c * TURNS_PER_MIN * OVERHEAD
bolna_min_c = PLATFORM + TELEPHONY + STT + TTS
total_min_c = bolna_min_c + llm_min_c
calls_pm = COMPLAINTS_3M / MONTHS

def usd(x): return f"${x:,.0f}"
def inr(x):
    """Indian digit grouping: 240778 -> 2,40,778"""
    n = str(round(x * INR_PER_USD))
    head, tail = n[:-3], n[-3:]
    while len(head) > 2:
        tail = head[-2:] + "," + tail
        head = head[:-2]
    return "₹" + (head + "," + tail if head else tail)

rows = []
for name, mins in SCENARIOS:
    m = calls_pm * mins
    parts = {k: m * v / 100 for k, v in [("Platform", PLATFORM), ("Telephony", TELEPHONY), ("STT", STT), ("TTS", TTS), ("LLM", llm_min_c)]}
    month = sum(parts.values()) + NUMBER_RENT
    rows.append((name, mins, m, parts, month))

exp = rows[1]
L = []
w = L.append
w("# SwarComplaint phone line: running cost estimate")
w("")
w("Date: 12 October 2026 · Scope: API running cost only (speech-to-text, text-to-speech, LLM, voice platform, telephony)")
w("")
w("## 1. Result")
w("")
w(f"For **{COMPLAINTS_3M:,} complaints in {MONTHS} months** ({calls_pm:,.0f} each month), the expected cost is **{usd(exp[4])} each month ({inr(exp[4])})**. "
  f"For the 3 months, the expected cost is **{usd(exp[4]*MONTHS)} ({inr(exp[4]*MONTHS)})**.")
w("")
w("| Scenario | Call length | Minutes each month | Cost each month | Cost for 3 months |")
w("|---|---|---|---|---|")
for name, mins, m, parts, month in rows:
    w(f"| {name} | {mins} min | {m:,.0f} | **{usd(month)}** ({inr(month)}) | **{usd(month*MONTHS)}** ({inr(month*MONTHS)}) |")
w("")
w(f"The cost is approximately **{total_min_c:.1f}¢ ({total_min_c/100*INR_PER_USD:.2f} rupees) for each minute of call**. "
  f"A 3-minute complaint costs approximately **{total_min_c*3:.0f}¢ ({total_min_c*3/100*INR_PER_USD:.1f} rupees)**.")
w("")
w("## 2. Cost for each minute of call")
w("")
w("| Part | Service | Cost for each minute | Share | Source |")
w("|---|---|---|---|---|")
items = [("Voice platform", "Bolna", PLATFORM, "Bolna call records"),
         ("Telephony", "Vobiz, through Bolna", TELEPHONY, "Bolna call records"),
         ("Speech-to-text (STT)", "Deepgram nova-3, Hindi, through Bolna", STT, "Bolna call records"),
         ("Text-to-speech (TTS)", "Sarvam bulbul:v3, voice Priya, through Bolna", TTS, "Bolna call records (1.19–1.36¢)"),
         ("LLM", "Z.ai GLM-5.3-FlashX, paid directly", llm_min_c, "Measured tokens × Z.ai price")]
for part, svc, c, src in items:
    w(f"| {part} | {svc} | {c:.2f}¢ | {c/total_min_c*100:.0f}% | {src} |")
w(f"| **Total** | | **{total_min_c:.2f}¢** | 100% | |")
w("")
w("**Answer to \"is this the Bolna charge?\":** Not all of it. Bolna charges the platform, the telephony, the STT and the TTS: "
  f"{bolna_min_c:.2f}¢ for each minute ({bolna_min_c/total_min_c*100:.0f}% of the total). The LLM is not a Bolna charge. "
  "Bolna sends each turn to our server, and our server pays Z.ai directly. Bolna shows the LLM cost as 0 in its call records.")
w("")
w("## 3. Monthly cost by part (expected scenario, 3-minute calls)")
w("")
w("| Part | Paid to | Cost each month |")
w("|---|---|---|")
for k, payee in [("Platform", "Bolna"), ("Telephony", "Bolna"), ("STT", "Bolna"), ("TTS", "Bolna"), ("LLM", "Z.ai")]:
    w(f"| {k} | {payee} | {usd(exp[3][k])} ({inr(exp[3][k])}) |")
w(f"| Phone number rent | Bolna (Vobiz) | {usd(NUMBER_RENT)} ({inr(NUMBER_RENT)}) |")
w(f"| **Total** | | **{usd(exp[4])} ({inr(exp[4])})** |")
w("")
w("## 4. Assumptions")
w("")
w(f"1. {COMPLAINTS_3M:,} complaints in {MONTHS} months, equal in each month: {calls_pm:,.0f} calls each month. Each complaint is one call.")
w("2. Call length is 1 minute (low), 3 minutes (expected, the middle of 1–5 minutes) or 5 minutes (high).")
w("3. Bolna prices come from the cost records of 4 test calls on 12 October 2026 (34 s, 128 s, 142 s and 160 s). "
  "Bolna charges the platform and the telephony in 30-second units. The estimate uses whole minutes.")
w(f"4. One live call with the production prompt used 1,718 input and 150–270 output tokens. The estimate uses {IN_TOK:,} input tokens (the conversation history grows during a call) and {OUT_TOK} output tokens for each model call, "
  f"{TURNS_PER_MIN} caller turns each minute, and {int((OVERHEAD-1)*100)}% more model calls for turns that Bolna cancels and sends again.")
w(f"5. GLM-5.3-FlashX price: ${P_IN} for each million input tokens and ${P_OUT} for each million output tokens (Z.ai pricing page). "
  f"One model call costs approximately {llm_turn_c:.3f}¢.")
w(f"6. Exchange rate: ₹{INR_PER_USD} = $1, as on Bolna's pricing page (6.00¢ = ₹5.52).")
w("7. The backup model (Llama 4 Scout on Cloudflare) is used only when Z.ai fails. Its cost is small, and the estimate does not include it.")
w("")
w("## 5. Not included")
w("")
w("- Server hosting (Fly.io, approximately $3–5 each month). You asked for API cost only.")
w("- Calls that do not give a complaint: rejected numbers, prank calls, calls that the caller ends early. "
  "If these calls are 20% more than the complaints, add 20% to the cost.")
w("- Taxes (for example GST) and payment charges.")
w("- Price changes by Bolna, Deepgram, Sarvam or Z.ai after 12 October 2026.")
w("")
w("## 6. Open question for Bolna")
w("")
w(f"On the test account, Bolna deducted only the platform and the telephony from the wallet ({PLATFORM+TELEPHONY:.1f}¢ for each minute). "
  f"The call records also show the STT and the TTS ({STT+TTS:.2f}¢ for each minute), but these were not deducted. "
  "This estimate includes the STT and the TTS, to be safe. Ask Bolna if a paid account pays for them.")
w(f"If Bolna does not charge them, the expected cost is {usd(exp[4] - exp[3]['STT'] - exp[3]['TTS'])} each month.")
w("")
w("Bolna's published rate is 6.00¢ for each minute, with lower rates for volume (4.2–4.6¢ on the Pilots plan). "
  f"At 6.00¢ plus the LLM, the expected cost is {usd(exp[2]*(6.0+llm_min_c)/100 + NUMBER_RENT)} each month. "
  "At 17,000 minutes each month, ask Bolna for an enterprise rate.")
w("")
w("## 7. How to make the cost lower")
w("")
w("1. Ask Bolna for a volume or enterprise rate. The platform is the largest part.")
w("2. Use your own Deepgram and Sarvam keys in Bolna (bring your own keys), if your rates are lower.")
w("3. Use prompt caching on Z.ai. The fixed instructions are approximately 1,600 of the 1,850 input tokens, and cached tokens cost $0.075 instead of $0.37 for each million.")
w("4. Set the speech-to-text endpointing to 600 ms. Fewer turns are cancelled and sent again.")
w("")
w("## Sources")
w("")
w("- Bolna call records (cost_breakdown) of executions b8a0f381, 92d2f940, 10acc7c4 and ce075523, read through the Bolna API on 12 October 2026.")
w("- Bolna pricing: https://www.bolna.ai/pricing")
w("- Z.ai pricing: https://docs.z.ai/guides/overview/pricing")
w("- Token count: one live GLM-5.3-FlashX call with the production prompt, 12 October 2026.")
open("cost-estimate.md", "w").write("\n".join(L) + "\n")
print("\n".join(L[:20]))
