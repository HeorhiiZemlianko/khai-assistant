export const TYPO_MAP = {
  'росклад': 'розклад',
  'степендія': 'стипендія',
  'гуртожиток': 'гуртожиток',
  'общага': 'гуртожиток',
  'препод': 'викладач',
  'документи': 'документи'
};

export function normalizeQuery(query) {
  let normalized = query.toLowerCase().replace(/[.,!?;:()]/g, '').replace(/\s+/g, ' ').trim();
  
  // Basic typo correction
  const words = normalized.split(' ');
  const correctedWords = words.map(w => TYPO_MAP[w] || w);
  
  return correctedWords.join(' ');
}

export function detectIntent(query, intentsData) {
  const normalizedQuery = normalizeQuery(query);
  const words = normalizedQuery.split(' ');

  let bestIntent = null;
  let maxScore = 0;

  for (const [intentName, intentData] of Object.entries(intentsData)) {
    let score = 0;
    for (const keyword of intentData.keywords) {
      if (normalizedQuery.includes(keyword)) {
        score += 2;
      }
    }
    for (const word of words) {
      if (intentData.keywords.includes(word)) {
        score += 1;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestIntent = intentName;
    }
  }

  return bestIntent;
}

export function buildContext(history, currentQuery) {
  // Take last 3 messages to understand context
  const recentHistory = history.slice(-3);
  let contextStr = recentHistory.map(msg => `${msg.sender === 'user' ? 'Користувач' : 'Асистент'}: ${msg.text}`).join('\n');
  return contextStr;
}
