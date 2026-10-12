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

  constructor() {}

  public index(documents: KnowledgeChunk[]): void {
    this.documents = documents;
    this.n = documents.length;
    this.docTokens = [];
    this.titleTokens = [];
    this.df = {};
    this.docLengths = [];

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

        // Role adjustment: boost if role matches, slight penalty if explicit mismatch
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

    // Map, sort, and filter
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
}
