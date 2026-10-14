import { classifyWithLLM } from './llm-groq';

export interface ExtractedEntities {
  group?: string;
  teacher?: string;
  room?: string;
  day?: string;
  specialty?: string;
  date?: string;
  [key: string]: any;
}

export interface ClassificationResult {
  intent: string;
  entities: ExtractedEntities;
  confidence: number;
}

export interface HybridClassificationResult {
  intent: string;
  entities: ExtractedEntities;
  confidence: number;
  method: 'rules' | 'llm';
}

// Typo correction map
const TYPO_MAP: Record<string, string> = {
  'росклад': 'розклад',
  'россписание': 'розклад',
  'расписание': 'розклад',
  'степендія': 'стипендія',
  'стипендия': 'стипендія',
  'общага': 'гуртожиток',
  'общежитие': 'гуртожиток',
  'препод': 'викладач',
  'учитель': 'викладач',
  'прийом': 'прийом',
  'поступление': 'вступ',
  'документы': 'документи',
  'справка': 'довідка',
  'конфа': 'конференція',
  'мудл': 'moodle',
  'ментор': 'mentor',
  'пілот': 'pilot',
  'епос': 'epos'
};

export function normalizeText(text: string): string {
  let normalized = text
    .toLowerCase()
    .replace(/[«»""''`]/g, '')
    .replace(/[.,!?;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ');
  const corrected = words.map(w => TYPO_MAP[w] || w);
  return corrected.join(' ');
}

// Intent definitions with keyword patterns
const INTENT_RULES: Record<string, {
  keywords: string[];
  patterns?: RegExp[];
  roleBoost?: Record<string, number>;
}> = {
  schedule_group: {
    keywords: ['розклад групи', 'розклад для групи', 'пари', 'дзвінки', 'чисельник', 'знаменник', 'заняття групи'],
    patterns: [
      /розклад.*(груп|для|на)/i,
      /\b\d{3}[а-яА-Яa-zA-Z]{0,3}\b.*розклад/i,
      /розклад.*\b\d{3}[а-яА-Яa-zA-Z]{0,3}\b/i,
      /пари.*\b\d{3}[а-яА-Яa-zA-Z]{0,3}\b/i
    ],
    roleBoost: { 'Студент': 0.15 }
  },
  schedule_teacher: {
    keywords: ['розклад викладача', 'викладач розклад', 'консультації викладача', 'землянко'],
    patterns: [
      /розклад.*викладач/i,
      /розклад.*(землянко|доцент|професор)/i
    ],
    roleBoost: { 'Викладач': 0.15, 'Студент': 0.05 }
  },
  schedule_room: {
    keywords: ['розклад аудиторії', 'аудиторія', 'бронювання аудиторії', '227с', 'вільна аудиторія'],
    patterns: [
      /розклад.*аудитор/i,
      /аудитор.*\d{2,3}/i
    ],
    roleBoost: { 'Викладач': 0.15, 'Адміністрація': 0.15 }
  },
  admission_rules: {
    keywords: ['правила прийому', 'як вступити', 'умови вступу', 'вступна кампанія', 'електронний кабінет', 'подати документи', 'нмт для вступу'],
    patterns: [
      /правил.*прийом/i,
      /умов.*вступ/i,
      /як.*вступити/i,
      /термін.*вступ/i
    ],
    roleBoost: { 'Абітурієнт': 0.2, 'Адміністрація': 0.05 }
  },
  admission_specialties: {
    keywords: ['спеціальності', 'спеціальність', 'бакалаврат', 'магістратура', 'факультети', 'на кого вчитися', 'програми підготовки', '134', '121', '122'],
    patterns: [
      /яких.*спеціальност/i,
      /які.*спеціальност/i,
      /перелік.*спеціальност/i,
      /обрати.*спеціальність/i
    ],
    roleBoost: { 'Абітурієнт': 0.2 }
  },
  admission_score: {
    keywords: ['конкурсний бал', 'прохідний бал', 'бал на бюджет', 'розрахунок балу', 'вагові коефіцієнти', 'калькулятор'],
    patterns: [
      /конкурсн.*бал/i,
      /прохідн.*бал/i,
      /який.*бал/i,
      /скільки.*балів/i
    ],
    roleBoost: { 'Абітурієнт': 0.2 }
  },
  documents: {
    keywords: ['довідка про навчання', 'довідка', 'деканат довідка', 'замовлення довідки', 'тцк', 'військомат', 'студентський квиток', 'наказ', 'академдовідка'],
    patterns: [
      /довідк.*навчанн/i,
      /як.*отримати.*довідк/i,
      /замовити.*довідк/i,
      /довідк.*тцк/i
    ],
    roleBoost: { 'Студент': 0.2, 'Адміністрація': 0.1 }
  },
  dormitory: {
    keywords: ['гуртожиток', 'поселення', 'студмістечко', 'вартість гуртожитку', 'кімната', 'проживання', 'умови проживання'],
    patterns: [
      /гуртожит/i,
      /поселенн.*гуртожит/i,
      /оплат.*гуртожит/i,
      /як.*поселитис/i
    ],
    roleBoost: { 'Студент': 0.15, 'Абітурієнт': 0.15 }
  },
  conferences: {
    keywords: ['наукові конференції', 'конференція', 'конгрес двигунобудівників', 'scific', 'profit-ai', 'тези', 'доповіді', 'науковий форум'],
    patterns: [
      /конференц/i,
      /конгрес/i,
      /науков.*захід/i,
      /участь.*конференц/i
    ],
    roleBoost: { 'Викладач': 0.2, 'Студент': 0.1 }
  },
  publications: {
    keywords: ['публікації', 'наукові статті', 'репозитарій', 'журнал хаі', 'scopus', 'web of science', 'фахові видання', 'де публікувати'],
    patterns: [
      /публікац/i,
      /науков.*статт/i,
      /репозитар/i,
      /фахов.*виданн/i
    ],
    roleBoost: { 'Викладач': 0.2, 'Студент': 0.1 }
  },
  contacts: {
    keywords: ['контакти', 'телефон', 'адреса', 'деканат контакти', 'приймальна комісія телефон', 'пошта', 'як зв\'язатися', 'де знаходиться'],
    patterns: [
      /контакт/i,
      /телефон/i,
      /деканат.*телефон/i,
      /приймальн.*комісі.*телефон/i,
      /адрес/i
    ],
    roleBoost: { 'Всі': 0.05 }
  },
  platforms: {
    keywords: ['навчальні платформи', 'moodle', 'mentor', 'pilot', 'epos', 'профкомстуд', 'дистанційне навчання', 'де знайти пари онлайн'],
    patterns: [
      /платформ/i,
      /moodle/i,
      /mentor/i,
      /pilot/i,
      /epos/i,
      /дистанційн.*навчанн/i
    ],
    roleBoost: { 'Студент': 0.15, 'Викладач': 0.15 }
  },
  payment: {
    keywords: ['оплата навчання', 'вартість навчання', 'контракт ціна', 'реквізити', 'оплата за семестр', 'рахунок'],
    patterns: [
      /оплат.*навчанн/i,
      /вартіст.*навчанн/i,
      /цін.*контракт/i,
      /реквізит.*оплат/i
    ],
    roleBoost: { 'Студент': 0.15, 'Абітурієнт': 0.15 }
  },
  scholarship: {
    keywords: ['стипендія', 'рейтинг', 'академічна стипендія', 'соціальна стипендія', 'розмір стипендії', 'підвищена стипендія', 'нарахування'],
    patterns: [
      /стипенді/i,
      /рейтинг.*стипенді/i,
      /соціальн.*стипенді/i
    ],
    roleBoost: { 'Студент': 0.25 }
  }
};

export function extractEntities(rawText: string): ExtractedEntities {
  const entities: ExtractedEntities = {};

  // Extract group number (e.g., 545б, 525ст, 525, 321, 614м)
  const groupMatch = rawText.match(/\b([1-8]\d{2}(?:[а-яА-Яa-zA-Z]{1,3})?)\b/i);
  if (groupMatch) {
    entities.group = groupMatch[1].toLowerCase();
  }

  // Extract room (e.g., 227с, 301, 104к)
  const roomMatch = rawText.match(/\b(ауд(?:\.|иторія)?\s*)?([1-9]\d{1,2}[а-яА-Яa-zA-Z]?)\b/i);
  if (roomMatch && (rawText.toLowerCase().includes('ауд') || rawText.toLowerCase().includes('кімнат'))) {
    entities.room = roomMatch[2].toLowerCase();
  } else if (rawText.match(/\b227с\b/i)) {
    entities.room = '227с';
  }

  // Extract day of week
  const days = ['понеділок', 'вівторок', 'середа', 'четвер', 'п\'ятниця', 'субота', 'неділя'];
  for (const day of days) {
    if (rawText.toLowerCase().includes(day)) {
      entities.day = day;
      break;
    }
  }

  // Extract specialty code (e.g. 134, 121, 122, 123, 125, 173, 142)
  const specMatch = rawText.match(/\b(121|122|123|125|126|134|142|173|073|051)\b/);
  if (specMatch) {
    entities.specialty = specMatch[1];
  } else if (rawText.toLowerCase().includes('програмн') || rawText.toLowerCase().includes('інженерія програмного')) {
    entities.specialty = '121';
  } else if (rawText.toLowerCase().includes('авіаційн') || rawText.toLowerCase().includes('ракетно')) {
    entities.specialty = '134';
  }

  // Extract teacher
  if (rawText.toLowerCase().includes('землянко')) {
    entities.teacher = 'Землянко Георгій';
  }

  return entities;
}

export function classifyIntent(query: string, role: string = 'Студент'): ClassificationResult {
  const normalized = normalizeText(query);
  const entities = extractEntities(query);

  let bestIntent = 'unknown';
  let maxScore = 0;

  // Fast check: if group is mentioned alongside schedule or days, schedule_group gets high weight
  if (entities.group && (normalized.includes('розклад') || normalized.includes('пари') || entities.day)) {
    return {
      intent: 'schedule_group',
      entities,
      confidence: 0.95
    };
  }

  // Iterate over all intent rules
  for (const [intentName, rule] of Object.entries(INTENT_RULES)) {
    let score = 0;

    // Pattern matching
    if (rule.patterns) {
      for (const pattern of rule.patterns) {
        if (pattern.test(query) || pattern.test(normalized)) {
          score += 0.55;
          break;
        }
      }
    }

    // Keyword matching
    for (const kw of rule.keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        score += 0.35;
      }
    }

    // Role boost
    if (rule.roleBoost && rule.roleBoost[role]) {
      score += rule.roleBoost[role];
    }

    if (score > maxScore) {
      maxScore = score;
      bestIntent = intentName;
    }
  }

  // If score is too low or query is gibberish
  if (maxScore < 0.3) {
    return {
      intent: 'unknown',
      entities,
      confidence: maxScore
    };
  }

  return {
    intent: bestIntent,
    entities,
    confidence: Math.min(1.0, maxScore)
  };
}

const classificationCache = new Map<string, HybridClassificationResult>();
const MAX_CACHE_SIZE = 500; // защита от неограниченного роста

/**
 * Hybrid classification: rules first, LLM fallback for low-confidence cases.
 * Результаты кешируются по ключу `role::query` (lowercase, trimmed).
 */
export async function classifyIntentHybrid(
  query: string,
  role: string,
  confidenceThreshold: number = 0.5,
  history?: Array<{ sender: string; text: string }>
): Promise<HybridClassificationResult> {
  const cacheKey = `${role}::${query.toLowerCase().trim()}`;

  // ── Cache lookup ──────────────────────────────────────────
  if (classificationCache.has(cacheKey)) {
    console.log('[NLU] Cache hit');
    return classificationCache.get(cacheKey)!;
  }

  // ── Step 1: Try rule-based classification ─────────────────
  const ruleResult = classifyIntent(query, role);
  console.log(
    `[NLU] Rules result: intent=${ruleResult.intent}, confidence=${ruleResult.confidence.toFixed(2)}`
  );

  // ── Step 2: If rules are confident enough, use them ───────
  if (ruleResult.confidence >= confidenceThreshold && ruleResult.intent !== 'unknown') {
    const result: HybridClassificationResult = { ...ruleResult, method: 'rules' };
    cacheSet(cacheKey, result);
    return result;
  }

  // ── Step 3: Fallback to LLM for ambiguous / unknown ───────
  console.log('[NLU] Rules confidence low, falling back to LLM...');
  const llmResult = await classifyWithLLM(query, role, history);

  if (llmResult) {
    console.log(
      `[NLU] LLM result: intent=${llmResult.intent}, confidence=${llmResult.confidence.toFixed(2)}`
    );
    const result: HybridClassificationResult = {
      intent: llmResult.intent,
      entities: llmResult.entities as ExtractedEntities,
      confidence: llmResult.confidence,
      method: 'llm',
    };
    cacheSet(cacheKey, result);
    return result;
  }

  // ── Step 4: Both failed — return unknown ──────────────────
  console.log('[NLU] LLM also failed, returning unknown');
  const fallback: HybridClassificationResult = {
    ...ruleResult,
    intent: 'unknown',
    method: 'rules',
  };
  cacheSet(cacheKey, fallback);
  return fallback;
}

/**
 * Простая LRU-подобная вставка: при превышении лимита удаляем самый старый ключ.
 */
function cacheSet(key: string, value: HybridClassificationResult): void {
  if (classificationCache.size >= MAX_CACHE_SIZE) {
    const firstKey = classificationCache.keys().next().value;
    if (firstKey !== undefined) {
      classificationCache.delete(firstKey);
    }
  }
  classificationCache.set(key, value);
}
