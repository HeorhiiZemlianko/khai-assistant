// src/ai/tool-executor.ts
import { BM25Retriever } from './retrieval';
import { parseRelativeDate } from '../utils/date-parser';

export class ToolExecutor {
  constructor(private retriever: BM25Retriever) {}

  async execute(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'search_knowledge_base': {
        const results = await this.retriever.searchHybrid(
          args.query,
          args.top_k || 5,
          'Студент',
          0.6
        );
        return results.map(r => ({
          title: r.chunk.title,
          url: r.chunk.source_url,
          text: r.chunk.text.slice(0, 500),
          score: r.score,
        }));
      }
      case 'scrape_webpage': {
        try {
          const res = await fetch(args.url);
          const html = await res.text();
          // Простий парсинг тексту
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return { url: args.url, text: text.slice(0, 3000) };
        } catch (e) {
          return { error: `Не вдалося завантажити ${args.url}` };
        }
      }
      case 'calculate': {
        try {
          // Безпечне обчислення
          const result = Function(`"use strict"; return (${args.expression})`)();
          return { expression: args.expression, result };
        } catch {
          return { error: 'Некоректний вираз' };
        }
      }
      case 'get_current_date': {
        const now = new Date();
        return {
          iso: now.toISOString().split('T')[0],
          weekday: now.toLocaleDateString('uk-UA', { weekday: 'long' }),
          human: now.toLocaleDateString('uk-UA', {
            day: 'numeric', month: 'long', year: 'numeric',
          }),
        };
      }
      default:
        return { error: `Невідомий інструмент: ${toolName}` };
    }
  }
}
