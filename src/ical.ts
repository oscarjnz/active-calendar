// Parser minimalista de iCal (RFC 5545) suficiente para feeds de Blackboard.
// Solo procesa VEVENT y los campos UID, SUMMARY, DTSTART, DTEND, URL,
// LAST-MODIFIED, CATEGORIES, DESCRIPTION. Maneja line unfolding y escapes.

import type { Course, IcalEvent } from './types';
import { COURSE_SIGNALS, normalizeCode, pensumName } from './pensum';

/** Minúsculas y sin tildes, para matching tolerante a acentos. */
function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** True si `needle` aparece en `hay` como palabra/frase completa (no substring suelto). */
function containsWord(hay: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(hay);
}

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
  // Tercer nivel: palabras/frases clave por materia (COURSE_SIGNALS), para
  // tareas cuyo título es genérico ("Actividad 4", "TAREA 15_Analisis de
  // Malware.docx") y no menciona ni el código ni el nombre de la materia.
  const folded = foldText(summary);
  for (const c of courses) {
    const signals = COURSE_SIGNALS[c.code];
    if (!signals) continue;
    if (signals.some((kw) => containsWord(folded, foldText(kw)))) return c.code;
  }
  return null;
}

/**
 * Extrae el ID numérico del "gradebook item" del UID de una tarea de
 * Blackboard (ej. "_blackboard.platform.gradebook2.GradableItem-_870039_1"
 * -> 870039), o null si el UID no sigue ese patrón (ej. sesiones de clase).
 */
export function extractGradebookId(uid: string): number | null {
  const m = uid.match(/_(\d+)_\d+$/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

// Umbral de distancia (en ID) para aceptar un solo vecino clasificado (sin
// "bracket" por ambos lados). Los saltos de ID entre materias distintas suelen
// ser de decenas/cientos, pero se han visto tan chicos como 10 entre bloques
// contiguos de materias distintas, así que este valor se mantiene conservador.
const GRADEBOOK_NEAR_GAP = 8;

// Span máximo (antes -> después) para confiar en un "bracket" (ambos vecinos
// coinciden en materia). Materias cuyo profesor agrega entregas una por
// semana (en vez de crear todo el gradebook de una vez) dejan huecos enormes
// entre sus propios ítems (~2500 visto en datos reales); un ítem de OTRA
// materia agregado en ese hueco no debe heredar la materia solo por caer en
// medio de dos puntos lejanos que coinciden por casualidad.
const GRADEBOOK_BRACKET_SPAN = 60;

/**
 * Cuarto nivel de derivación (no forma parte de `deriveCourseCode`: se aplica
 * después, solo a las tareas que sigan sin materia). Blackboard asigna los IDs
 * de "gradebook item" en bloques contiguos por materia (se crean juntos cuando
 * el profesor arma su gradebook), así que una tarea sin señal de texto que cae
 * ENTRE dos tareas ya clasificadas (manual o automáticamente, de cualquier
 * semana) de la MISMA materia casi seguro pertenece a esa materia. Si solo hay
 * un vecino clasificado a un lado (inicio/fin del rango conocido), se exige
 * que esté muy cerca para reducir falsos positivos con el bloque de la
 * materia vecina (los bloques de materias distintas pueden quedar a solo ~10
 * de distancia entre sí).
 */
export function deriveCourseCodeByProximity(
  uid: string,
  classified: Array<{ uid: string; course_code: string }>,
): string | null {
  const id = extractGradebookId(uid);
  if (id === null) return null;
  let before: { id: number; code: string } | null = null;
  let after: { id: number; code: string } | null = null;
  for (const t of classified) {
    const tid = extractGradebookId(t.uid);
    if (tid === null || tid === id) continue;
    if (tid < id && (before === null || tid > before.id)) before = { id: tid, code: t.course_code };
    if (tid > id && (after === null || tid < after.id)) after = { id: tid, code: t.course_code };
  }
  if (before && after && before.code === after.code && after.id - before.id <= GRADEBOOK_BRACKET_SPAN) {
    return before.code;
  }
  if (before && (!after || id - before.id < after.id - id) && id - before.id <= GRADEBOOK_NEAR_GAP) return before.code;
  if (after && (!before || after.id - id < id - before.id) && after.id - id <= GRADEBOOK_NEAR_GAP) return after.code;
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
