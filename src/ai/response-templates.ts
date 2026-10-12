import { ExtractedEntities } from './intent-classifier';
import { KnowledgeChunk } from './retrieval';

// Extract key sentences or points from raw text
export function extractKeyPoints(text: string, maxPoints: number = 3): string[] {
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 25 && !s.includes('02. 10.') && !s.includes('01. 10.'));

  return sentences.slice(0, maxPoints);
}

// Format schedule text with nice table/list layout
function formatSchedule(text: string, day?: string, group?: string): string {
  const targetDay = day ? `на ${day}` : 'на поточний тиждень';
  return `📅 **Розклад занять ${targetDay} (чисельник/знаменник):**

• **1 пара (08:00 - 09:35):** Лекційні заняття (онлайн в Mentor / Google Meet)
• **2 пара (09:50 - 11:25):** Практичні / семінарські заняття
• **3 пара (11:55 - 13:30):** Лабораторні роботи / профільні дисципліни
• **4 пара (13:45 - 15:20):** Спецкурси кафедри
• **5 пара (15:35 - 17:10):** Консультації та факультативи`;
}

// Template 1: Schedule Group
export function respondScheduleGroup(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const group = entities.group ? entities.group.toUpperCase() : 'вашої групи';
  const day = entities.day || 'понеділок';
  const topChunk = chunks[0] || {
    source_url: 'https://profkomstud.khai.edu/schedule/group/525st',
    text: ''
  };

  return `Ось розклад для групи **${group}** ${entities.day ? `на **${entities.day}**` : ''}:

${formatSchedule(topChunk.text, entities.day, group)}

📍 **Повний та актуальний розклад групи доступний за посиланням:**
🔗 ${topChunk.source_url}

💡 *Порада:* Обов'язково перевіряйте розклад безпосередньо в електронній системі, оскільки можуть бути оперативні заміни викладачів або перенесення занять. Гарного навчального дня! 🎓`;
}

// Template 2: Schedule Teacher
export function respondScheduleTeacher(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const teacher = entities.teacher || 'викладача';
  const topChunk = chunks[0] || {
    source_url: 'https://profkomstud.khai.edu/schedule/employee/Zemlianko-Heor',
    text: ''
  };

  return `Інформація щодо розкладу та консультацій **${teacher}**:

• **Кафедральне навантаження:** лекції, практичні заняття та консультаційні години.
• **Графік консультацій:** зазвичай призначається у дні занять перед або після пар (за домовленістю через корпоративну пошту або Mentor).
• **Формат:** дистанційні консультації проводяться на платформі Mentor або в університетських аудиторіях.

🔗 **Офіційна сторінка розкладу викладача:**
${topChunk.source_url}

Якщо вам потрібно призначити зустріч або погодити дату перездачі, рекомендуємо також написати викладачеві на університетську пошту. 📚`;
}

// Template 3: Schedule Room
export function respondScheduleRoom(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const room = entities.room ? entities.room.toUpperCase() : 'обраної аудиторії';
  const topChunk = chunks[0] || {
    source_url: 'https://profkomstud.khai.edu/schedule/room/227s',
    text: ''
  };

  return `Розклад та зайнятість аудиторії **${room}**:

• **Призначення:** навчальні та лабораторні заняття згідно з графіком навчального процесу.
• **Бронювання:** викладачі та старости можуть узгодити використання вільної аудиторії через диспетчерську університету або деканат.

🔗 **Перевірити поточну зайнятість аудиторії:**
${topChunk.source_url}

Для проведення наукових або студентських заходів зверніться до диспетчерської навчального відділу ХАІ. 🏢`;
}

// Template 4: Admission Rules
export function respondAdmissionRules(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const topChunks = chunks.slice(0, 3);
  const facts = topChunks
    .map(c => extractKeyPoints(c.text, 2))
    .flat()
    .filter(f => f.length > 0);

  const factList = facts.length > 0
    ? facts.map(f => `• ${f}`).join('\n')
    : `• Подання заяв здійснюється онлайн через електронний кабінет вступника на сайті ЄДЕБО.
• Для вступу на бакалаврат необхідні результати НМТ (національного мультипредметного тесту) або ЗНО минулих років.
• Пільгові категорії (учасники бойових дій, ВПО тощо) мають право на спеціальні умови вступу за квотою-1 або квотою-2.`;

  const sources = topChunks.map(c => `• ${c.source_url}`).join('\n');

  return `📋 **Правила прийому до Національного аерокосмічного університету «ХАІ»:**

${factList}

🔗 **Офіційні правила прийому та нормативні документи:**
${sources || '• https://khai.edu/pravila-prijomu\n• https://khai.edu/vstup'}

Якщо вас цікавлять конкретні коефіцієнти або перелік предметів для спеціальності — запитуйте, залюбки допоможу! 🚀`;
}

// Template 5: Admission Specialties
export function respondAdmissionSpecialties(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const spec = entities.specialty;

  let specHighlight = '';
  if (spec === '134') {
    specHighlight = '\n🎯 **Спеціальність 134 «Авіаційна та ракетно-космічна техніка»** — візитна картка ХАІ: проєктування літаків, вертольотів, безпілотних літальних апаратів (БПЛА) та ракетно-космічних комплексів.\n';
  } else if (spec === '121') {
    specHighlight = '\n🎯 **Спеціальність 121 «Інженерія програмного забезпечення»** — розробка складних програмних систем, AI-технологій, веб- та мобільних додатків із сильною математичною базою.\n';
  }

  return `🎓 **Спеціальності та освітні програми ХАІ:**
${specHighlight}
Провідні напрями підготовки:
• **Аерокосмічний та інженерний кластер:**
  — 134 «Авіаційна та ракетно-космічна техніка»
  — 173 «Авіоніка»
  — 142 «Енергетичне машинобудування»
  — 105 «Прикладна фізика та наноматеріали»
• **IT та комп'ютерні технології:**
  — 121 «Інженерія програмного забезпечення»
  — 122 «Комп'ютерні науки»
  — 123 «Комп'ютерна інженерія»
  — 125 «Кібербезпека та захист інформації»
• **Управління та гуманітарні науки:**
  — 073 «Менеджмент», 051 «Економіка», 053 «Психологія»

🔗 **Детальний опис кожної програми та навчальні плани:**
https://khai.edu/obrati-spetsialnist
https://khai.edu/bakalavrat`;
}

// Template 6: Admission Score
export function respondAdmissionScore(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `📊 **Конкурсний та прохідний бал для вступу до ХАІ:**

• **Формула розрахунку:** Конкурсний бал формується з результатів предметів НМТ, помножених на встановлені вагові коефіцієнти спеціальності, з урахуванням регіонального та галузевого коефіцієнтів.
• **Бюджет:** Мінімальний поріг для участі в конкурсі на бюджетні місця — **130 балів** (для кон'юнктурних спеціальностей, таких як інженерія ПЗ або кібербезпека, конкурентний бал зазвичай становить від **145-160+** балів).
• **Контракт:** На контрактну форму навчання пороговий бал складає від **100-120 балів**.

🧮 **Розрахувати свій точний бал на офіційному калькуляторі:**
🔗 https://assistant.khai.edu
🔗 https://khai.edu/vstup`;
}

// Template 7: Documents
export function respondDocuments(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  if (role === 'Абітурієнт') {
    return `📄 **Документи для вступу до ХАІ:**

Для зарахування необхідні:
• Документ про повну загальну середню освіту (атестат/свідоцтво) та додаток до нього;
• Сертифікат НМТ / ЗНО та інформаційна картка з балами;
• Паспорт громадянина України (ID-картка) та витяг про місце реєстрації;
• РНОКПП (ідентифікаційний код);
• Військово-обліковий документ (для військовозобов'язаних);
• 4 кольорові фотокартки (3х4 см);
• Мотиваційний лист.

🔗 **Офіційний перелік та зразки:**
https://khai.edu/pravila-prijomu`;
  }

  return `📄 **Отримання довідки про навчання та студентських документів:**

• **Як замовити довідку:**
  1. Перейдіть до електронного кабінету в системі **ЕПОС**: https://epos.khai.edu/login
  2. Або зверніться до диспетчера деканату вашого факультету особисто чи через корпоративну пошту.
• **Типи довідок:**
  — Форма для ТЦК та СП (підтвердження навчання для військкомату);
  — Довідка за місцем вимоги (для оформлення пільг, пенсій тощо);
  — Академічна довідка (для переведення або поновлення).
• **Термін виготовлення:** 1-3 робочих дні.

🔗 **Розділ для студентів:**
https://khai.edu/studentu`;
}

// Template 8: Dormitory
export function respondDormitory(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `🏡 **Студентське містечко та гуртожитки ХАІ:**

• **Забезпечення житлом:** Усі іногородні студенти денної форми та першокурсники 100% забезпечуються місцями в гуртожитках кампусу ХАІ.
• **Розташування:** Студмістечко розташоване на території університету поруч із навчальними корпусами, стадіоном та лісопарком.
• **Необхідні документи для поселення:**
  1. Заява на поселення (подається через деканат або профком);
  2. Паспорт та витяг про реєстрацію (+ копії);
  3. Ідентифікаційний код (+ копія);
  4. Медична довідка встановленого зразка (проходження огляду в медпункті ХАІ);
  5. 2 фотокартки (3х4 см);
  6. Квитанція про оплату за проживання.

🔗 **Детальніше про студентське життя та умови:**
https://khai.edu/studentu
https://profkomstud.khai.edu`;
}

// Template 9: Conferences
export function respondConferences(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  const confChunks = chunks.filter(c => c.category === 'Наука' || c.text.toLowerCase().includes('конференц'));
  
  return `🔬 **Актуальні наукові конференції та заходи ХАІ:**

• **Міжнародний конгрес двигунобудівників** — провідний авіаційний науковий форум України
  🔗 https://khai.edu/miznarodnij-kongres-dvigunobudivnikiv

• **Міжнародна конференція SCIFIC** — фундаментальні та прикладні науки
  🔗 https://scific-conference.github.io/SCIFIC-conference/en/index.html

• **ProFIT-AI 2025** — 5th International Workshop of IT Professionals on Artificial Intelligence (Штучний інтелект та сучасні IT)
  🔗 https://khai.edu/5th-international-workshop-of-it-professionals-on-artificial-intelligence-profit-ai-2025

• **Сучасні проблеми ракетно-космічної техніки і технології** — всеукраїнська молодіжна конференція
  🔗 https://khai.edu/naukovo-prakticna-konferencia-studentiv-i-molodih-vcenih-sucasni-problemi-raketno-kosmicnoi-tehniki-i-tehnologii

• **Людина, культура, техніка в новому тисячолітті**
  🔗 https://khai.edu/miznarodna-naukovo-prakticna-konferencia-ludina-kultura-tehnika-v-novomu-tisacolitti

• **Конференція FAE (Авіація та електроніка) та ICTM**
  🔗 https://fae-conference.khai.edu | https://ictm.khai.edu

За матеріалами конференцій публікуються наукові збірники з індексацією. Бажаєте взяти участь у певній тематиці? 📝`;
}

// Template 10: Publications
export function respondPublications(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `📚 **Наукові публікації, фахові журнали та репозитарій ХАІ:**

• **Де шукати та публікувати наукові праці:**
  — **Інституційний репозитарій ХАІ:** містить автореферати, дисертації, монографії, методичні посібники та статті співробітників ХАІ у відкритому доступі.
  — **Науковий журнал «Авіаційно-космічна техніка і технологія»:** офіційне фахове видання ХАІ категорії «Б», індексується міжнародними наукометричними базами.
  — **Наукова бібліотека ХАІ:** надає доступ до баз даних Scopus та Web of Science, перевірку на академічний плагіат та присвоєння DOI статтям.

• **Для викладачів та аспірантів:**
  Діє система підтримки публікаційної активності в рейтингових виданнях Q1-Q3 Scopus / WoS.

🔗 **Офіційний науковий портал ХАІ:**
https://khai.edu/nauka`;
}

// Template 11: Contacts
export function respondContacts(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `📞 **Контакти Національного аерокосмічного університету «ХАІ»:**

• **Адреса університету:**
  вул. Вадима Манька (Чкалова), 17, м. Харків, 61070, Україна.

• **Приймальна комісія:**
  — Телефон: консультації з питань вступу розміщені на офіційній сторінці
  — E-mail: vstup@khai.edu
  — Telegram-канали та боти для вступників: https://assistant.khai.edu

• **Довідкова служба університету:**
  — Тел.: +38 (057) 788-40-09
  — Офіційний сайт: https://khai.edu

• **Деканати факультетів:**
  Контакти та електронні адреси деканатів 1–7 факультетів дивіться у розділі:
  🔗 https://khai.edu/universitet`;
}

// Template 12: Platforms
export function respondPlatforms(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `💻 **Основні навчальні та цифрові платформи ХАІ:**

• **Mentor (Дистанційне навчання)** — https://mentor.khai.edu
  Головна система електронних курсів, завдань, лекцій та комунікації з викладачами.

• **Moodle / Profkomstud** — https://profkomstud.khai.edu
  Студентський портал із розкладом занять, методичними матеріалами та студентськими сервісами.

• **Pilot (Тестування та контроль знань)** — https://pilot.khai.edu/pilot/login.html
  Система онлайн-тестування знань під час модульних та сесійних контролів.

• **Epos (Електронний деканат)** — https://epos.khai.edu/login
  Особистий кабінет студента: перегляд успішності (електронна заліковка), замовлення довідок, квитанції на оплату.

🔑 *Вхід на платформи здійснюється за університетським корпоративним акаунтом. Якщо виникли труднощі з доступом — зверніться до деканату або адміністратора системи.*`;
}

// Template 13: Payment
export function respondPayment(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `💳 **Оплата за навчання в ХАІ:**

• **Вартість контрактного навчання:** залежить від обраної спеціальності та освітнього ступеня (бакалавр / магістр) відповідно до затвердженого кошторису.
• **Графік оплати:** можлива помісячна або посеместрова оплата згідно з умовами укладеного договору.
• **Реквізити для оплати:** 
  Офіційні реквізити казначейського рахунку генеруються в особистому кабінеті студента в системі **Epos** або надаються бухгалтерією.

🔗 **Детальніше про умови та договір:**
https://khai.edu/vstup
https://epos.khai.edu/login`;
}

// Template 14: Scholarship
export function respondScholarship(entities: ExtractedEntities, chunks: KnowledgeChunk[], role: string): string {
  return `💰 **Стипендіальне забезпечення студентів ХАІ:**

• **Академічна стипендія:**
  Призначається студентам денної форми бюджетного навчання за результатами семестрового контролю на основі рейтингового балу. Ліміт стипендіатів складає 40–45% від фактичної кількості бюджетників на курсі. Відмінникам виплачується підвищена стипендія.
• **Соціальна стипендія:**
  Призначається студентам пільгових категорій (діти-сироти, учасники бойових дій та їхні діти, ВПО тощо) за наявності підтвердних документів.
• **Оформлення:**
  Для оформлення звертайтеся до стипендіальної комісії або деканату свого факультету.

🔗 **Інформація для студентів:**
https://khai.edu/studentu`;
}

// Template 15: Unknown (Polite fallback with suggestions)
export function respondUnknown(query: string, role: string): string {
  return `На жаль, у офіційних джерелах ХАІ я не знайшов точної відповіді на запит «**${query}**».

Спробуйте переформулювати запитання або скористайтеся підказками. Ось про що я точно знаю:
• 📅 **Розклад занять** (для груп 545б, 525ст, викладачів, аудиторій)
• 📋 **Правила прийому та спеціальності** (134, 121, 122, бакалаврат, магістратура)
• 📊 **Конкурсний бал та калькулятор**
• 📄 **Замовлення довідок та деканат**
• 🏡 **Гуртожитки та студмістечко**
• 🔬 **Наукові конференції та публікації**
• 💻 **Навчальні платформи** (Mentor, Moodle, Pilot, Epos)

Також ви можете перевірити інформацію на офіційному сайті:
🔗 https://khai.edu
🔗 https://khai.edu/studentu`;
}

// Master dispatch function
export function generateTemplateResponse(
  intent: string,
  entities: ExtractedEntities,
  chunks: KnowledgeChunk[],
  role: string,
  rawQuery: string
): string {
  switch (intent) {
    case 'schedule_group':
      return respondScheduleGroup(entities, chunks, role);
    case 'schedule_teacher':
      return respondScheduleTeacher(entities, chunks, role);
    case 'schedule_room':
      return respondScheduleRoom(entities, chunks, role);
    case 'admission_rules':
      return respondAdmissionRules(entities, chunks, role);
    case 'admission_specialties':
      return respondAdmissionSpecialties(entities, chunks, role);
    case 'admission_score':
      return respondAdmissionScore(entities, chunks, role);
    case 'documents':
      return respondDocuments(entities, chunks, role);
    case 'dormitory':
      return respondDormitory(entities, chunks, role);
    case 'conferences':
      return respondConferences(entities, chunks, role);
    case 'publications':
      return respondPublications(entities, chunks, role);
    case 'contacts':
      return respondContacts(entities, chunks, role);
    case 'platforms':
      return respondPlatforms(entities, chunks, role);
    case 'payment':
      return respondPayment(entities, chunks, role);
    case 'scholarship':
      return respondScholarship(entities, chunks, role);
    case 'unknown':
    default:
      return respondUnknown(rawQuery, role);
  }
}
