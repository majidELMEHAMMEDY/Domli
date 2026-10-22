// Tiny Dutch/English detector for short chat messages. Used to answer fixed texts (booking link) in the visitor's language.
const ENGLISH = new Set('the is are you your can could how what when where do does did i my me we to a an of and for with have has will would please want need price prices cost book booking appointment hello hi hey thanks thank thx good morning afternoon evening'.split(' '));
const DUTCH = new Set('de het een en van ik je jij u uw we wij wat hoe waar wanneer kan kunnen niet met voor op aan ook als om is zijn heb heeft wil willen graag mijn jullie hallo hoi hai goedendag goedemorgen goedemiddag goedenavond bedankt dank dankjewel afspraak prijs kosten'.split(' '));

export function detectLanguage(text) {
  const words = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
  let en = 0;
  let nl = 0;
  for (const word of words) {
    if (ENGLISH.has(word)) en += 1;
    if (DUTCH.has(word)) nl += 1;
  }
  return en > nl ? 'en' : 'nl';
}

// Common small talk is answered directly, without the AI: instant, free and never handed to a person by mistake.
const LANGUAGE_QUESTION =
  /\b(?:do|can|could|does)\s+(?:you|u)\s+(?:speak|talk)\b|\bspreek(?:t)?\s+(?:je|jij|u|jullie)\b.*\b(?:engels|nederlands|english|dutch)\b|\bpraat(?:en)?\s+(?:je|jij|u|jullie)\b.*\b(?:engels|nederlands)\b|^\s*(?:english|engels|dutch|nederlands)\s*\?\s*$/i;
const GREETING = /^\s*(?:hi|hey|hello|hallo|hoi|hai|goedendag|goedemorgen|goedemiddag|goedenavond|good (?:morning|afternoon|evening))\s*[!.?]*\s*$/i;
const THANKS = /^\s*(?:thanks|thank you|thx|bedankt|dank je|dank u|dankjewel|dankuwel|dankjewel)\s*[!.]*\s*$/i;

const SMALL_TALK = {
  language: {
    nl: 'Ja, ik spreek Nederlands en Engels. Waarmee kan ik u helpen?',
    en: 'Yes, I speak both English and Dutch. How can I help you?',
  },
  greeting: { nl: 'Hallo! Waarmee kan ik u helpen?', en: 'Hello! How can I help you?' },
  thanks: {
    nl: 'Graag gedaan! Kan ik u nog ergens mee helpen?',
    en: "You're welcome! Is there anything else I can help you with?",
  },
};

export function smallTalkReply(text) {
  // Only short messages: a longer message has a real question in it that the assistant must read.
  if (text.trim().split(/\s+/).length > 8) return null;
  const kind = LANGUAGE_QUESTION.test(text) ? 'language' : GREETING.test(text) ? 'greeting' : THANKS.test(text) ? 'thanks' : null;
  if (!kind) return null;
  // A language question is answered in the language it was asked in ("English?" and "do you speak dutch" are English).
  let language = detectLanguage(text);
  if (kind === 'language') {
    if (/\b(?:engels|nederlands)\b/i.test(text)) language = 'nl';
    else if (/\b(?:english|dutch)\b/i.test(text)) language = 'en';
  }
  return SMALL_TALK[kind][language];
}
