# Demo setup: Indian number → Bolna → this laptop

Everything runs on your laptop. Bolna answers the phone in the cloud, and it needs a way to reach the laptop. A Cloudflare quick tunnel gives you a random, unlisted `https://….trycloudflare.com` address. It isn't published anywhere, and every endpoint requires your `WEBHOOK_SECRET`. Close the tunnel and nothing is reachable.

## Part A: get the Indian number (start this first; approval time isn't published)

1. Sign up at **platform.bolna.ai** with your OnFinance email. Add credit under billing; numbers cost about $5/month and calls about 5–6¢/min.
2. Get the documents ready, as PDFs of 10 MB or less, signed and stamped:
   - **Certificate of Incorporation (CIN)** for OnFinance
   - **GST registration certificate** and the GST number
   - Full name of the person applying, and the company name
3. Left sidebar → **Deploy → My Numbers → Buy Phone Number**.
4. **Select Country: India**. **Provider: Plivo**, which offers Bengaluru (080) and Mumbai (022) numbers.
5. If Bolna asks for the compliance application, fill it in with the name, company, CIN PDF, GST number and GST PDF, then submit. It's a one-time step, and once approved you can buy any number of numbers.
   - If you don't see the form, email **support@bolna.ai** with the subject "India compliance application – need inbound number for a regulator demo tomorrow" and attach the two PDFs. Ask them to expedite.
6. After approval, pick an 080 or 022 number and buy it. It appears under **My Numbers**.

**Backup in case approval isn't through in time:** the only Indian number available without KYC is an **Exotel trial ExoPhone**. Sign up at exotel.com for the 7-day trial; it includes an inbound number. In Bolna, connect your own Exotel account under **Deploy → My Numbers → connect your own provider (Exotel)** and import that number. I couldn't confirm that Bolna accepts trial Exotel accounts, so try this tonight. As a last resort, buy a US number in Bolna (instant). It works from India, but callers pay ISD rates.

## Part B: run the server on the laptop

```bash
cd phone-agent
cp .env.example .env
#   GLM_API_KEY=<Z.ai API key>            primary model: glm-5.3-flashx, about 2.2 s per turn
#   CF_API_TOKEN=<Cloudflare token>       backup model: Llama 4 Scout on Workers AI
#   CF_ACCOUNT_ID=<Cloudflare account ID>
#   WEBHOOK_SECRET=<output of: openssl rand -hex 24>
#   ADMIN_TOKEN=<anything>
#   MIRROR_TO_WEB_APP=false        (optional; the web app's backend is currently flaky)
npm install
npm run dev                         # terminal 1: keep running
brew install cloudflared
cloudflared tunnel --url http://localhost:8787     # terminal 2: keep running
```

Copy the `https://<random>.trycloudflare.com` URL it prints. Below it's written as **`TUNNEL`**. Check it with `curl TUNNEL/health`.

The URL changes every time cloudflared restarts. If that happens, update the three URLs in Part C (steps 1, 4 and 8). Keep both terminals open, and the laptop awake and online, for the whole demo.

## Part C: Bolna dashboard

### 1. Register this server as a custom LLM
**Settings → Integrations →** filter **LLM → Custom LLM → Add model**
| Field | Value |
|---|---|
| Model name | `swarcomplaint-guarded` |
| Endpoint URL | `TUNNEL/v1` |
| API key | your `WEBHOOK_SECRET` |
| Family | `openai` (if not offered, `llama`) |

Save. Bolna tests the endpoint right away, so the server and tunnel must already be running.

### 2. Create the agent
**Agents → New agent → start from scratch (blank)**. Name it `SwarComplaint SEBI complaint line`.

### 3. Agent tab
- **Welcome message:**
  > Namaste, you have reached SwarComplaint, an assistant that helps you prepare a complaint against a SEBI-registered broker, mutual fund or company. This call is recorded. Please tell me briefly what happened. आप हिंदी में भी बात कर सकते हैं।
- **Prompt:** paste exactly this. The server keys on the first three lines:
  ```
  [[SWARCOMPLAINT-PHONE-AGENT]]
  CALL_REF: {call_ref}
  CALL_REF: {{call_ref}}
  Replies are produced by the SwarComplaint guarded engine. Guardrails, extraction and
  complaint registration happen server-side. Do not edit the CALL_REF lines.
  ```
- **Hangup using a prompt:** ON, with this prompt:
  > Hang up only if the assistant's most recent message contains the exact phrase "This call will now end" or "यह कॉल अब समाप्त". Otherwise do not hang up.

### 4. Intelligence (LLM) tab
Provider **custom**, model **swarcomplaint-guarded**. Max tokens about 300, temperature 0.2.

### 5. Audio tab
- **Transcriber:** Sarvam, language **Hindi (hi)**. Sarvam's Hindi model handles Hinglish and Indian English. Endpointing about 400 ms.
- **Voice (synthesizer):** Sarvam, model **bulbul:v3**, language **hi**. Pick a female voice such as **Priya**; the fixed Hindi lines are written in the female form.

### 6. Engine → Call management
- **Hangup on user silence:** 15 s
- **Total call timeout:** 630 s (just above the server's 10-minute limit)
- **Interruptions:** after 3 words
- **Final call message:** leave empty; the server already says goodbye

### 7. Calling → Inbound
- **Inbound Calling:** ON → **Inbound number**: the number from Part A
- **Database for inbound phone numbers → Select data source: Use your internal APIs**
  - API Endpoint URL: `TUNNEL/bolna/caller-lookup`
  - Auth Token: your `WEBHOOK_SECRET`
- **"Allow incoming phone calls only from the chosen database": ON.** This lets the server reject blocked numbers before the agent answers.
- **Maximum calls allowed per Phone Number:** 6 (a backup limit inside Bolna)
- **Always-allow list:** leave empty, or add only phones that should never be blocked. Not the phone you'll use to demo blocking.

### 8. Webhook
In the agent's analytics or webhook setting, set the **Webhook URL** to `TUNNEL/bolna/webhook?token=<WEBHOOK_SECRET>`.

**Save agent.**

### 9. Test (tonight)
1. Open `http://localhost:8787/admin?token=<ADMIN_TOKEN>` on the laptop.
2. Call the number. The call should appear as *in progress*, with each turn classified live.
3. Run the demo script in `README.md`: a genuine complaint, a prank call twice (auto-block), 4 calls in an hour, abuse, and prompt injection.
4. Before the meeting, clear the test data: stop the server, run `rm -rf data`, then start it again. Or unblock your phone from the dashboard.

## If something goes wrong
| Symptom | Fix |
|---|---|
| Every call is rejected | Check `curl -H "authorization: Bearer $WEBHOOK_SECRET" "TUNNEL/bolna/caller-lookup?contact_number=9876543210"`. It should return `call_ref`. Check whether your number is blocked in `/admin`. |
| Agent says "having trouble on this line" | The `CALL_REF` lines are missing from the prompt, or the lookup URL is wrong. |
| Long pauses | Check the server log for `[llm] ... failed`. Make sure `GLM_MODEL` is `glm-5.3-flashx` (or not set) in `.env`, then restart. |
| Call doesn't hang up after the goodbye | The hang-up prompt in step 3 isn't saved. Silence and the timeout end the call anyway. |
