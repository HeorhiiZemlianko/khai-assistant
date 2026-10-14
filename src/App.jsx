import React, { useState, useEffect, useRef } from 'react';
import { Send, User, Bot, ArrowLeft, Loader2, Sparkles, AlertCircle, Compass } from 'lucide-react';

// .ts
import { classifyIntentHybrid } from './ai/intent-classifier.ts';
import { BM25Retriever } from './ai/retrieval.ts';
import { generateTemplateResponse } from './ai/response-templates.ts';
import { validateResponse } from './ai/quality-gate.ts';
import { queryGroqLLM } from './ai/llm-groq.ts';
import { CONFIG } from './config.ts';
import seedData from './data/seed-knowledge.json';
import { AgentCore } from './ai/agent-core.ts';
import { ConversationMemory } from './ai/conversation-memory.ts';

const ROLES = {
  STUDENT: 'Студент',
  TEACHER: 'Викладач',
  ADMIN: 'Адміністрація',
  APPLICANT: 'Абітурієнт'
};

const FAST_ACTIONS = {
  [ROLES.STUDENT]: ['Мій розклад', 'Довідка про навчання', 'Запис на перездачу', 'Навчальні платформи', 'Гуртожиток'],
  [ROLES.TEACHER]: ['Розклад занять', 'Наукові конференції', 'Публікації', 'Бронювання аудиторій'],
  [ROLES.ADMIN]: ['Правила прийому', 'Накази та документи', 'Статистика', 'Контакти підрозділів'],
  [ROLES.APPLICANT]: ['Правила прийому', 'Спеціальності', 'Конкурсний бал', 'Вартість навчання', 'Гуртожиток']
};

const SMART_SUGGESTIONS = {
  schedule: ['Сформуй мені розклад для групи 545б на понеділок', 'Розклад викладача Землянко', 'Аудиторія 227с розклад'],
  admission: ['Які правила прийому до ХАІ?', 'Які є спеціальності на бакалавраті?', 'Який мінімальний конкурсний бал на бюджет?'],
  science: ['Наукові конференції ХАІ', 'Де шукати публікації та фахові журнали?'],
  documents: ['Як отримати довідку про навчання?', 'Які документи потрібні для гуртожитку?']
};

export default function App() {
  const [role, setRole] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingKB, setLoadingKB] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const retrieverRef = useRef(new BM25Retriever());
  const memoryRef = useRef(new ConversationMemory(10)); // храним последние 10 сообщений
  const agentRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Load Knowledge Base: combine seed facts + scraped chunks
    const loadKnowledge = async () => {
      try {
        let chunks = [...seedData];
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}knowledge_base.json`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              chunks = [...seedData, ...data];
            }
          }
        } catch (fetchErr) {
          console.warn('[Knowledge Base] Failed to fetch external JSON, using seed data:', fetchErr);
        }

        retrieverRef.current.index(chunks);

        // Асинхронно строим эмбеддинги (не блокируем UI)
        retrieverRef.current
          .buildEmbeddingIndex()
          .catch((e) => console.warn('[App] Embedding index build failed:', e));

        setLoadingKB(false);
      } catch (err) {
        console.error('[Knowledge Base] Critical error initializing knowledge base:', err);
        retrieverRef.current.index(seedData);
        // Построим эмбеддинги и для fallback-набора
        retrieverRef.current
          .buildEmbeddingIndex()
          .catch((e) => console.warn('[App] Embedding index build failed (fallback):', e));
        setLoadingKB(false);
      }
    };

    loadKnowledge();
  }, []);

  // После инициализации ретривера создаём агент
  useEffect(() => {
    if (!loadingKB && retrieverRef.current) {
      agentRef.current = new AgentCore(retrieverRef.current, memoryRef.current);
      console.log('[App] AgentCore initialized');
    }
  }, [loadingKB]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole);
    // Очищаем память при смене роли, чтобы не тащить контекст прошлой сессии
    memoryRef.current.clear?.();
    setMessages([{
      sender: 'bot',
      text: `Вітаю! Я інтелектуальний помічник Національного аерокосмічного університету «ХАІ» ✈️\n\nЧим можу допомогти вам як **${selectedRole.toLowerCase()}у**? Виберіть дію зі списку або задайте будь-яке питання про розклад, вступ, навчання, гуртожиток чи наукову діяльність.`
    }]);
  };

  const handleInputChange = (e) => {
    const text = e.target.value;
    setInput(text);

    if (text.trim().length >= 3) {
      const lower = text.toLowerCase();
      if (lower.includes('розклад') || lower.includes('пара') || lower.includes('груп')) {
        setSuggestions(SMART_SUGGESTIONS.schedule);
      } else if (lower.includes('вступ') || lower.includes('бал') || lower.includes('спеці')) {
        setSuggestions(SMART_SUGGESTIONS.admission);
      } else if (lower.includes('наук') || lower.includes('конфер') || lower.includes('статт')) {
        setSuggestions(SMART_SUGGESTIONS.science);
      } else if (lower.includes('довідк') || lower.includes('документ') || lower.includes('гуртож')) {
        setSuggestions(SMART_SUGGESTIONS.documents);
      } else {
        setSuggestions([]);
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || isProcessing) return;

    setInput('');
    setSuggestions([]);
    setMessages(prev => [...prev, { sender: 'user', text: query }]);

    // Сохраняем сообщение пользователя в память
    memoryRef.current.add({
      sender: 'user',
      text: query,
      timestamp: Date.now(),
    });

    setIsProcessing(true);

    try {
      // ── Запуск агента ──────────────────────────────────────────
      const agentResult = await agentRef.current.process(query, role || 'Студент');

      // Логируем шаги агента
      console.log('[Agent] Steps:', agentResult.steps);
      console.log('[Agent] Resolved entities:', agentResult.resolvedEntities);
      console.log('[Agent] Parsed date:', agentResult.parsedDate);

      const { classification, resolvedEntities, searchResults, finalQuery } = agentResult;
      const topChunks = searchResults.map(r => r.chunk);
      const bestScore = searchResults.length > 0 ? searchResults[0].score : 0;

      // ── Генерация ответа (LLM или шаблон) ──────────────────────
      let candidateResponse = '';
      let usedGroq = false;

      if (
        CONFIG.GROQ_PROXY_URL &&
        topChunks.length > 0 &&
        (classification.confidence < CONFIG.LOW_CONFIDENCE_THRESHOLD ||
          classification.intent === 'unknown' ||
          bestScore >= CONFIG.MIN_RELEVANCE_SCORE)
      ) {
        const groqResult = await queryGroqLLM(finalQuery, topChunks, role || 'Студент');
        if (groqResult) {
          candidateResponse = groqResult;
          usedGroq = true;
        }
      }

      if (!candidateResponse) {
        const finalIntent = (bestScore < CONFIG.MIN_RELEVANCE_SCORE && classification.intent === 'unknown')
          ? 'unknown'
          : classification.intent;
        candidateResponse = generateTemplateResponse(
          finalIntent,
          resolvedEntities,
          topChunks,
          role || 'Студент',
          finalQuery
        );
      }

      // ── Quality Gate ───────────────────────────────────────────
      const validation = validateResponse(candidateResponse);
      let finalResponse = candidateResponse;
      if (!validation.isValid) {
        finalResponse = generateTemplateResponse(
          classification.intent,
          resolvedEntities,
          topChunks,
          role || 'Студент',
          finalQuery
        );
      }

      const sources = Array.from(
        new Set(topChunks.map(c => c.source_url).filter(Boolean))
      ).slice(0, 3);

      // Сохраняем ответ бота в память
      memoryRef.current.add({
        sender: 'bot',
        text: finalResponse,
        intent: classification.intent,
        entities: resolvedEntities,
        timestamp: Date.now(),
      });

      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: finalResponse,
          sources: sources.length > 0 ? sources : undefined,
          intent: classification.intent,
          usedGroq,
        },
      ]);
    } catch (err) {
      console.error('[Agent] Error:', err);
      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: `На жаль, під час обробки запиту виникла помилка. Спробуйте ще раз або зверніться до офіційного порталу ХАІ: https://khai.edu`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 border border-slate-200">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-blue-50 rounded-2xl text-blue-900 mb-3 shadow-inner">
              <Compass size={36} className="text-blue-600 animate-spin-slow" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Інтелектуальний помічник ХАІ</h1>
            <p className="text-sm text-slate-500">Національний аерокосмічний університет</p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 text-center">
            Оберіть вашу роль
          </p>

          <div className="space-y-3 mb-6">
            {Object.values(ROLES).map(r => (
              <button
                key={r}
                onClick={() => handleRoleSelect(r)}
                className="w-full py-3.5 px-5 bg-slate-50 hover:bg-blue-600 hover:text-white text-slate-800 rounded-2xl transition-all duration-200 font-medium border border-slate-200/80 shadow-sm flex items-center justify-between group active:scale-[0.98]"
              >
                <span>{r}</span>
                <span className="text-slate-400 group-hover:text-blue-100 text-sm font-normal">Почати →</span>
              </button>
            ))}
          </div>

          <div className="border-t border-slate-100 pt-4 text-center">
            {loadingKB ? (
              <div className="flex items-center justify-center text-xs text-slate-400 gap-2">
                <Loader2 className="animate-spin text-blue-500" size={14} />
                <span>Ініціалізація бази знань ХАІ...</span>
              </div>
            ) : (
              <div className="text-xs text-emerald-600 font-medium flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>База знань ХАІ готова до роботи</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-white shadow-2xl md:rounded-2xl md:h-[95vh] md:my-auto overflow-hidden border border-slate-200 font-sans">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-800 text-white px-5 py-4 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setRole(null)}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-200 hover:text-white"
            title="Змінити роль"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-bold text-lg flex items-center gap-2 text-white">
              Помічник ХАІ <Sparkles size={16} className="text-amber-300" />
            </h1>
            <p className="text-xs text-blue-200 font-medium">Роль: <span className="text-white font-semibold">{role}</span></p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full text-xs text-blue-100">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Офіційні джерела ХАІ</span>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
        <div className="space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[90%] sm:max-w-[80%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 h-9 w-9 rounded-2xl flex items-center justify-center mt-1 shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 ml-3 text-white'
                    : 'bg-gradient-to-br from-slate-800 to-indigo-950 mr-3 text-amber-300'
                }`}>
                  {msg.sender === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>

                <div className={`p-4 sm:p-5 rounded-3xl shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200/80 rounded-tl-none text-slate-800'
                }`}>
                  <div className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                    {msg.text}
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                        Офіційні джерела:
                      </p>
                      <div className="flex flex-col gap-1">
                        {msg.sources.map((src, i) => (
                          <a
                            key={i}
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate block"
                          >
                            🔗 {src}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isProcessing && (
            <div className="flex justify-start">
              <div className="flex max-w-[85%] flex-row items-center">
                <div className="flex-shrink-0 h-9 w-9 rounded-2xl flex items-center justify-center mr-3 bg-gradient-to-br from-slate-800 to-indigo-950 text-amber-300 shadow-sm">
                  <Bot size={18} />
                </div>
                <div className="px-5 py-3 rounded-2xl shadow-sm bg-white border border-slate-200 flex items-center gap-3">
                  <Loader2 className="animate-spin text-blue-600" size={18} />
                  <span className="text-sm font-medium text-slate-600">Аналізую запит...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Smart Suggestions */}
      {suggestions.length > 0 && (
        <div className="px-4 py-2 bg-slate-100/80 border-t border-slate-200/60 flex gap-2 overflow-x-auto no-scrollbar">
          {suggestions.map((sug, i) => (
            <button
              key={i}
              onClick={() => handleSend(sug)}
              className="whitespace-nowrap text-xs bg-white text-blue-700 px-3.5 py-1.5 rounded-full hover:bg-blue-50 transition-colors border border-blue-200 shadow-xs font-medium"
            >
              💡 {sug}
            </button>
          ))}
        </div>
      )}

      {/* Fast Actions */}
      <div className="px-4 py-2.5 bg-white border-t border-slate-200/80 flex gap-2 overflow-x-auto no-scrollbar">
        {FAST_ACTIONS[role]?.map(action => (
          <button
            key={action}
            onClick={() => handleSend(action)}
            className="flex-shrink-0 px-3.5 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-700 rounded-xl text-xs font-medium transition-colors border border-slate-200"
          >
            {action}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center bg-slate-50 rounded-2xl p-1.5 pl-4 border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all shadow-inner"
        >
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Введіть запитання (наприклад: розклад для 545б, правила прийому, гуртожиток)..."
            className="flex-1 bg-transparent border-none focus:outline-none py-2 text-sm sm:text-base text-slate-800 placeholder-slate-400"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="p-2.5 bg-blue-600 disabled:bg-slate-300 hover:bg-blue-700 text-white rounded-xl transition-all ml-2 shadow-sm flex items-center justify-center active:scale-95"
            title="Надіслати"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
