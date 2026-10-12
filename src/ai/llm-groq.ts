import { CONFIG } from '../config';
import { KnowledgeChunk } from './retrieval';

const SYSTEM_PROMPT_UK = (role: string) => `You are an intelligent assistant for KhAI National Aerospace University (Національний аерокосмічний університет «ХАІ»).
Your user role: ${role}.
LANGUAGE: Respond ONLY in Ukrainian, natural, polite, and human-like.
RULES:
1. Answer ONLY based on the provided context. Do not invent facts.
2. Be warm and helpful, like an experienced university consultant.
3. Structure: brief intro → key info (bullet points if relevant) → action/link.
4. If context lacks the answer, say honestly in Ukrainian and suggest contacting khai.edu.
5. Never repeat phrases. Never output random characters.
6. End with the most relevant source URL.`;

function buildUserPrompt(query: string, chunks: KnowledgeChunk[], role: string): string {
  const contextStr = chunks.slice(0, 3).map((c, i) => {
    return `[Джерело ${i + 1} (${c.source_url})]:\n${c.text}`;
  }).join('\n\n');

  return `Офіційний контекст ХАІ:
${contextStr}

Роль користувача: ${role}
Запитання користувача: ${query}

Сформуй чітку, структуровану відповідь українською мовою на основі наданого контексту.`;
}

export async function queryGroqLLM(
  query: string,
  chunks: KnowledgeChunk[],
  role: string
): Promise<string | null> {
  const proxyUrl = CONFIG.GROQ_PROXY_URL;
  if (!proxyUrl || proxyUrl.trim() === '') {
    // Groq proxy not configured; silently skip to template generator
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        context: chunks.slice(0, 3),
        role,
        system_prompt: SYSTEM_PROMPT_UK(role),
        user_prompt: buildUserPrompt(query, chunks, role),
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Groq Proxy] HTTP error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.response || data?.text;
    
    if (content && typeof content === 'string') {
      return content.trim();
    }
    return null;
  } catch (error) {
    console.warn('[Groq Proxy] Failed to fetch response, falling back to templates:', error);
    return null;
  }
}
