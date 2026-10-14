import { parseRelativeDate, ParsedDate } from '../utils/date-parser';
import { ConversationMemory } from './conversation-memory';
import { classifyIntentHybrid, HybridClassificationResult, ExtractedEntities } from './intent-classifier';
import { BM25Retriever, SearchResult } from './retrieval';

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
        // Подставляем сущности из истории в запрос
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
    // Дополняем сущности из истории и парсинга дат
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

    // ── Шаг 4: Поиск (гибридный) ────────────────────────────────
    let searchResults = await this.retriever.searchHybrid(
      resolvedQuery,
      5,
      role,
      0.6
    );

    // Если результаты слабые — попробуем расширенный поиск
    const bestScore = searchResults.length > 0 ? searchResults[0].score : 0;
    if (bestScore < 0.3 && searchResults.length < 3) {
      steps.push({
        step: 'retrieval',
        status: 'retry',
        detail: `Слабкий результат (${bestScore.toFixed(3)}), пробуємо розширений пошук`,
      });
      // Расширенный поиск: добавляем синонимы и ключевые слова
      const expandedQuery = this.expandQuery(resolvedQuery, classification.intent);
      searchResults = await this.retriever.searchHybrid(expandedQuery, 5, role, 0.5);
    }

    steps.push({
      step: 'retrieval',
      status: 'success',
      detail: `Знайдено ${searchResults.length} чанків. Найкращий результат: ${bestScore.toFixed(3)}`,
      data: searchResults.slice(0, 3),
    });

    return {
      classification,
      resolvedEntities,
      parsedDate,
      searchResults,
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
}
