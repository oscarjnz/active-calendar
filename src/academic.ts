import type { Course, Env } from './types';
import { normalizeCode, pensumName } from './pensum';

// Fuente académica externa. OJO: este repo es público, así que aquí NO puede
// aparecer nada de la fuente (host, rutas, parámetros ni nombres de campos). Todo
// eso vive en el secret `ACADEMIC_SOURCE` (JSON) y este módulo solo lo interpreta de
// forma genérica. Solo corre en el Worker: el navegador nunca ve ni toca esto.
//
// Forma del secret (cada `query` usa {id} y {period} como comodines):
// {
//   "base": "https://…",
//   "period": "…",            // opcional: fuerza el período; si falta se calcula
//   "schedule": { "path", "query", "rows": "a.b", "code": "<campo>", "name": "<campo>" },
//   "identity": { "path", "query", "name": "a.b.0.c" },   // nombre completo "APELLIDOS, NOMBRES"
//   "history":  { "path", "query", "rows": "a.b", "code", "grade", "pass": ["…"] }
// }

interface Endpoint {
  path: string;
  query?: Record<string, string>;
}
interface SourceConfig {
  base: string;
  period?: string;
  schedule?: Endpoint & { rows: string; code: string; name: string };
  identity?: Endpoint & { name: string };
  history?: Endpoint & { rows: string; code: string; grade: string; pass: string[] };
}

const TIMEOUT_MS = 8000;
// Con cuánta frecuencia se vuelve a consultar por estudiante. El cron corre cada 30 min,
// pero esta fuente cambia solo al inscribir/retirar materias o al cerrar notas.
export const ACADEMIC_REFRESH_MS = 12 * 60 * 60 * 1000;

function loadConfig(env: Env): SourceConfig | null {
  if (!env.ACADEMIC_SOURCE) return null;
  try {
    const c = JSON.parse(env.ACADEMIC_SOURCE) as SourceConfig;
    return c.base ? c : null;
  } catch {
    return null;
  }
}

/** Si la fuente está configurada en este despliegue. */
export function academicEnabled(env: Env): boolean {
  return loadConfig(env) !== null;
}

/** Formato válido de identificador de estudiante (solo forma, no existencia). */
export function validStudentId(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^\d{2}-\d{3,6}$/.test(s) ? s : null;
}

/**
 * Período vigente según la fecha (hora de Santo Domingo, UTC-4): septiembre a diciembre
 * pertenece al "-1" del año siguiente, enero a abril al "-2" y mayo a agosto al "-3".
 */
export function currentPeriodId(now: Date = new Date()): string {
  const sdq = new Date(now.getTime() - 4 * 3600 * 1000);
  const y = sdq.getUTCFullYear();
  const m = sdq.getUTCMonth() + 1;
  if (m >= 9) return `${y + 1}-1`;
  if (m <= 4) return `${y}-2`;
  return `${y}-3`;
}

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// Resultado crudo de la fuente. `status` 0 = ni siquiera hubo respuesta (red, timeout,
// JSON inválido); lo usamos para distinguir "la fuente está caída" de "respondió que no".
type CallResult = { ok: true; body: unknown } | { ok: false; status: number };

/** Si ese fallo significa "la fuente no está disponible" (y no "ese dato no existe"). */
function sourceDown(status: number): boolean {
  return status === 0 || status === 403 || status === 429 || status >= 500;
}

/** Consulta un endpoint configurado. Nunca lanza: devuelve el fallo como dato. */
async function call(env: Env, cfg: SourceConfig, ep: Endpoint, studentId: string): Promise<CallResult> {
  try {
    const period = cfg.period || currentPeriodId();
    const url = new URL(ep.path, cfg.base);
    for (const [k, v] of Object.entries(ep.query ?? {})) {
      url.searchParams.set(k, v.replace('{id}', studentId).replace('{period}', period));
    }
    const res = await fetch(url, {
      // Sin cabeceras, `fetch` del Worker sale sin User-Agent y varios WAF lo rechazan de
      // entrada. Nos identificamos con honestidad (no imitamos un navegador) y pedimos JSON.
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'es-DO,es;q=0.9',
        'user-agent': 'ActiveCalendar/1.0 (+https://activecalendar.site)',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // El código distingue un bloqueo del proveedor (403) de una ruta mal puesta (404), y
      // `cf-mitigated` confirma si quien corta es el WAF y no la aplicación.
      console.error('academic fetch failed: status', res.status, res.headers.get('cf-mitigated') ?? '');
      return { ok: false, status: res.status };
    }
    return { ok: true, body: await res.json() };
  } catch (err) {
    // Solo el tipo de error: el mensaje podría arrastrar la URL.
    console.error('academic fetch failed:', (err as Error).name);
    return { ok: false, status: 0 };
  }
}

const LOWER = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'con', 'a', 'por']);

/** "INGENIERÍA DE FACTORES HUMANOS" -> "Ingeniería de factores humanos" (respeta romanos II, III…). */
function prettyName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(w)) return w.toUpperCase();
      if (i > 0 && LOWER.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Materias matriculadas del estudiante en el período vigente. Usa SIEMPRE el
 * identificador guardado en su perfil (nunca uno que llegue del navegador). Devuelve []
 * ante cualquier falla.
 */
export async function fetchEnrolledCourses(env: Env, studentId: string): Promise<Course[]> {
  const cfg = loadConfig(env);
  const ep = cfg?.schedule;
  if (!cfg || !ep || !validStudentId(studentId)) return [];
  const r = await call(env, cfg, ep, studentId);
  const rows = r.ok ? pick(r.body, ep.rows) : null;
  if (!Array.isArray(rows)) return [];
  const byCode = new Map<string, Course>();
  for (const row of rows) {
    const rawCode = pick(row, ep.code);
    if (typeof rawCode !== 'string' || !rawCode.trim()) continue;
    const code = normalizeCode(rawCode);
    const apiName = pick(row, ep.name);
    const name = pensumName(code) ?? (typeof apiName === 'string' ? prettyName(apiName) : '');
    if (name) byCode.set(code, { code, name });
  }
  return [...byCode.values()];
}

/**
 * Códigos de materias aprobadas del pensum. Solo salen los códigos: las calificaciones se
 * leen aquí para decidir aprobado/no y nunca se guardan ni se envían al navegador.
 */
export async function fetchApprovedCodes(env: Env, studentId: string): Promise<string[]> {
  const cfg = loadConfig(env);
  const ep = cfg?.history;
  if (!cfg || !ep || !validStudentId(studentId)) return [];
  const r = await call(env, cfg, ep, studentId);
  const rows = r.ok ? pick(r.body, ep.rows) : null;
  if (!Array.isArray(rows)) return [];
  const pass = new Set(ep.pass.map((g) => g.toUpperCase()));
  const out = new Set<string>();
  for (const row of rows) {
    const rawCode = pick(row, ep.code);
    const grade = pick(row, ep.grade);
    if (typeof rawCode !== 'string' || typeof grade !== 'string') continue;
    const code = normalizeCode(rawCode);
    // Solo materias del pensum (evita ensuciar el progreso con códigos de otros planes).
    if (code && pass.has(grade.trim().toUpperCase()) && pensumName(code)) out.add(code);
  }
  return [...out];
}

// ---------- verificación de identidad ----------

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s,]/g, ' ');

/** Parte "APELLIDOS, NOMBRES" en tokens normalizados. */
function splitOfficialName(raw: string): { surnames: string[]; given: string[] } {
  const [s = '', g = ''] = norm(raw).split(',');
  return { surnames: s.split(/\s+/).filter(Boolean), given: g.split(/\s+/).filter(Boolean) };
}

// `down` separa "no pudimos preguntar" (fuente caída o bloqueándonos) de "preguntamos y esa
// matrícula no está". Solo con eso el endpoint puede responder honestamente sin convertirse
// en un oráculo de qué matrículas existen: un 404 sigue cayendo en el mensaje genérico.
export type NameLookup = { ok: true; name: string } | { ok: false; down: boolean };

/** Nombre completo oficial del estudiante (solo para comparar en el servidor; no sale de aquí). */
export async function lookupOfficialName(env: Env, studentId: string): Promise<NameLookup> {
  const cfg = loadConfig(env);
  const ep = cfg?.identity;
  if (!cfg || !ep || !validStudentId(studentId)) return { ok: false, down: false };
  const r = await call(env, cfg, ep, studentId);
  if (!r.ok) return { ok: false, down: sourceDown(r.status) };
  const v = pick(r.body, ep.name);
  return typeof v === 'string' && v.trim() ? { ok: true, name: v } : { ok: false, down: false };
}

/**
 * El nombre escrito por el estudiante debe coincidir con el oficial: al menos 2 palabras,
 * todas presentes en el nombre oficial, con al menos un apellido y un nombre de pila.
 * Ignora acentos, mayúsculas y el orden.
 */
export function namesMatch(typed: string, official: string): boolean {
  const t = norm(typed).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (t.length < 2) return false;
  const { surnames, given } = splitOfficialName(official);
  const all = new Set([...surnames, ...given]);
  return t.every((w) => all.has(w)) && t.some((w) => surnames.includes(w)) && t.some((w) => given.includes(w));
}

const MAIL_DOMAIN = '@est.unibe.edu.do';

/**
 * El correo institucional debe ser <inicial del nombre><primer apellido><número>. Es un
 * filtro de forma; la prueba real de que es suyo es el código que llega a ese buzón.
 */
export function emailMatchesName(email: string, official: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e.endsWith(MAIL_DOMAIN)) return false;
  const m = /^([a-z]+)(\d{1,3})?$/.exec(e.slice(0, -MAIL_DOMAIN.length));
  if (!m) return false;
  const { surnames, given } = splitOfficialName(official);
  for (const g of given) {
    for (let k = 1; k <= surnames.length; k++) {
      if (m[1] === (g.charAt(0) + surnames.slice(0, k).join('')).toLowerCase()) return true;
    }
  }
  return false;
}

export function validInstitutionalEmail(raw: unknown): string | null {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[a-z]+\d{0,3}@est\.unibe\.edu\.do$/.test(e) ? e : null;
}

/** Código numérico de 6 dígitos con aleatoriedad criptográfica. */
export function newVerifyCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Hash del código ligado al usuario (el código en claro nunca se guarda). */
export async function hashVerifyCode(env: Env, userId: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${code}:${env.CLERK_SECRET_KEY}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
