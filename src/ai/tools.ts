// src/ai/tools.ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'search_knowledge_base',
    description: 'Пошук інформації в базі знань ХАІ. Використовуй для будь-яких питань про університет.',
    parameters: {
      query: { type: 'string', description: 'Пошуковий запит', required: true },
      top_k: { type: 'number', description: 'Кількість результатів (за замовчуванням 5)' },
    },
  },
  {
    name: 'scrape_webpage',
    description: 'Завантажити та проаналізувати вміст веб-сторінки за URL.',
    parameters: {
      url: { type: 'string', description: 'URL сторінки', required: true },
    },
  },
  {
    name: 'calculate',
    description: 'Виконати математичні обчислення (наприклад, конкурсний бал).',
    parameters: {
      expression: { type: 'string', description: 'Математичний вираз', required: true },
    },
  },
  {
    name: 'get_current_date',
    description: 'Отримати поточну дату та день тижня.',
    parameters: {},
  },
];
