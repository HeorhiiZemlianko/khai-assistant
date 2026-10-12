import { classifyIntent } from '../src/ai/intent-classifier';
import { BM25Retriever } from '../src/ai/retrieval';
import { generateTemplateResponse } from '../src/ai/response-templates';
import { validateResponse } from '../src/ai/quality-gate';
import seedData from '../src/data/seed-knowledge.json';

const retriever = new BM25Retriever();
retriever.index(seedData);

const scenarios = [
  { query: 'Сформуй мені розклад на наступний понеділок для групи 545б', role: 'Студент' },
  { query: 'Які правила прийому?', role: 'Абітурієнт' },
  { query: 'Наукові конференції', role: 'Викладач' },
  { query: 'Публікації', role: 'Викладач' },
  { query: 'Абракадабра123', role: 'Студент' }
];

console.log('================ TESTING AI CORE SCENARIOS ================');

for (const s of scenarios) {
  console.log(`\n-----------------------------------------------------------`);
  console.log(`ЗАПИТ: "${s.query}" (Роль: ${s.role})`);
  
  // 1. Classification
  const classification = classifyIntent(s.query, s.role);
  console.log(`ІНТЕНТ: ${classification.intent} (Confidence: ${classification.confidence.toFixed(2)})`);
  console.log(`ENTITIES:`, classification.entities);

  // 2. Retrieval
  const results = retriever.search(s.query, 5, s.role);
  const bestScore = results.length > 0 ? results[0].score : 0;
  console.log(`RETRIEVAL: Top score = ${bestScore.toFixed(3)}, Top chunk title = "${results[0]?.chunk.title || 'None'}"`);

  // 3. Response Generation
  const finalIntent = (bestScore < 0.15 && classification.intent === 'unknown') ? 'unknown' : classification.intent;
  const response = generateTemplateResponse(
    finalIntent,
    classification.entities,
    results.map(r => r.chunk),
    s.role,
    s.query
  );

  // 4. Quality Gate
  const quality = validateResponse(response);
  console.log(`QUALITY GATE: Valid = ${quality.isValid} ${quality.reason ? `(${quality.reason})` : ''}`);
  
  console.log(`\nВІДПОВІДЬ:`);
  console.log(response);
}

console.log('\n================ ALL SCENARIOS COMPLETED ================');
