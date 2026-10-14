import { parseRelativeDate, ParsedDate } from '../utils/date-parser';
import { ConversationMemory } from './conversation-memory';
import { classifyIntentHybrid, HybridClassificationResult, ExtractedEntities } from './intent-classifier';
import { BM25Retriever, SearchResult } from './retrieval';
import { CONFIG } from '../config';

export interface AgentStep {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  detail?: string;
  data?: any;
}

export interface AgentResult {
  classification: HybridClassificationResult;
  resolvedEntities: ExtractedEntities;
  parsedDate: ParsedDate | null;
  searchResults: SearchResult[];
  steps: AgentStep[];
  finalQuery: string;
}

export class AgentCore {
  private retriever: BM25Retriever;
  private memory: ConversationMemory;

  constructor(retriever: BM25Retriever, memory: ConversationMemory) {
    this.retriever = retriever;
    this.memory = memory;
  }

  /**
   * Основной метод агента: выполняет многошаговую обработку запроса.
   */
  async process(
    query: string,
    role: string
  ): Promise<AgentResult> {
    const steps: AgentStep[] = [];

    // ── Шаг 1: Разрешение контекста из истории ──────────────────
    let resolvedQuery = query;
    let resolvedEntities: ExtractedEntities = {};

    if (this.memory.needsContextResolution(query)) {
      const lastEntities = this.memory.getLastKnownEntities();
      if (Object.keys(lastEntities).length > 0) {
        resolvedEntities = { ...lastEntities };
        resolvedQuery = `${query} ${Object.entries(lastEntities)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ')}`;
        steps.push({
          step: 'context-resolution',
          status: 'success',
          detail: `Підставлено сутності з історії: ${JSON.stringify(lastEntities)}`,
          data: lastEntities,
        });
      } else {
        steps.push({
          step: 'context-resolution',
          status: 'skipped',
          detail: 'Історія порожня, контекст не потрібен',
        });
      }
    } else {
      steps.push({
        step: 'context-resolution',
        status: 'skipped',
        detail: 'Запит не містить займенників, історія не потрібна',
      });
    }

    // ── Шаг 2: Парсинг относительной даты ──────────────────────
    const parsedDate = parseRelativeDate(resolvedQuery);
    if (parsedDate) {
      resolvedEntities.date = parsedDate.isoDate;
      resolvedEntities.day = parsedDate.humanReadable;
      steps.push({
        step: 'date-parsing',
        status: 'success',
        detail: `Розпізнано дату: ${parsedDate.humanReadable} (${parsedDate.isoDate})`,
        data: parsedDate,
      });
    } else {
      steps.push({
        step: 'date-parsing',
        status: 'skipped',
        detail: 'Відносну дату не знайдено',
      });
    }

    // ── Шаг 3: Классификация намерения ─────────────────────────
    const classification = await classifyIntentHybrid(resolvedQuery, role, 0.5);
    resolvedEntities = {
      ...resolvedEntities,
      ...classification.entities,
      ...(parsedDate ? { date: parsedDate.isoDate, day: parsedDate.humanReadable } : {}),
    };
    steps.push({
      step: 'intent-classification',
      status: 'success',
      detail: `Намір: ${classification.intent} (впевненість: ${classification.confidence.toFixed(2)}, метод: ${classification.method})`,
      data: classification,
    });

    // ── Шаг 4: Multi-Query rewriting (Шаг 4.8) ──────────────────
    const queries = await this.rewriteQuery(resolvedQuery);
    steps.push({
      step: 'query-rewriting',
      status: queries.length > 1 ? 'success' : 'skipped',
      detail: queries.length > 1
        ? `Згенеровано ${queries.length} варіантів запиту`
        : 'Рерайт недоступний, використовуємо оригінальний запит',
      data: queries,
    });

    // ── Шаг 5: Параллельный гибридный поиск по всем вариантам ───
    const allResults = await Promise.all(
      queries.map(q => this.retriever.searchHybrid(q, 5, role, 0.6))
    );

    // Объединяем и дедуплицируем по id
    const seen = new Set<string>();
    let searchResults: SearchResult[] = [];
    for (const results of allResults) {
      for (const r of results) {
        if (!seen.has(r.chunk.id)) {
          seen.add(r.chunk.id);
          searchResults.push(r);
        }
      }
    }
    searchResults.sort((a, b) => b.score - a.score);
    searchResults = searchResults.slice(0, 8);

    // Если результаты слабые — попробуем расширенный поиск
    const bestScore = searchResults.length > 0 ? searchResults[0].score : 0;
    if (bestScore < 0.3 && searchResults.length < 3) {
      steps.push({
        step: 'retrieval',
        status: 'retry',
        detail: `Слабкий результат (${bestScore.toFixed(3)}), пробуємо розширений пошук`,
      });
      const expandedQuery = this.expandQuery(resolvedQuery, classification.intent);
      const expandedResults = await this.retriever.searchHybrid(expandedQuery, 5, role, 0.5);

      // Дополняем уже найденные результаты, дедуплицируя по id
      for (const r of expandedResults) {
        if (!seen.has(r.chunk.id)) {
          seen.add(r.chunk.id);
          searchResults.push(r);
        }
      }
      searchResults.sort((a, b) => b.score - a.score);
      searchResults = searchResults.slice(0, 8);
    }

    steps.push({
      step: 'retrieval',
      status: 'success',
      detail: `Знайдено ${searchResults.length} унікальних чанків. Найкращий результат: ${searchResults[0]?.score.toFixed(3) ?? '0.000'}`,
      data: searchResults.slice(0, 3),
    });

    // ── Шаг 6: Реранкинг через LLM (Шаг 4.7) ────────────────────
    const reranked = await this.rerankChunks(resolvedQuery, searchResults, 3);
    steps.push({
      step: 'rerank',
      status: 'success',
      detail: `Після реранкінгу залишено ${reranked.length} чанків`,
      data: reranked.map(r => ({ id: r.chunk.id, score: r.score })),
    });

    return {
      classification,
      resolvedEntities,
      parsedDate,
      searchResults: reranked,
      steps,
      finalQuery: resolvedQuery,
    };
  }

  /**
   * Расширяет запрос синонимами в зависимости от намерения.
   */
  private expandQuery(query: string, intent: string): string {
    const expansions: Record<string, string> = {
      schedule_group: 'розклад занять групи пари дзвінки',
      schedule_teacher: 'розклад викладача консультації',
      schedule_room: 'розклад аудиторії бронювання',
      admission_rules: 'правила прийому вступ умови',
      documents: 'довідка документи навчання',
    };
    const extra = expansions[intent] || '';
    return `${query} ${extra}`.trim();
  }

  /**
   * Query Rewriting (Шаг 4.8).
   * Генерирует 2-3 альтернативных формулировки запроса через LLM
   * для повышения полноты поиска. При недоступности LLM возвращает
   * только оригинальный запрос.
   */
  private async rewriteQuery(query: string): Promise<string[]> {
    if (!CONFIG.GROQ_PROXY_URL) return [query];

    const prompt = `Перефразуй запит користувача 3 різними способами для кращого пошуку.
Запит: "${query}"
Поверни JSON-масив з 3 рядків. Тільки JSON.`;

    try {
      const response = await fetch(CONFIG.GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: prompt,
          system_prompt: 'Ти — експерт з пошукових запитів. Відповідай лише JSON-масивом.',
        }),
      });
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content || data?.response || '';
      const match = typeof raw === 'string' ? raw.match(/\[[\s\S]*\]/) : null;
      const parsed = match ? JSON.parse(match[0]) : [];

      // Оставляем только непустые строки, отличные от оригинала
      const queries: string[] = Array.isArray(parsed)
        ? parsed
            .filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
            .slice(0, 3)
        : [];

      return [query, ...queries];
    } catch (e) {
      console.warn('[RewriteQuery] Failed:', e);
      return [query];
    }
  }

  /**
   * Переранжирование результатов через LLM (Шаг 4.7).
   * LLM оценивает релевантность каждого чанка запросу (0..10),
   * затем исходный score комбинируется с LLM-оценкой.
   */
  private async rerankChunks(
    query: string,
    chunks: SearchResult[],
    topK: number = 3
  ): Promise<SearchResult[]> {
    if (chunks.length <= topK) return chunks;

    if (!CONFIG.GROQ_PROXY_URL) {
      return chunks.slice(0, topK);
    }

    const scoringPrompt = `Оціни релевантність кожного фрагмента до запиту користувача.
Запит: "${query}"

Фрагменти:
${chunks.map((c, i) => `[${i}] ${c.chunk.text.slice(0, 300)}`).join('\n\n')}

Поверни JSON-масив з оцінками від 0 до 10 для кожного фрагмента, наприклад: [8, 3, 9, 1, 5]
Тільки JSON, без пояснень.`;

    try {
      const response = await fetch(CONFIG.GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: scoringPrompt,
          system_prompt: 'Ти — експерт з оцінки релевантності. Відповідай лише JSON-масивом.',
        }),
      });
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content || data?.response || '';
      const match = typeof raw === 'string' ? raw.match(/\[[\d,\s]+\]/) : null;
      const scores: number[] = JSON.parse(match?.[0] || '[]');

      if (scores.length === chunks.length) {
        const llmNorm = scores.map(s => s / 10);
        return chunks
          .map((c, i) => ({ ...c, score: c.score * 0.3 + llmNorm[i] * 0.7 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      }

      console.warn('[Rerank] LLM returned wrong number of scores:', scores.length, 'expected:', chunks.length);
    } catch (e) {
      console.warn('[Rerank] Failed:', e);
    }

    return chunks.slice(0, topK);
  }
}
