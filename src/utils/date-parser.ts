/**
 * Разбирает относительные даты в украинском языке
 * и возвращает конкретную дату в формате YYYY-MM-DD.
 */

const WEEKDAYS_UK: Record<string, number> = {
  'понеділок': 1, 'вівторок': 2, 'середа': 3,
  'четвер': 4, 'п\'ятниця': 5, 'пятниця': 5,
  'субота': 6, 'неділя': 7,
};

const MONTHS_UK: Record<string, number> = {
  'січень': 1, 'лютий': 2, 'березень': 3, 'квітень': 4,
  'травень': 5, 'червень': 6, 'липень': 7, 'серпень': 8,
  'вересень': 9, 'жовтень': 10, 'листопад': 11, 'грудень': 12,
};

export interface ParsedDate {
  /** Конкретная дата в формате YYYY-MM-DD */
  isoDate: string;
  /** День недели (1=Пн, 7=Нд) */
  weekday: number;
  /** Человекочитаемое представление */
  humanReadable: string;
  /** Исходное выражение, которое было распознано */
  originalExpression: string;
}

/**
 * Пытается распознать относительную дату в запросе.
 * Возвращает null, если ничего не найдено.
 */
export function parseRelativeDate(query: string): ParsedDate | null {
  const lower = query.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Простые относительные дни
  if (/\bсьогодні\b|\bсегодня\b/.test(lower)) {
    return buildResult(today, 'сьогодні');
  }
  if (/\bзавтра\b|\bзавтрашній\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return buildResult(d, 'завтра');
  }
  if (/\bпіслязавтра\b|\bпослезавтра\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return buildResult(d, 'післязавтра');
  }
  if (/\bвчора\b|\bвчера\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return buildResult(d, 'вчора');
  }

  // 2. "через N днів"
  const throughDays = lower.match(/через\s+(\d+)\s+(дн|день|дні|дней)/);
  if (throughDays) {
    const n = parseInt(throughDays[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return buildResult(d, `через ${n} днів`);
  }

  // 3. День недели ("у понеділок", "в понеділок", "на понеділок")
  for (const [name, dayNum] of Object.entries(WEEKDAYS_UK)) {
    const regex = new RegExp(`\\b(у|в|на|до)\\s+${name}\\b`);
    if (regex.test(lower) || lower.includes(` ${name}`)) {
      const d = getNextWeekday(today, dayNum);
      return buildResult(d, name);
    }
  }

  // 4. Явная дата "15 жовтня"
  const explicitDate = lower.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/);
  if (explicitDate) {
    const day = parseInt(explicitDate[1], 10);
    const monthName = explicitDate[2];
    const monthStem = monthName.slice(0, -2); // "жовтня" -> "жовтн"
    const month = Object.entries(MONTHS_UK).find(([k]) =>
      k.startsWith(monthStem.slice(0, 4))
    )?.[1];
    if (month) {
      const d = new Date(today.getFullYear(), month - 1, day);
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return buildResult(d, `${day} ${monthName}`);
    }
  }

  return null;
}

function buildResult(date: Date, originalExpression: string): ParsedDate {
  const iso = date.toISOString().split('T')[0];
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  const humanReadable = date.toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  return { isoDate: iso, weekday, humanReadable, originalExpression };
}

function getNextWeekday(from: Date, targetWeekday: number): Date {
  const d = new Date(from);
  const current = d.getDay() === 0 ? 7 : d.getDay();
  let diff = targetWeekday - current;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}
