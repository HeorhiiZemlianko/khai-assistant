# Інтелектуальний помічник ХАІ (Гібридна AI-Архітектура)

Сучасний статичний веб-додаток (SPA) для Національного аерокосмічного університету «ХАІ» ім. М. Є. Жуковського, оптимізований для деплою на **GitHub Pages**.

---

## 🎯 Чому гібридна архітектура, а не малі браузерні LLM?
Попередні експерименти з браузерними моделями (Phi-3, TinyLlama, Llama-3.2-3B) показали, що вони англоцентричні та генерують спотворений текст («галюцинації», випадкові символи або повторення) під час спроби відповісти українською мовою.

У новій версії впроваджено **5-шарову надійну гібридну архітектуру**, яка гарантує 100% граматичну коректність, структурованість та достовірність відповідей.

---

## 🏗️ Архітектура AI-ядра

```
[Запит користувача + Роль]
           │
           ▼
[Слой 1: Класифікатор намірів (NLU)] ──► Витяг entities (група, викладач, день, тощо)
           │
           ▼
[Слой 2: Пошук BM25 (Retrieval)] ─────► Зважування заголовків (2.5x) та ролей (1.3x)
           │
           ▼
[Слой 3/4: Генерація відповіді]
   ├── Confidence < 0.4 та налаштовано Groq? ──► [Groq API / Llama-3.3-70B через Worker]
   └── Інакше / Fallback ─────────────────────► [Людські структуровані шаблони ХАІ]
           │
           ▼
[Слой 5: Quality Gate (Валідація)] ───► Перевірка на повтори, дегенерацію, кодування
           │
           ▼
[Відображення користувачу + Офіційні посилання]
```

### 1. Слой 1: Класифікатор намірів (`src/ai/intent-classifier.ts`)
- Визначає інтенції: `schedule_group`, `schedule_teacher`, `schedule_room`, `admission_rules`, `admission_specialties`, `admission_score`, `documents`, `dormitory`, `conferences`, `publications`, `contacts`, `platforms`, `payment`, `scholarship`, `unknown`.
- Витягує сутності: номер групи (`545б`, `525ст`), викладач, аудиторія (`227с`), день тижня, код спеціальності (`134`, `121`).
- Працює миттєво без важких ML-моделей.

### 2. Слой 2: Пошук та ранжування BM25 (`src/ai/retrieval.ts`)
- Локальний рушій **BM25**.
- Заголовки чанків мають пріоритет (2.5x).
- Ролі користувача (Студент, Викладач, Абітурієнт, Адміністрація) динамічно коригують оцінку релевантності.
- Повертає топ-5 найбільш релевантних фрагментів.

### 3. Слой 3: Шаблонний генератор (`src/ai/response-templates.ts`)
- Більше 10 професійно підготовлених шаблонів з живим людським тоном, емодзі, списками та прямими посиланнями на ресурси ХАІ.

### 4. Слой 4: Опціональний Groq API (`src/ai/llm-groq.ts`)
- Використовує надпотужну модель `llama-3.3-70b-versatile` для складних випадків через безпечний Cloudflare Worker proxy.
- Якщо проксі не налаштовано — система автоматично й безперебійно працює в надійному шаблонному режимі.

### 5. Слой 5: Quality Gate (`src/ai/quality-gate.ts`)
- Перевіряє довжину відповіді (30 – 2500 символів).
- Блокує дегенерацію та повтори фраз довжиною >22 символів.
- Контролює допустимі діапазони Unicode та відсоток кирилиці.

---

## ⚡ Як налаштувати опціональний Groq API (Cloudflare Worker)

Якщо ви хочете підключити Llama-3.3-70B через Groq:

1. Зареєструйтесь безкоштовно на [Groq Console](https://console.groq.com).
2. Створіть API-ключ у розділі **API Keys**.
3. Створіть безкоштовний воркер у [Cloudflare Workers](https://workers.cloudflare.com):
   ```javascript
   // Cloudflare Worker Script
   export default {
     async fetch(request, env) {
       const corsHeaders = {
         'Access-Control-Allow-Origin': '*',
         'Access-Control-Allow-Methods': 'POST, OPTIONS',
         'Access-Control-Allow-Headers': 'Content-Type',
       };

       if (request.method === 'OPTIONS') {
         return new Response(null, { headers: corsHeaders });
       }

       try {
         const { query, context, role, system_prompt, user_prompt } = await request.json();
         const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${env.GROQ_API_KEY}`,
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             model: 'llama-3.3-70b-versatile',
             messages: [
               { role: 'system', content: system_prompt },
               { role: 'user', content: user_prompt }
             ],
             temperature: 0.4,
             max_tokens: 600,
           }),
         });

         const data = await groqRes.json();
         return new Response(JSON.stringify(data), {
           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
         });
       } catch (e) {
         return new Response(JSON.stringify({ error: e.message }), {
           status: 500,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
         });
       }
     }
   };
   ```
4. У налаштуваннях воркера додайте секретну змінну середовища: `GROQ_API_KEY`.
5. Вставте URL отриманого воркера у файл `src/config.ts`:
   ```typescript
   export const CONFIG = {
     GROQ_PROXY_URL: "https://your-worker.your-subdomain.workers.dev",
     ...
   };
   ```
6. **Якщо `GROQ_PROXY_URL` порожній (`""`), додаток повністю працює на швидких вбудованих шаблонах без жодних зовнішніх запитів.**

---

## 🚀 Запуск та розробка

### 1. Встановлення залежностей:
```bash
npm install
```

### 2. Запуск локального сервера розробки:
```bash
npm run dev
```

### 3. Оновлення бази знань (скрепінг сайтів ХАІ):
```bash
npm run scrape
```

### 4. Збірка для GitHub Pages:
```bash
npm run build
```
Вміст директорії `dist` готовий для публікації на GitHub Pages.
Base URL налаштовано в `vite.config.js` (`/khai-assistant/`).
