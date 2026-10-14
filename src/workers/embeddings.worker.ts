import { pipeline, env } from '@xenova/transformers';

env.allowRemoteModels = true;
env.allowLocalModels = false;

let embedderPipeline: any = null;
let isInitializing = false;

async function getEmbedder() {
  if (embedderPipeline) return embedderPipeline;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 50));
    }
    return embedderPipeline;
  }
  isInitializing = true;
  try {
    self.postMessage({ type: 'status', status: 'loading_model' });
    embedderPipeline = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      { quantized: true }
    );
    self.postMessage({ type: 'status', status: 'model_loaded' });
  } finally {
    isInitializing = false;
  }
  return embedderPipeline;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'embed') {
    try {
      const embedder = await getEmbedder();
      const output = await embedder(payload.text, {
        pooling: 'mean',
        normalize: true,
      });
      self.postMessage({
        type: 'embed_result',
        id: payload.id,
        vector: Array.from(output.data),
      });
    } catch (err) {
      self.postMessage({ type: 'embed_error', id: payload.id, error: String(err) });
    }
  }

  if (type === 'embed_batch') {
    try {
      const embedder = await getEmbedder();
      const vectors: number[][] = [];
      for (const text of payload.texts) {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        vectors.push(Array.from(output.data));
      }
      self.postMessage({ type: 'embed_batch_result', id: payload.id, vectors });
    } catch (err) {
      self.postMessage({ type: 'embed_batch_error', id: payload.id, error: String(err) });
    }
  }
};
