// Parser minimalista de iCal (RFC 5545) suficiente para feeds de Blackboard.
// Solo procesa VEVENT y los campos UID, SUMMARY, DTSTART, DTEND, URL,
// LAST-MODIFIED, CATEGORIES, DESCRIPTION. Maneja line unfolding y escapes.

import type { Course, IcalEvent } from './types';
import { normalizeCode, pensumName } from './pensum';

/** Une lineas plegadas (continuacion empieza con espacio o tab). */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Desescapa valores de texto iCal (\\n, \\,, \\;, \\\\). */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parsea un valor de fecha/hora iCal a Date UTC. */
function parseIcalDate(value: string, params: Record<string, string>): Date | null {
  // Formato basico: YYYYMMDD o YYYYMMDDTHHMMSS[Z]
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', ss = '0', z] = m;
  const Y = parseInt(y!, 10);
  const Mo = parseInt(mo!, 10) - 1;
  const D = parseInt(d!, 10);
  const H = parseInt(hh, 10);
  const Mi = parseInt(mm, 10);
  const S = parseInt(ss, 10);

  if (z === 'Z') {
    return new Date(Date.UTC(Y, Mo, D, H, Mi, S));
  }
  // Si trae TZID conocida la ignoramos y tratamos como local SDQ (UTC-4).
  // Blackboard suele enviar UTC con sufijo Z, asi que este path es marginal.
  const tzid = params.TZID;
  if (tzid && /santo_domingo|america\/santo_domingo|AST/i.test(tzid)) {
    return new Date(Date.UTC(Y, Mo, D, H + 4, Mi, S));
  }
  // Sin Z y sin TZID -> floating. Asumimos UTC para no inventar offset.
  return new Date(Date.UTC(Y, Mo, D, H, Mi, S));
}

/** Separa "PROP;PARAM=val:VALUE" en {name, params, value}. */
function splitProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0]!.toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i]!.indexOf('=');
    if (eq > 0) {
      params[parts[i]!.slice(0, eq).toUpperCase()] = parts[i]!.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }
  return { name, params, value };
}

/** True si el UID corresponde a una clase/sesión (que SÍ trae el curso). */
function isSessionUid(uid: string): boolean {
  return /CalendarEntry/i.test(uid);
}

/** Extrae el primer código de materia (ej. "TI3712") de un texto, normalizado. */
export function extractCourseCode(text: string): string | null {
  const m = text.match(/\b([A-Z]{2,3}\s?-?\s?\d{3,4})\b/i);
  if (!m || !m[1]) return null;
  return normalizeCode(m[1]);
}

/**
 * Extrae un nombre legible del curso desde el SUMMARY de una sesión de clase.
 * Ej. "TI3712-02-2025-3: TI3712-02-2025-3-CRIPTOGRAFÍA (ELECTIVA)" -> "Criptografía (Electiva)".
 * Prefiere el nombre del pensum si el código está catalogado.
 */
export function sessionCourseName(summary: string): string | null {
  const code = extractCourseCode(summary);
  const fromPensum = code ? pensumName(code) : null;
  if (fromPensum) return fromPensum;

  // Tomar el texto después del primer ":" (parte descriptiva).
  let tail = summary.includes(':') ? summary.slice(summary.indexOf(':') + 1) : summary;
  tail = tail.trim();
  // Quitar el prefijo "CODE-NN-YYYY-N-" repetido al inicio.
  tail = tail.replace(/^[A-Z]{2,3}\s?-?\s?\d{3,4}(?:-\d+){0,3}-?/i, '').trim();
  if (!tail) return null;
  return toTitleCase(tail);
}

/** Title Case respetuoso de acentos; deja siglas cortas/paréntesis intactos. */
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-zà-ÿ])([a-zà-ÿ']*)/gi, (_, a: string, b: string) => a.toUpperCase() + b);
}

/** Descubre las materias matriculadas a partir de los eventos de tipo sesión/clase. */
export function collectEnrolledCourses(events: IcalEvent[]): Course[] {
  const byCode = new Map<string, Course>();
  for (const ev of events) {
    if (!ev.isSession || !ev.courseCode) continue;
    if (byCode.has(ev.courseCode)) continue;
    const name = ev.course ?? pensumName(ev.courseCode) ?? ev.courseCode;
    byCode.set(ev.courseCode, { code: ev.courseCode, name });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Deriva el código de materia de una tarea: primero por código en el texto,
 * luego por coincidencia del nombre de alguna materia matriculada en el SUMMARY.
 */
export function deriveCourseCode(summary: string, courses: Course[]): string | null {
  const direct = extractCourseCode(summary);
  if (direct) return direct;
  const hay = summary.toLowerCase();
  for (const c of courses) {
    const name = c.name.toLowerCase();
    if (name.length >= 4 && hay.includes(name)) return c.code;
  }
  return null;
}

/** Parsea el iCal completo y devuelve los VEVENT. */
export function parseIcal(raw: string): IcalEvent[] {
  const lines = unfold(raw);
  const events: IcalEvent[] = [];
  let inEvent = false;
  let cur: {
    uid?: string;
    summary?: string;
    dtstart?: Date | null;
    dtend?: Date | null;
    url?: string;
    lastModified?: Date | null;
    categories?: string;
    description?: string;
  } = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur.uid && cur.summary) {
        const due = cur.dtend ?? cur.dtstart ?? null;
        const summary = unescapeText(cur.summary);
        const isSession = isSessionUid(cur.uid);
        // Solo las sesiones traen curso confiable en el SUMMARY. Las tareas se
        // derivan luego contra las materias matriculadas (ver deriveCourseCode).
        const courseCode = isSession ? extractCourseCode(summary) : null;
        const course = isSession ? sessionCourseName(summary) : null;
        events.push({
          uid: cur.uid,
          summary,
          course,
          courseCode,
          isSession,
          due,
          url: cur.url ?? null,
          lastModified: cur.lastModified ?? null,
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const prop = splitProp(line);
    if (!prop) continue;

    switch (prop.name) {
      case 'UID':
        cur.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        cur.summary = prop.value;
        break;
      case 'DTSTART':
        cur.dtstart = parseIcalDate(prop.value, prop.params);
        break;
      case 'DTEND':
        cur.dtend = parseIcalDate(prop.value, prop.params);
        break;
      case 'URL':
        cur.url = prop.value;
        break;
      case 'LAST-MODIFIED':
        cur.lastModified = parseIcalDate(prop.value, prop.params);
        break;
      case 'CATEGORIES':
        cur.categories = prop.value;
        break;
      case 'DESCRIPTION':
        cur.description = prop.value;
        break;
    }
  }

  return events;
}

/** Extrae el nombre del estudiante del feed si esta presente (X-WR-CALNAME tipico). */
export function extractCalendarOwner(raw: string): string | null {
  const lines = unfold(raw);
  for (const line of lines) {
    const prop = splitProp(line);
    if (!prop) continue;
    if (prop.name === 'X-WR-CALNAME' || prop.name === 'NAME') {
      // Suele venir como "Calendar - Nombre Apellido" o similar.
      const v = unescapeText(prop.value).trim();
      const m = v.match(/(?:[-—:]\s*)([A-Za-zÀ-ÿ' .]+)$/);
      return m && m[1] ? m[1].trim() : v;
    }
  }
  return null;
}

/** Filtra eventos cuyo `due` cae dentro del rango [start,end]. */
export function filterInRange(events: IcalEvent[], start: Date, end: Date): IcalEvent[] {
  const sMs = start.getTime();
  const eMs = end.getTime();
  return events.filter((ev) => {
    if (!ev.due) return false;
    const t = ev.due.getTime();
    return t >= sMs && t <= eMs;
  });
}
