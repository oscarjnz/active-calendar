// Utilidades de zona horaria para America/Santo_Domingo (UTC-4 fijo, sin DST).
// Calculamos offsets manualmente para no depender del runtime tz.

const SDQ_OFFSET_MIN = -4 * 60; // UTC-4

/** Convierte un Date UTC a las partes de fecha/hora en Santo Domingo. */
export function toSdqParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 1=Lun..7=Dom
} {
  const shifted = new Date(d.getTime() + SDQ_OFFSET_MIN * 60_000);
  const wd = shifted.getUTCDay(); // 0=Dom..6=Sab
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: wd === 0 ? 7 : wd,
  };
}

/** Crea un instante UTC dado componentes locales SDQ. */
export function fromSdq(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(utcMs - SDQ_OFFSET_MIN * 60_000);
}

/** Devuelve [inicioLunes00:00, finDomingo23:59:59.999] en UTC. */
export function currentWeekRangeSdq(now: Date = new Date()): { start: Date; end: Date } {
  const p = toSdqParts(now);
  const daysFromMonday = p.weekday - 1; // 0 si lunes
  const monday = fromSdq(p.year, p.month, p.day, 0, 0, 0);
  const start = new Date(monday.getTime() - daysFromMonday * 86_400_000);
  const end = new Date(start.getTime() + 7 * 86_400_000 - 1);
  return { start, end };
}

const DAY_ABBR = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Formato corto local: "Lun 03/jun 23:59". */
export function formatSdq(d: Date): string {
  const p = toSdqParts(d);
  const dow = DAY_ABBR[p.weekday - 1];
  const mon = MONTH_ABBR[p.month - 1];
  const dd = String(p.day).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${dow} ${dd}/${mon} ${hh}:${mm}`;
}

/** Formato de rango para encabezados. */
export function formatRangeSdq(start: Date, end: Date): string {
  const a = toSdqParts(start);
  const b = toSdqParts(end);
  const am = MONTH_ABBR[a.month - 1];
  const bm = MONTH_ABBR[b.month - 1];
  return `${String(a.day).padStart(2, '0')}/${am} - ${String(b.day).padStart(2, '0')}/${bm} ${b.year}`;
}

// --- Calendario académico UNIBE: 3 bloques de 4 meses, 15 semanas cada uno ---
// Bloque 1: Sep–Dic (inicia septiembre) · Bloque 2: Ene–Abr (inicia enero) ·
// Bloque 3: May–Ago (inicia mayo). La "semana 1" es la 1era semana oficial del
// mes de inicio: el primer lunes que cae en ese mes (si el 1 es sábado, la
// semana 1 arranca el lunes siguiente).

export interface AcademicWeek {
  block: 1 | 2 | 3;
  blockLabel: string; // "Sep–Dic"
  week: number | null; // 1-15, o null si estamos en receso (fuera del rango)
}

/** Lunes de la 1era semana oficial del mes (primer lunes que cae en el mes). */
function firstMondayOfMonth(year: number, month: number): Date {
  const first = fromSdq(year, month, 1);
  const wd = toSdqParts(first).weekday; // 1=Lun..7=Dom
  const add = wd === 1 ? 0 : 8 - wd; // días hasta el próximo lunes
  return new Date(first.getTime() + add * 86_400_000);
}

const BLOCK_LABELS: Record<1 | 2 | 3, string> = { 1: 'Sep–Dic', 2: 'Ene–Abr', 3: 'May–Ago' };

/** Bloque y semana (1-15) en que se encuentra el estudiante según la fecha. */
export function currentAcademicWeek(now: Date = new Date()): AcademicWeek {
  const p = toSdqParts(now);
  let block: 1 | 2 | 3;
  let startMonth: number;
  if (p.month >= 9) {
    block = 1;
    startMonth = 9;
  } else if (p.month <= 4) {
    block = 2;
    startMonth = 1;
  } else {
    block = 3;
    startMonth = 5;
  }
  const firstMon = firstMondayOfMonth(p.year, startMonth);
  const { start: curMon } = currentWeekRangeSdq(now);
  const diffWeeks = Math.round((curMon.getTime() - firstMon.getTime()) / (7 * 86_400_000));
  const week = diffWeeks + 1;
  return {
    block,
    blockLabel: BLOCK_LABELS[block],
    week: week >= 1 && week <= 15 ? week : null,
  };
}

/** True si la hora actual local SDQ corresponde al resumen matutino (~7 AM, ventana 6-8). */
export function isMorningWindowSdq(now: Date = new Date()): boolean {
  const h = toSdqParts(now).hour;
  return h >= 6 && h <= 8;
}
