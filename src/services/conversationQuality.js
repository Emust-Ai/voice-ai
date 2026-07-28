const HALLUCINATION_PATTERNS = [
  /\bles liens? (?:sont|est) dans la description\b/i,
  /\bsous[- ]?titres? (?:réalisés?|créés?|fournis?)\b/i,
  /\bcommunauté d['’]amara\.org\b/i,
  /\bamara\.org\b/i,
  /\bmerci d['’]avoir regardé (?:cette|la) vidéo\b/i,
  /^réalisé par [a-z0-9_-]+(?:\s+merci d['’]avoir regardé.*)?[!. ]*$/i,
  /\bthanks? for watching\b/i,
  /\bsubscribe (?:to|and)\b/i,
  /^pour plus d['’]informations,? visitez [a-z0-9.-]+[!. ]*$/i,
  /^noms? importants?(?: pour l['’]entreprise)?[.! ]*$/i,
  /^thank you(?: for your time)?[.! ]*$/i,
  /^merci(?: beaucoup)?(?: pour votre temps)?[.! ]*$/i,
  /^thanks?(?: for your time)?[.! ]*$/i,
  /^โปรดติดตามตอนต่อไป[.! ]*$/u,
  /^keep doing what you['’]re doing[.! ]*$/i,
];

export function needsLocationSms(text) {
  return /\b(?:je ne sais pas|je sais pas|j['’]ai aucune idée|je ne vois rien|je suis perdu|où je suis|je ne connais pas).{0,35}\b(?:où|position|adresse|lieu|station|borne)?/i.test(String(text || ''))
    || /\b(?:don't know|do not know|can't find|cannot find)\b.{0,35}\b(?:where|location|address|station|charger)\b/i.test(String(text || ''))
    || /لا أعرف أين|لا أرى شيئًا|لا اعرف اين/u.test(String(text || ''));
}

export function needsQrFallback(text) {
  const value = String(text || '').toLowerCase();
  if (/(?:je n['’]?ai pas|j['’]ai pas|sans).{0,35}(?:appli|application).{0,20}(?:ni|ou|et).{0,20}(?:rfid|badge)/i.test(value)) return true;
  const noApp = /(?:je n['’]?ai pas|j['’]ai pas|sans|pas d['’])\s*(?:l['’])?(?:appli|application)|application (?:ne fonctionne pas|indisponible)/i.test(value);
  const noRfid = /(?:je n['’]?ai pas|j['’]ai pas|sans|pas d['’])\s*(?:carte\s*)?(?:rfid|badge)|(?:rfid|badge) (?:ne fonctionne pas|indisponible)/i.test(value);
  return noApp && noRfid;
}

const LANGUAGE_NAMES = {
  fr: 'français',
  ar: 'arabe',
  en: 'anglais',
};

export function isLikelyTranscriptHallucination(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  return HALLUCINATION_PATTERNS.some(pattern => pattern.test(normalized));
}

export function detectTranscriptLanguage(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return null;
  if (/[\u0600-\u06ff]/.test(normalized)) return 'ar';

  const words = normalized.match(/[a-zà-ÿ']+/g) || [];
  if (words.length < 3) return null;

  const french = new Set(['bonjour', 'bonsoir', 'merci', 'avec', 'pour', 'dans', 'vous', 'votre', 'station', 'borne', 'carte', 'recharge', 'fonctionne', 'problème', 'adresse', 'appelle']);
  const english = new Set(['hello', 'thanks', 'with', 'for', 'your', 'station', 'charger', 'card', 'charging', 'works', 'problem', 'address', 'called', 'please']);
  let frenchScore = 0;
  let englishScore = 0;
  for (const word of words) {
    if (french.has(word)) frenchScore++;
    if (english.has(word)) englishScore++;
  }
  if (/[àâçéèêëîïôûùüÿœ]/.test(normalized)) frenchScore += 2;

  if (englishScore >= 2 && englishScore > frenchScore) return 'en';
  if (frenchScore >= 1) return 'fr';
  return null;
}

export class ConversationLanguage {
  constructor(initialLanguage = 'fr') {
    this.current = initialLanguage;
    this.candidate = null;
    this.candidateTurns = 0;
  }

  observe(text) {
    const normalized = String(text || '').trim().toLowerCase();
    const explicit = this._explicitRequest(normalized);
    if (explicit) {
      this.current = explicit;
      this.candidate = null;
      this.candidateTurns = 0;
      return this.current;
    }

    const detected = detectTranscriptLanguage(normalized);
    if (!detected || detected === this.current) {
      this.candidate = null;
      this.candidateTurns = 0;
      return this.current;
    }

    if (detected === this.candidate) {
      this.candidateTurns++;
    } else {
      this.candidate = detected;
      this.candidateTurns = 1;
    }

    if (this.candidateTurns >= 2) {
      this.current = detected;
      this.candidate = null;
      this.candidateTurns = 0;
    }
    return this.current;
  }

  _explicitRequest(text) {
    if (/\b(?:parlez|répondez|continuez)\s+(?:en\s+)?arabe\b/i.test(text)) return 'ar';
    if (/\b(?:speak|answer|continue)\s+(?:in\s+)?english\b/i.test(text)) return 'en';
    if (/\b(?:parlez|répondez|continuez)\s+(?:en\s+)?fran[çc]ais\b/i.test(text)) return 'fr';
    return null;
  }
}

export function createLanguageResponseEvent(language = 'fr', extraInstruction = '') {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  const instruction = `Répondez uniquement en ${languageName} pour ce tour. Restez brève, naturelle et chaleureuse. N'utilisez aucune autre langue.${extraInstruction ? ` ${extraInstruction}` : ''}`;
  return {
    type: 'response.create',
    response: { instructions: instruction }
  };
}

export function requestsHumanAgent(text) {
  const value = String(text || '');
  return /\b(?:je veux|je souhaite|pouvez-vous|pouvez vous|mettez-moi|passez-moi|transférez-moi|parler|mettre en contact).{0,35}\b(?:humain|agent|conseiller|collègue|opérateur)\b/i.test(value)
    || /\b(?:i want|let me speak|connect me|transfer me).{0,30}\b(?:human|agent|representative|operator)\b/i.test(value)
    || /(?:أريد|اريد|حولني|أوصلني).{0,20}(?:موظف|إنسان|انسان|وكيل)/u.test(value);
}

export function isAffirmativeResponse(text) {
  return /^(?:oui|ouais|d['’]accord|ok(?:ay)?|bien sûr|volontiers|yes|نعم)(?:\s+s['’]il vous plaît|\s+please)?[!. ]*$/i.test(String(text || '').trim());
}

export function extractStationMention(text) {
  const normalized = String(text || '').trim();
  const match = normalized.match(/\b(?:station|borne).{0,25}?\b(?:appelée?|nommée?|s['’]appelle)\s+([\p{L}\p{N}][\p{L}\p{N} ._-]{1,50})/iu);
  if (!match) return null;
  return match[1]
    .replace(/[,.!?;:].*$/, '')
    .trim();
}
