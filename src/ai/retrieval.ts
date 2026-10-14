import { embedBatch, cosineSimilarity } from './embeddings';

export interface KnowledgeChunk {
  id: string;
  title?: string;
  source_url: string;
  category: string;
  roles: string[];
  text: string;
  keywords?: string[];
  last_updated?: string;
}

export interface SearchResult {
  score: number;
  chunk: KnowledgeChunk;
}

const K1 = 1.2;
const B = 0.75;

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[.,!?;:()«»""''`]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

export class BM25Retriever {
  private documents: KnowledgeChunk[] = [];
  private docTokens: string[][] = [];
  private titleTokens: string[][] = [];
  private df: Record<string, number> = {};
  private docLengths: number[] = [];
  private avgdl: number = 0;
  private n: number = 0;

  private embeddings: Float32Array[] = [];
  private embeddingsIndexed = false;

  constructor() {}

  public index(documents: KnowledgeChunk[]): void {
    this.documents = documents;
    this.n = documents.length;
    this.docTokens = [];
    this.titleTokens = [];
    this.df = {};
    this.docLengths = [];

    // при переиндексации сбрасываем эмбеддинги
    this.embeddings = [];
    this.embeddingsIndexed = false;

    let totalLength = 0;
    const categoriesSet = new Set<string>();

    documents.forEach(doc => {
      if (doc.category) categoriesSet.add(doc.category);

      const titleToks = tokenize(doc.title || '');
      const textToks = tokenize(doc.text || '');
      const kwToks = doc.keywords ? doc.keywords.flatMap(kw => tokenize(kw)) : [];

      const allTokens = [...titleToks, ...textToks, ...kwToks];
      this.docTokens.push(allTokens);
      this.titleTokens.push(titleToks);

      const length = allTokens.length;
      this.docLengths.push(length);
      totalLength += length;

      const uniqueTokens = new Set(allTokens);
      uniqueTokens.forEach(token => {
        this.df[token] = (this.df[token] || 0) + 1;
      });
    });

    this.avgdl = this.n > 0 ? totalLength / this.n : 1;
    console.log(`Knowledge base loaded: ${this.n} chunks, ${categoriesSet.size} categories`);
  }

  public search(query: string, topK: number = 5, role: string = 'Студент'): SearchResult[] {
    if (this.n === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores = new Array(this.n).fill(0);

    queryTokens.forEach(token => {
      const docFreq = this.df[token];
      if (!docFreq) return;

      // IDF
      const idf = Math.log((this.n - docFreq + 0.5) / (docFreq + 0.5) + 1);

      for (let i = 0; i < this.n; i++) {
        const doc = this.documents[i];

        // Term frequency in all tokens
        const tf = this.docTokens[i].filter(t => t === token).length;
        if (tf === 0) continue;

        // Extra boost if term appears in title
        const inTitleCount = this.titleTokens[i].filter(t => t === token).length;
        const titleWeightBoost = inTitleCount > 0 ? 2.5 : 1.0;

        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (this.docLengths[i] / (this.avgdl || 1)));

        let termScore = idf * (numerator / denominator) * titleWeightBoost;

        // Role adjustment
        if (doc.roles && doc.roles.length > 0) {
          if (doc.roles.includes(role) || doc.roles.includes('Всі')) {
            termScore *= 1.3;
          } else {
            termScore *= 0.7;
          }
        }

        scores[i] += termScore;
      }
    });

    const results: SearchResult[] = scores
      .map((score, index) => ({
        score,
        chunk: this.documents[index]
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  /**
   * Асинхронная индексация эмбеддингов для всех чанков (батчами).
   * Вызывать после index(documents).
   */
  async buildEmbeddingIndex(): Promise<void> {
    if (this.embeddingsIndexed) return;
    console.log('[Retrieval] Building embedding index...');
    const start = Date.now();

    const texts = this.documents.map(
      (chunk) => `${chunk.title || ''} ${chunk.text}`.trim()
    );

    const BATCH_SIZE = 8;
    this.embeddings = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const vecs = await embedBatch(batch);
      this.embeddings.push(...vecs);
      console.log(`[Retrieval] Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
    }

    this.embeddingsIndexed = true;
    console.log(`[Retrieval] Embedding index built in ${Date.now() - start}ms`);
  }

  /**
   * Гибридный поиск: BM25 + семантическое сходство.
   * @param alpha Вес BM25 (0..1). 1 = только BM25, 0 = только семантика.
   */
  async searchHybrid(
    query: string,
    topK: number = 5,
    role: string = 'Студент',
    alpha: number = 0.6
  ): Promise<SearchResult[]> {
    // 1. BM25-результаты (берём с запасом)
    const bm25Results = this.search(query, topK * 2, role);

    // 2. Если эмбеддинги не построены — вернуть только BM25
    if (!this.embeddingsIndexed || this.embeddings.length === 0) {
      console.log('[Retrieval] Embeddings not ready, using BM25 only');
      return bm25Results.slice(0, topK);
    }

    // 3. Эмбеддинг запроса (одиночный — через embedBatch удобнее не гонять,
    //    но т.к. embedText убран из импорта, используем embedBatch([query]))
    const [queryVec] = await embedBatch([query]);

    // 4. Семантические оценки для всех чанков
    const semanticScores: number[] = this.embeddings.map((emb) =>
      cosineSimilarity(queryVec, emb)
    );

    // 5. Нормализация BM25-оценок в [0, 1]
    const maxBm25 = Math.max(...bm25Results.map((r) => r.score), 1e-6);
    const bm25Map = new Map<number, number>();

    const idToIndex = new Map<string, number>();
    this.documents.forEach((doc, idx) => idToIndex.set(doc.id, idx));

    bm25Results.forEach((r) => {
      const idx = idToIndex.get(r.chunk.id);
      if (idx !== undefined) {
        bm25Map.set(idx, r.score / maxBm25);
      }
    });

    // 6. Нормализация семантических оценок в [0, 1]
    const minSem = Math.min(...semanticScores);
    const maxSem = Math.max(...semanticScores, 1e-6);
    const semRange = maxSem - minSem || 1;

    // 7. Объединённая оценка
    const combined: SearchResult[] = [];

    for (let i = 0; i < this.documents.length; i++) {
      const bm25Norm = bm25Map.get(i) ?? 0;
      const semNorm = (semanticScores[i] - minSem) / semRange;
      const finalScore = alpha * bm25Norm + (1 - alpha) * semNorm;

      if (finalScore > 0.01) {
        combined.push({
          score: finalScore,
          chunk: this.documents[i]
        });
      }
    }

    // 8. Сортировка и топ-K
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, topK);
  }
}
