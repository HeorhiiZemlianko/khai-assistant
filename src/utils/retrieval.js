// Simple BM25 Implementation
const k1 = 1.2;
const b = 0.75;

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[.,!?;:()]/g, '').split(/\s+/).filter(w => w.length > 2);
}

export class BM25 {
  constructor() {
    this.documents = [];
    this.docTokens = [];
    this.df = {};
    this.docLengths = [];
    this.avgdl = 0;
    this.N = 0;
  }

  index(documents) {
    this.documents = documents;
    this.N = documents.length;
    let totalLength = 0;

    documents.forEach((doc, i) => {
      const tokens = tokenize(doc.text + ' ' + (doc.keywords ? doc.keywords.join(' ') : ''));
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach(token => {
        if (!this.df[token]) this.df[token] = 0;
        this.df[token]++;
      });
    });

    this.avgdl = totalLength / this.N;
  }

  search(query, topK = 5, role = null) {
    const queryTokens = tokenize(query);
    const scores = new Array(this.N).fill(0);

    queryTokens.forEach(token => {
      if (!this.df[token]) return;
      
      const idf = Math.log((this.N - this.df[token] + 0.5) / (this.df[token] + 0.5) + 1);

      for (let i = 0; i < this.N; i++) {
        const doc = this.documents[i];
        
        // Filter by role
        if (role && doc.roles && doc.roles.length > 0 && !doc.roles.includes(role) && !doc.roles.includes('Всі')) {
          continue;
        }

        const tf = this.docTokens[i].filter(t => t === token).length;
        if (tf === 0) continue;

        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (this.docLengths[i] / this.avgdl));
        
        scores[i] += idf * (numerator / denominator);
      }
    });

    // Add extra score for exact intent keyword matches if any (optional enhancement)

    const results = scores.map((score, index) => ({
      score,
      chunk: this.documents[index]
    }))
    .filter(res => res.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

    return results;
  }
}
