// src/ai/llm-groq.ts
import { CONFIG } from '../config';
import { KnowledgeChunk } from './retrieval';

const SYSTEM_PROMPT_UK = (role: string) => `You are an intelligent assistant for KhAI National Aerospace University (Національний аерокосмічний університет «ХАІ»).
Your user role: ${role}.
LANGUAGE: Respond ONLY in Ukrainian, natural, polite, and human-like.
RULES:
1. Answer ONLY based on the provided context. Do not invent facts.
2. Be warm and helpful, like an experienced university consultant.
3. Structure: brief intro → key info (bullet points if relevant) → action/link.
4. If context lacks the answer, say honestly in Ukrainian and suggest contacting khai.edu.
5. Never repeat phrases. Never output random characters.
6. End with the most relevant source URL.`;

function buildUserPrompt(
  query: string,
  chunks: KnowledgeChunk[],
  role: string,
  parsedDate?: { isoDate: string; humanReadable: string } | null,
  history?: Array<{ sender: string; text: string }>,
  resolvedEntities?: Record<string, any>
): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString('uk-UA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const todayIso = today.toISOString().split('T')[0];

  const contextStr = chunks
    .slice(0, 5)
    .map((c, i) => `[Джерело ${i + 1} (${c.source_url})]:\n${c.text}`)
    .join('\n\n');

  const historyStr =
    history && history.length > 0
      ? history
          .slice(-6)
          .map(m => `${m.sender === 'user' ? 'Користувач' : 'Асистент'}: ${m.text}`)
          .join('\n')
      : 'Немає попередніх повідомлень';

  const entitiesStr = resolvedEntities
    ? Object.entries(resolvedEntities)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} = ${v}`)
        .join(', ')
    : 'не визначено';

  const dateStr = parsedDate
    ? `Користувач запитав про дату: "${parsedDate.humanReadable}" (ISO: ${parsedDate.isoDate}).`
    : 'Конкретна дата у запиті не вказана.';

  return `СЬОГОДНІШНЯ ДАТА: ${todayStr} (${todayIso}).
ЦЕ ВАЖЛИВО: Ти маєш використовувати саме цю дату як "сьогодні". Не вигадуй інші дати!

${dateStr}

РОЗПІЗНАНІ СУТНОСТІ З ЗАПИТУ: ${entitiesStr}

ІСТОРІЯ ДІАЛОГУ (останні повідомлення):
${historyStr}

ОФІЦІЙНИЙ КОНТЕКСТ ХАІ:
${contextStr}

ПОТОЧНИЙ ЗАПИТ КОРИСТУВАЧА: ${query}
Роль користувача: ${role}

ІНСТРУКЦІЇ:
1. Дай розгорнуту, структуровану відповідь українською мовою.
2. Якщо запит стосується "завтра", "сьогодні", "в понеділок" — використовуй дату, розраховану вище.
3. Якщо в історії діалогу згадувалась група, викладач або аудиторія, і зараз використовується займенник ("у них", "для нього") — обов'язково підстав цю сутність.
4. Використовуй списки, виділення жирним, емодзі для структури.
5. Якщо в контексті немає точної інформації (наприклад, розкладу на завтра) — чесно скажи: "На жаль, у наданих джерелах немає розкладу на цю дату. Спробуйте перевірити офіційний сайт."
6. НЕ ВИГАДУЙ факти, дати та події, яких немає в контексті. Краще визнати нестачу інформації, ніж згенерувати галюцинацію.
7. В кінці додай 1-3 найрелевантніші посилання з контексту.`;
}

export async function queryGroqLLM(
  query: string,
  chunks: KnowledgeChunk[],
  role: string,
  parsedDate?: any,
  history?: any[],
  resolvedEntities?: Record<string, any>
): Promise<string | null> {
  const proxyUrl = CONFIG.GROQ_PROXY_URL;
  if (!proxyUrl || proxyUrl.trim() === '') {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        context: chunks.map(c => c.text),
        role,
        system_prompt: SYSTEM_PROMPT_UK(role),
        user_prompt: buildUserPrompt(
          query,
          chunks,
          role,
          parsedDate,
          history,
          resolvedEntities
        ),
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Groq Proxy] HTTP error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const content =
      data?.choices?.[0]?.message?.content || data?.response || data?.text;

    if (content && typeof content === 'string') {
      return content.trim();
    }
    return null;
  } catch (error) {
    console.warn('[Groq Proxy] Failed to fetch response, falling back to templates:', error);
    return null;
  }
}

export interface LLMClassificationResult {
  intent: string;
  entities: {
    group?: string;
    teacher?: string;
    room?: string;
    day?: string;
    specialty?: string;
    date?: string;
    [key: string]: any;
  };
  confidence: number;
}

const CLASSIFICATION_PROMPT = `You are an intent classifier for KhAI university assistant.

CRITICAL: If the query contains pronouns like "у них", "для них", "а что у них", "там", it means the user is referring to a PREVIOUS context. Use the conversation history to resolve it.

Given a user query in Ukrainian, classify it into ONE of these intents:
schedule_group, schedule_teacher, schedule_room, admission_rules, admission_specialties, admission_score, documents, dormitory, conferences, publications, contacts, platforms, payment, scholarship, unknown.

EXAMPLES:
- "а що у них завтра?" → intent: schedule_group, entities: {} (but context from history should be used)
- "розклад 545б" → intent: schedule_group, entities: {group: "545б"}
- "коли пари у Землянка?" → intent: schedule_teacher, entities: {teacher: "Землянко"}

Return ONLY valid JSON in this exact format:
{"intent": "...", "entities": {...}, "confidence": 0.0-1.0}
Do not add any other text.`;

export async function classifyWithLLM(
  query: string,
  role: string
): Promise<LLMClassificationResult | null> {
  const proxyUrl = CONFIG.GROQ_PROXY_URL;

  console.log('[LLM] Proxy URL:', proxyUrl);

  if (!proxyUrl || proxyUrl.trim() === '') {
    console.warn('[LLM] Proxy URL is empty, skipping LLM');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        context: [],
        role,
        system_prompt: CLASSIFICATION_PROMPT,
        user_prompt: `User role: ${role}. Query: "${query}"`,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || data?.response || data?.text;
    if (!raw || typeof raw !== 'string') return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: parsed.intent || 'unknown',
      entities: parsed.entities || {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
    };
  } catch (error) {
    console.warn('[LLM Classification] Failed:', error);
    return null;
  }
}
