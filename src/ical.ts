// Parser minimalista de iCal (RFC 5545) suficiente para feeds de Blackboard.
// Solo procesa VEVENT y los campos UID, SUMMARY, DTSTART, DTEND, URL,
// LAST-MODIFIED, CATEGORIES, DESCRIPTION. Maneja line unfolding y escapes.

import type { IcalEvent } from './types';

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

/** Heuristica para extraer el codigo o nombre del curso desde SUMMARY/CATEGORIES/DESCRIPTION. */
function deriveCourse(summary: string, categories: string | null, description: string | null): string | null {
  // 1) Texto entre corchetes: "[TI3325] Tarea X"
  const br = summary.match(/\[([^\]]+)\]/);
  if (br && br[1]) return br[1].trim();

  // 2) Codigo tipo dos-cuatro letras + 3-5 digitos al inicio: "TI3325 - ..."
  const code = summary.match(/^([A-Z]{2,5}\s?\d{3,5})\b/);
  if (code && code[1]) return code[1].trim();

  // 3) CATEGORIES suele traer el nombre del curso en Blackboard.
  if (categories) {
    const first = categories.split(',')[0]?.trim();
    if (first) return first;
  }

  // 4) Patron "Course: X" en DESCRIPTION.
  if (description) {
    const m = description.match(/(?:Course|Curso)\s*:\s*([^\n\r]+)/i);
    if (m && m[1]) return m[1].trim();
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
        events.push({
          uid: cur.uid,
          summary: unescapeText(cur.summary),
          course: deriveCourse(cur.summary, cur.categories ?? null, cur.description ?? null),
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
