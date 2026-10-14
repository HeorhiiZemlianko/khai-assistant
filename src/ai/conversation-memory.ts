export interface Message {
  sender: 'user' | 'bot';
  text: string;
  intent?: string;
  entities?: Record<string, any>;
  timestamp: number;
}

/**
 * Хранит последние N сообщений и извлекает из них контекст
 * для разрешения местоимений ("а у них завтра?", "а для него?").
 */
export class ConversationMemory {
  private messages: Message[] = [];
  private maxSize: number;

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
  }

  add(message: Message): void {
    this.messages.push(message);
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getLastUserMessage(): Message | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].sender === 'user') return this.messages[i];
    }
    return null;
  }

  /**
   * Извлекает последние известные сущности из истории.
   * Например, если ранее был запрос про группу 545б,
   * то при запросе "а что у них завтра?" — group=545б.
   */
  getLastKnownEntities(): Record<string, any> {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.sender === 'user' && msg.entities) {
        const meaningful = Object.entries(msg.entities).filter(
          ([_, v]) => v !== undefined && v !== null && v !== ''
        );
        if (meaningful.length > 0) {
          return Object.fromEntries(meaningful);
        }
      }
    }
    return {};
  }

  /**
   * Проверяет, содержит ли запрос местоимения, указывающие
   * на необходимость использования истории.
   */
  needsContextResolution(query: string): boolean {
    const lower = query.toLowerCase();
    const pronouns = [
      'у них', 'у него', 'у неї', 'у неё', 'для них',
      'для него', 'для неї', 'там', 'туди', 'туда',
      'а що', 'а как', 'а як', 'а когда', 'а коли',
    ];
    return pronouns.some(p => lower.includes(p));
  }

  clear(): void {
    this.messages = [];
  }
}
