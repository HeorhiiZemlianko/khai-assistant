let worker: Worker | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: Function; reject: Function }>();

type StatusListener = (status: string) => void;
const statusListeners = new Set<StatusListener>();

/**
 * Подписка на статусы загрузки модели из Worker.
 * @returns функция отписки
 */
export function onModelStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function emitStatus(status: string): void {
  for (const fn of statusListeners) {
    try {
      fn(status);
    } catch (e) {
      console.error('[Embeddings] status listener error:', e);
    }
  }
}

/**
 * Ленивая инициализация Web Worker для эмбеддингов.
 * Worker загружает модель paraphrase-multilingual-MiniLM-L12-v2
 * (поддерживает украинский), чтобы не блокировать главный поток.
 */
function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('../workers/embeddings.worker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event) => {
    const { type, id, vector, vectors, error, status } = event.data;

    // Служебные сообщения о статусе (загрузка модели и т.п.)
    if (type === 'status') {
      console.log(`[Embeddings Worker] ${status}`);
      emitStatus(status);
      return;
    }

    const handler = pending.get(id);
    if (!handler) return;
    pending.delete(id);

    if (error) {
      handler.reject(new Error(error));
    } else if (vector) {
      handler.resolve(new Float32Array(vector));
    } else if (vectors) {
      handler.resolve(vectors.map((v: number[]) => new Float32Array(v)));
    } else {
      handler.reject(new Error('Unknown worker response'));
    }
  };

  worker.onerror = (err) => {
    console.error('[Embeddings Worker] error:', err);
    // Отклоняем все ожидающие промисы
    for (const [id, handler] of pending) {
      handler.reject(new Error(err.message || 'Worker error'));
      pending.delete(id);
    }
  };

  return worker;
}

function sendToWorker(type: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type, payload: { ...payload, id } });
  });
}

/**
 * Получить эмбеддинг для одного текста.
 * @returns Float32Array нормализованный вектор
 */
export async function embedText(text: string): Promise<Float32Array> {
  return sendToWorker('embed', { text });
}

/**
 * Получить эмбеддинги для массива текстов (батчем).
 * @returns массив нормализованных векторов
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  return sendToWorker('embed_batch', { texts });
}

/**
 * Косинусное сходство между двумя нормализованными векторами.
 * Поскольку векторы нормализованы, косинус = скалярное произведение.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
