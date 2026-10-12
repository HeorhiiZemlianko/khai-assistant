export interface QualityGateResult {
  isValid: boolean;
  reason?: string;
}

export function validateResponse(text: string): QualityGateResult {
  if (!text || typeof text !== 'string') {
    return { isValid: false, reason: 'Відповідь порожня' };
  }

  const trimmed = text.trim();

  // 1. Length check: 30 < length < 2500
  if (trimmed.length < 30) {
    return { isValid: false, reason: 'Відповідь занадто коротка (< 30 символів)' };
  }
  if (trimmed.length > 2500) {
    return { isValid: false, reason: 'Відповідь занадто довга (> 2500 символів)' };
  }

  // 2. Repetition check: phrase longer than 20 chars repeated more than 2 times
  // Strip URLs and whitespace before checking text degeneration
  const textWithoutUrls = trimmed
    .replace(/https?:\/\/[^\s)]+/gi, '')
    .replace(/[•\-\*]/g, ' ')
    .replace(/\s+/g, ' ');

  const minPhraseLen = 22;
  for (let i = 0; i < textWithoutUrls.length - minPhraseLen; i += 8) {
    const phrase = textWithoutUrls.substring(i, i + minPhraseLen).trim();
    if (phrase.length < minPhraseLen) continue;

    // Escape regex characters
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = textWithoutUrls.match(regex);
    if (matches && matches.length > 2) {
      return { isValid: false, reason: `Виявлено повторення фрази: "${phrase}"` };
    }
  }

  // 3. Unicode anomalies: characters outside Cyrillic, basic ASCII, standard punctuation, and emojis
  // Allowed ranges:
  // \u0400-\u04FF (Cyrillic)
  // \u0020-\u007E (Basic Latin and common symbols)
  // \u00A0-\u00BF (Latin-1 Supplement symbols like ©, «, », etc.)
  // \u2010-\u2030 (General punctuation: dashes, quotes, etc.)
  // \u2000-\u2BFF (Symbols, arrows, bullets, emojis)
  // \uD800-\uDFFF (Surrogate pairs for emojis)
  const allowedRegex = /^[\u0400-\u04FF\u0020-\u007E\u00A0-\u00BF\u2010-\u2030\u2000-\u2BFF\uD800-\uDFFF\n\r\t]+$/;
  if (!allowedRegex.test(trimmed)) {
    return { isValid: false, reason: 'Виявлено некоректні Unicode-символи або аномалії кодування' };
  }

  // 4. Garbage check: ratio of Cyrillic + spaces + punctuation + digits should be reasonable
  // In Ukrainian response, at least 60% of letters should be Cyrillic, and total text shouldn't be random binary noise
  const cyrillicLetters = (trimmed.match(/[\u0400-\u04FF]/g) || []).length;
  const latinLetters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = cyrillicLetters + latinLetters;

  if (totalLetters > 20 && (cyrillicLetters / totalLetters) < 0.5) {
    // If not mostly URLs or code, it must be predominantly Ukrainian (Cyrillic)
    const isUrlDominated = trimmed.includes('http://') || trimmed.includes('https://');
    if (!isUrlDominated) {
      return { isValid: false, reason: 'Замала частка українського тексту (кирилиці)' };
    }
  }

  return { isValid: true };
}
