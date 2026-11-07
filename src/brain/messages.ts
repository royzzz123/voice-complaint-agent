// Fixed policy lines. These are spoken verbatim, never model-generated, so guardrail
// behaviour is identical on every call.

export type Lang = "en" | "hi";

type Line = Record<Lang, string>;

export const END_MARKER_EN = "This call will now end.";
export const END_MARKER_HI = "यह कॉल अब समाप्त की जा रही है।";

export const WELCOME: Line = {
  en: "Namaste, you have reached SwarComplaint, an assistant that helps you prepare a complaint against a SEBI-registered broker, mutual fund or company. This call is recorded. Please tell me briefly what happened.",
  hi: "नमस्ते, आप SwarComplaint से जुड़े हैं। यह सेवा SEBI-registered broker, mutual fund या company के खिलाफ शिकायत तैयार करने में मदद करती है। यह कॉल रिकॉर्ड हो रही है। कृपया बताइए क्या हुआ?",
};

export const lines = {
  didNotHear: {
    en: "Sorry, I didn't quite catch that. Could you please say it again?",
    hi: "माफ़ कीजिए, मैं ठीक से सुन नहीं पाई। क्या आप कृपया दोबारा बता सकते हैं?",
  },
  offTopicRedirect: {
    en: "I'm sorry, I can only help with complaints about investments — for example, against a broker, a mutual fund or a listed company. Do you have a complaint like that?",
    hi: "माफ़ कीजिए, मैं सिर्फ़ निवेश से जुड़ी शिकायतों में मदद कर सकती हूँ — जैसे किसी broker, mutual fund या company के खिलाफ़। क्या आपकी ऐसी कोई शिकायत है?",
  },
  offTopicFinalWarning: {
    en: "I'm sorry, I can't help with that here — this helpline is only for investor complaints. If you don't have one, I'll close the call after your next reply, and you're welcome to call again any time.",
    hi: "माफ़ कीजिए, इसमें मैं यहाँ मदद नहीं कर पाऊँगी — यह हेल्पलाइन सिर्फ़ निवेशकों की शिकायतों के लिए है। अगर आपकी ऐसी कोई शिकायत नहीं है, तो अगले जवाब के बाद मैं कॉल बंद कर दूँगी। आप कभी भी दोबारा कॉल कर सकते हैं।",
  },
  offTopicEnd: {
    en: `Thank you for calling. Since I can't help with this request, I'll close the call now. If you have an investor complaint later, please call us again. ${END_MARKER_EN}`,
    hi: `कॉल करने के लिए धन्यवाद। इस विषय में मैं मदद नहीं कर पाऊँगी, इसलिए अब कॉल बंद कर रही हूँ। बाद में कोई निवेश शिकायत हो, तो कृपया दोबारा कॉल करें। ${END_MARKER_HI}`,
  },
  abuseWarning: {
    en: "I understand this is frustrating, and I really want to help. Could we please keep the conversation respectful? Otherwise I'll have to end the call.",
    hi: "मैं समझती हूँ कि आप परेशान हैं, और मैं सच में आपकी मदद करना चाहती हूँ। कृपया बातचीत में सम्मानजनक भाषा रखें, वरना मुझे कॉल बंद करनी पड़ेगी।",
  },
  abuseEnd: {
    en: `I'm sorry, I have to end this call because of the language used. You're welcome to call again to register your complaint. ${END_MARKER_EN}`,
    hi: `माफ़ कीजिए, भाषा की वजह से मुझे यह कॉल बंद करनी पड़ रही है। शिकायत दर्ज करने के लिए आप दोबारा कॉल कर सकते हैं। ${END_MARKER_HI}`,
  },
  threatEnd: {
    en: `I'm sorry, threatening language is not allowed on this helpline. This call is recorded and will now be closed. ${END_MARKER_EN}`,
    hi: `माफ़ कीजिए, इस हेल्पलाइन पर धमकी भरी भाषा की अनुमति नहीं है। यह कॉल रिकॉर्ड की गई है और अब बंद की जा रही है। ${END_MARKER_HI}`,
  },
  manipulationRedirect: {
    en: "I'm sorry, I can't do that. I'm here to help you register an investment complaint — could you tell me what happened with your broker or fund?",
    hi: "माफ़ कीजिए, मैं ऐसा नहीं कर सकती। मैं निवेश से जुड़ी शिकायत दर्ज करने में आपकी मदद के लिए हूँ — क्या आप बताएँगे कि आपके broker या fund के साथ क्या हुआ?",
  },
  distress: {
    en: "I'm really sorry you're going through this. Please talk to someone now: you can call Tele-MANAS on one four four one six, free, any time. When you're ready, I can still help register your complaint.",
    hi: "मुझे बहुत दुख है कि आप इससे गुज़र रहे हैं। कृपया अभी किसी से बात कीजिए: Tele-MANAS हेल्पलाइन एक चार चार एक छह पर मुफ़्त कॉल कर सकते हैं। जब आप तैयार हों, मैं आपकी शिकायत दर्ज करने में मदद करूँगी।",
  },
  callerStopped: {
    en: `No problem — I haven't registered anything. Thank you for calling, and please call again any time. ${END_MARKER_EN}`,
    hi: `कोई बात नहीं — मैंने कोई शिकायत दर्ज नहीं की है। कॉल करने के लिए धन्यवाद, आप कभी भी दोबारा कॉल कर सकते हैं। ${END_MARKER_HI}`,
  },
  timeLimit: {
    en: `I'm sorry, we've reached the time limit for this call. Please call again and I'll be happy to continue. ${END_MARKER_EN}`,
    hi: `माफ़ कीजिए, इस कॉल का समय पूरा हो गया है। कृपया दोबारा कॉल करें, मैं ख़ुशी से आगे मदद करूँगी। ${END_MARKER_HI}`,
  },
  dailyComplaintLimit: {
    en: `Thank you. You've already registered the maximum number of complaints for today from this number, so please call again tomorrow. ${END_MARKER_EN}`,
    hi: `धन्यवाद। इस नंबर से आज की अधिकतम शिकायतें दर्ज हो चुकी हैं, इसलिए कृपया कल दोबारा कॉल करें। ${END_MARKER_HI}`,
  },
  alreadyEnded: {
    en: `Thank you for calling. This call has now ended — please call again any time if you have an investor complaint. ${END_MARKER_EN}`,
    hi: `कॉल करने के लिए धन्यवाद। यह कॉल अब समाप्त हो चुकी है — कोई निवेश शिकायत हो तो कभी भी दोबारा कॉल करें। ${END_MARKER_HI}`,
  },
  whatToCorrect: {
    en: "Of course. What would you like me to correct?",
    hi: "ज़रूर। क्या ठीक करना है, बताइए?",
  },
  shortBye: {
    en: `You're welcome. Goodbye! ${END_MARKER_EN}`,
    hi: `आपका स्वागत है। नमस्ते! ${END_MARKER_HI}`,
  },
  anotherComplaint: {
    en: "Sure. Please tell me briefly about your other complaint.",
    hi: "ज़रूर। कृपया अपनी दूसरी शिकायत के बारे में संक्षेप में बताइए।",
  },
  anythingElse: {
    en: "Is there anything else I can help you with — perhaps another complaint?",
    hi: "क्या मैं आपकी और कोई मदद कर सकती हूँ — कोई और शिकायत?",
  },
  systemError: {
    en: "Sorry, I had a small problem. Could you please repeat that?",
    hi: "माफ़ कीजिए, थोड़ी दिक्कत हुई। क्या आप दोबारा बता सकते हैं?",
  },
} satisfies Record<string, Line>;

function spokenRef(ref: string): string {
  return ref.replace(/-/g, " ").split("").join(" ").replace(/\s+/g, " ");
}

export function entityNotRecognised(lang: Lang, spoken: string): string {
  return lang === "hi"
    ? `माफ़ कीजिए, मुझे "${spoken}" नाम की SEBI-registered company नहीं मिली। क्या आप broker या company का पूरा नाम एक बार फिर बता सकते हैं?`
    : `I'm sorry, I couldn't find "${spoken}" among SEBI-registered firms. Could you please say the full name of the broker or company once more?`;
}

export function entityConfirm(lang: Lang, name: string): string {
  return lang === "hi" ? `बस पक्का कर लूँ — क्या आपकी शिकायत ${name} के खिलाफ़ है?` : `Just to confirm, is your complaint against ${name}?`;
}

export function readBack(lang: Lang, f: { name: string; entity: string; nature: string; amount: string | null; mobile: string }): string {
  const mobileSpoken = f.mobile.split("").join(" ");
  if (lang === "hi") {
    return `धन्यवाद। मैं एक बार पढ़कर सुनाती हूँ: ${f.name}, शिकायत ${f.entity} के खिलाफ़, मुद्दा: ${f.nature}${f.amount ? `, राशि ${f.amount} रुपये` : ""}, मोबाइल ${mobileSpoken}। क्या यह सही है, और क्या मैं शिकायत दर्ज कर दूँ?`;
  }
  return `Thank you. Let me read that back to you: ${f.name}, complaint against ${f.entity}, about ${f.nature}${f.amount ? `, amount ${f.amount} rupees` : ""}, mobile ${mobileSpoken}. Is this correct, and shall I register it?`;
}

/** After a complaint is registered the call stays open: the caller may have another one. */
export function registered(lang: Lang, ref: string): string {
  return lang === "hi"
    ? `आपके धैर्य के लिए धन्यवाद। आपकी शिकायत दर्ज हो गई है, और आपका reference number है ${spokenRef(ref)}। इसे आप SCORES पोर्टल पर बता सकते हैं। ${lines.anythingElse.hi}`
    : `Thank you for your patience. Your complaint is registered, and your reference number is ${spokenRef(ref)}. You can quote it on the SCORES portal. ${lines.anythingElse.en}`;
}

export function duplicate(lang: Lang, ref: string, entity: string): string {
  return lang === "hi"
    ? `${entity} के खिलाफ़ इस नंबर से आज पहले ही शिकायत दर्ज है, reference number ${spokenRef(ref)}, इसलिए दोबारा दर्ज करने की ज़रूरत नहीं है। ${lines.anythingElse.hi}`
    : `A complaint against ${entity} from this number is already registered today, with reference number ${spokenRef(ref)}, so there's no need to file it again. ${lines.anythingElse.en}`;
}

export function goodbye(lang: Lang, refs: string[]): string {
  const last = refs.at(-1);
  if (lang === "hi") {
    return `कॉल करने के लिए धन्यवाद।${last ? ` आपका reference number है ${spokenRef(last)}।` : ""} आपका दिन शुभ हो। ${END_MARKER_HI}`;
  }
  return `Thank you for calling SwarComplaint.${last ? ` Your reference number is ${spokenRef(last)}.` : ""} Have a good day. ${END_MARKER_EN}`;
}

export function hasEndMarker(text: string): boolean {
  return text.includes(END_MARKER_EN) || text.includes(END_MARKER_HI);
}
