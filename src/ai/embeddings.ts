import { pipeline, env } from '@xenova/transformers';

// Разрешаем загрузку моделей с Hugging Face CDN (по умолчанию)
env.allowRemoteModels = true;
env.allowLocalModels = false;

let embedderPipeline: any = null;
let isInitializing = false;

/**
 * Ленивая инициализация пайплайна эмбеддингов.
 * Модель: paraphrase-multilingual-MiniLM-L12-v2 — поддерживает украинский.
 */
async function getEmbedder() {
  if (embedderPipeline) return embedderPipeline;
  if (isInitializing) {
    // Ждём, пока инициализация завершится
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return embedderPipeline;
  }

  isInitializing = true;
  try {
    console.log('[Embeddings] Loading model...');
    embedderPipeline = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      { quantized: true } // 8-bit квантизация для меньшего размера
    );
    console.log('[Embeddings] Model loaded');
  } finally {
    isInitializing = false;
  }
  return embedderPipeline;
}

/**
 * Получить эмбеддинг для одного текста.
 * @returns Float32Array нормализованный вектор
 */
export async function embedText(text: string): Promise<Float32Array> {
  const embedder = await getEmbedder();
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true,
  });
  return output.data as Float32Array;
}

/**
 * Косинусное сходство между двумя нормализованными векторами.
 * Поскольку векторы нормализованы, косинус = скалярное произведение.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
