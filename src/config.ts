// Application configuration
export const CONFIG = {
  // Cloudflare Worker proxy URL for Groq API (leave empty to use high-quality template generator)
  // Example: "https://khai-assistant-groq-proxy.your-account.workers.dev"
  GROQ_PROXY_URL: import.meta.env.VITE_GROQ_PROXY_URL || 'https://khai-groq-proxy.kibranec2.workers.dev',
  
  // Model name used in Groq
  GROQ_MODEL: "openai/gpt-oss-120b",
  
  // Threshold for classification confidence below which Groq or fallback is considered
  LOW_CONFIDENCE_THRESHOLD: 0.4,
  
  // Threshold for BM25 retrieval score
  MIN_RELEVANCE_SCORE: 0.15,
};
