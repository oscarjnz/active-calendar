import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Course, Env, IcalEvent, Profile, TaskRow } from './types';
import { fetchClerkUser } from './clerk';
import { normalizeCode, pensumName } from './pensum';

const VALID_ACCENTS = ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] as const;

/** Alias para el cliente de Supabase (lo usan otros módulos sin reimportar). */
export type SbClient = SupabaseClient;

/** Cliente con service_role: bypass RLS. Es el único que toca la base de datos. */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'active-calendar/admin' } },
  });
}

export async function getProfile(sb: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`profiles.select: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/** Obtiene el perfil; si no existe lo crea con los datos de Clerk. */
export async function ensureProfile(
  sb: SupabaseClient,
  env: Env,
  userId: string,
): Promise<Profile> {
  const existing = await getProfile(sb, userId);
  if (existing) return existing;

  const clerk = await fetchClerkUser(env, userId);
  const displayName =
    [clerk?.first_name, clerk?.last_name].filter(Boolean).join(' ').trim() ||
    clerk?.email?.split('@')[0] ||
    'Estudiante';

  const row = {
    user_id: userId,
    display_name: displayName,
    first_name: clerk?.first_name ?? null,
    last_name: clerk?.last_name ?? null,
    email: clerk?.email ?? null,
    avatar_url: clerk?.image_url ?? null,
    accent: 'neutral',
    term: null,
    courses: [],
  };
  const { data, error } = await sb.from('profiles').insert(row).select('*').single();
  if (error) throw new Error(`profiles.insert: ${error.message}`);
  return data as Profile;
}

/**
 * ¿La materia tiene un nombre real? (no vacío y distinto del propio código).
 * Si solo conocemos el código, no es una materia válida para mostrar.
 */
export function hasRealName(c: Course): boolean {
  const name = (c.name ?? '').trim();
  if (!name) return false;
  return normalizeCode(name) !== normalizeCode(c.code);
}

/**
 * Sanea una lista de materias: normaliza códigos, recorta nombres, dedup y
 * DESCARTA las que no tienen nombre real (solo código). Si el pensum conoce el
 * nombre del código, lo rellena en vez de descartar.
 */
function sanitizeCourses(input: unknown): Course[] {
  if (!Array.isArray(input)) return [];
  const byCode = new Map<string, Course>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const code = normalizeCode(String((raw as Course).code ?? ''));
    if (!code) continue;
    let name = String((raw as Course).name ?? '').trim();
    // Si no hay nombre (o es igual al código), intenta el del pensum.
    if (!name || normalizeCode(name) === code) name = pensumName(code) ?? '';
    const course: Course = { code, name };
    if (!hasRealName(course)) continue; // sin nombre real -> fuera
    if (!byCode.has(code)) byCode.set(code, course);
  }
  return [...byCode.values()];
}

export async function updateProfile(
  sb: SupabaseClient,
  userId: string,
  fields: {
    display_name?: string | null;
    ical_url?: string | null;
    accent?: string;
    term?: number | null;
    courses?: Course[];
    email_notify?: boolean;
    notify_dow?: number;
    notify_time?: string;
    telegram_notify?: boolean;
  },
): Promise<Profile> {
  const patch: Record<string, unknown> = {};
  if ('display_name' in fields) patch.display_name = fields.display_name?.trim() || null;
  if ('ical_url' in fields) patch.ical_url = fields.ical_url?.trim() || null;
  if ('email_notify' in fields) patch.email_notify = !!fields.email_notify;
  if ('telegram_notify' in fields) patch.telegram_notify = !!fields.telegram_notify;
  if ('notify_dow' in fields) {
    const d = fields.notify_dow;
    patch.notify_dow = typeof d === 'number' && d >= 1 && d <= 7 ? Math.floor(d) : 1;
  }
  if ('notify_time' in fields) {
    const t = (fields.notify_time ?? '').trim();
    // Solo HH:MM 24h válido; si no, caemos al default 07:00.
    patch.notify_time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '07:00';
  }
  if ('accent' in fields && fields.accent) {
    patch.accent = (VALID_ACCENTS as readonly string[]).includes(fields.accent)
      ? fields.accent
      : 'neutral';
  }
  if ('term' in fields) {
    const t = fields.term;
    patch.term = typeof t === 'number' && t >= 1 && t <= 12 ? Math.floor(t) : null;
  }
  if ('courses' in fields) patch.courses = sanitizeCourses(fields.courses);
  const { data, error } = await sb
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(`profiles.update: ${error.message}`);
  return data as Profile;
}

export async function listAllProfilesWithIcal(sb: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await sb.from('profiles').select('*').not('ical_url', 'is', null);
  if (error) throw new Error(`profiles.listAll: ${error.message}`);
  return (data ?? []) as Profile[];
}

export async function listWeekTasks(
  sb: SupabaseClient,
  userId: string,
  start: Date,
  end: Date,
): Promise<TaskRow[]> {
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('due', start.toISOString())
    .lte('due', end.toISOString())
    .order('due', { ascending: true });
  if (error) throw new Error(`tasks.list: ${error.message}`);
  return (data ?? []) as TaskRow[];
}

/**
 * Todas las tareas del estudiante (de cualquier semana) que ya tienen materia
 * asignada (manual o derivada). Sirve de historial para el cuarto nivel de
 * derivación por cercanía de ID de gradebook (`deriveCourseCodeByProximity`
 * en ical.ts): mientras más tareas clasificadas haya, mejor infiere las
 * genéricas nuevas.
 */
export async function listClassifiedTasks(
  sb: SupabaseClient,
  userId: string,
): Promise<Array<{ uid: string; course_code: string }>> {
  const { data, error } = await sb
    .from('tasks')
    .select('uid, course_code')
    .eq('user_id', userId)
    .not('course_code', 'is', null);
  if (error) throw new Error(`tasks.listClassified: ${error.message}`);
  return (data ?? []) as Array<{ uid: string; course_code: string }>;
}

export async function upsertEvents(
  sb: SupabaseClient,
  userId: string,
  events: IcalEvent[],
  existing: Map<string, TaskRow>,
): Promise<void> {
  if (events.length === 0) return;
  const now = new Date().toISOString();
  const rows = events.map((ev) => {
    const prev = existing.get(ev.uid);
    return {
      user_id: userId,
      uid: ev.uid,
      summary: ev.summary,
      course: ev.course ?? prev?.course ?? null,
      // La asignación manual del estudiante (prev.course_code) manda; si no hay,
      // usamos la derivada del feed. Nunca pisamos una asignación manual existente.
      course_code: prev?.course_code ?? ev.courseCode ?? null,
      due: ev.due ? ev.due.toISOString() : null,
      url: ev.url,
      last_modified: ev.lastModified ? ev.lastModified.toISOString() : null,
      status: prev?.status ?? 'pending',
      last_seen: now,
      // Siempre presente: conserva el original si la tarea ya existía, o ahora
      // si es nueva. Debe ir en TODAS las filas (ver nota en el upsert de abajo).
      first_seen: prev?.first_seen ?? now,
    };
  });
  // OJO: PostgREST construye un único INSERT con la UNIÓN de claves de todas las
  // filas; las filas que omitan una clave la mandan como NULL explícito (no usa el
  // default de la columna). Por eso first_seen va en todas las filas: si un lote
  // mezcla tareas nuevas y existentes, omitirlo en unas rompía la NOT NULL.
  const { error } = await sb.from('tasks').upsert(rows, { onConflict: 'user_id,uid' });
  if (error) throw new Error(`tasks.upsert: ${error.message}`);
}

export async function setTaskStatus(
  sb: SupabaseClient,
  userId: string,
  uid: string,
  status: 'pending' | 'done',
): Promise<void> {
  const { error } = await sb
    .from('tasks')
    .update({ status })
    .eq('user_id', userId)
    .eq('uid', uid);
  if (error) throw new Error(`tasks.setStatus: ${error.message}`);
}

/**
 * Todas las tareas del estudiante (de cualquier semana) que TODAVÍA no tienen
 * materia asignada. `syncOne` solo deriva materia para las tareas de la
 * semana actual (filterInRange); las de semanas pasadas o futuras quedan sin
 * tocar aunque el algoritmo de derivación mejore. Esta función alimenta un
 * backfill que corre en cada sync para ponerlas al día retroactivamente.
 */
export async function listUnclassifiedTasks(
  sb: SupabaseClient,
  userId: string,
): Promise<Array<{ uid: string; summary: string }>> {
  const { data, error } = await sb
    .from('tasks')
    .select('uid, summary')
    .eq('user_id', userId)
    .is('course_code', null);
  if (error) throw new Error(`tasks.listUnclassified: ${error.message}`);
  return (data ?? []) as Array<{ uid: string; summary: string }>;
}

/**
 * Aplica en lote un mapa uid -> course_code (solo toca esa columna; no afecta
 * status/first_seen/last_seen). Usado por el backfill de materias.
 */
export async function bulkSetCourseCodes(
  sb: SupabaseClient,
  userId: string,
  updates: Array<{ uid: string; course_code: string }>,
): Promise<void> {
  await Promise.all(
    updates.map(({ uid, course_code }) =>
      sb.from('tasks').update({ course_code }).eq('user_id', userId).eq('uid', uid),
    ),
  );
}

/** Asigna manualmente la materia (course_code) de una tarea. null = quitar. */
export async function setTaskCourse(
  sb: SupabaseClient,
  userId: string,
  uid: string,
  courseCode: string | null,
): Promise<void> {
  const code = courseCode ? normalizeCode(courseCode) : null;
  const { error } = await sb
    .from('tasks')
    .update({ course_code: code })
    .eq('user_id', userId)
    .eq('uid', uid);
  if (error) throw new Error(`tasks.setCourse: ${error.message}`);
}

/**
 * Fusiona materias autodescubiertas con las que ya tiene el perfil (por código).
 * Devuelve la lista combinada (las existentes mandan en el nombre).
 */
export function mergeCourses(existing: Course[], discovered: Course[]): Course[] {
  const byCode = new Map<string, Course>();
  for (const c of discovered) byCode.set(normalizeCode(c.code), { code: normalizeCode(c.code), name: c.name });
  for (const c of existing) byCode.set(normalizeCode(c.code), { code: normalizeCode(c.code), name: c.name }); // el perfil manda
  // Rellena nombres faltantes con el pensum y descarta las que sigan sin nombre real.
  const out: Course[] = [];
  for (const c of byCode.values()) {
    const name = hasRealName(c) ? c.name : (pensumName(c.code) ?? '');
    const fixed: Course = { code: c.code, name };
    if (hasRealName(fixed)) out.push(fixed);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Limpia las materias guardadas en el perfil (rellena nombres del pensum y quita
 * las que no tengan nombre real). Si cambió algo, lo persiste. Devuelve la lista
 * limpia. Sirve para auto-sanear perfiles viejos sin intervención manual.
 */
export async function cleanupProfileCourses(
  sb: SupabaseClient,
  profile: Profile,
): Promise<Course[]> {
  const current = profile.courses ?? [];
  const cleaned = mergeCourses(current, []);
  const changed =
    cleaned.length !== current.length ||
    cleaned.some((c, i) => c.code !== current[i]?.code || c.name !== current[i]?.name);
  if (changed) {
    await setProfileCourses(sb, profile.user_id, cleaned);
  }
  return cleaned;
}

/** Marca que se le acaba de enviar el correo (anti-duplicados en el cron). */
export async function markEmailed(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb
    .from('profiles')
    .update({ last_emailed: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(`profiles.markEmailed: ${error.message}`);
}

/** Marca que se le acaba de enviar el mensaje de Telegram (anti-duplicados). */
export async function markTelegramed(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb
    .from('profiles')
    .update({ last_telegram: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(`profiles.markTelegramed: ${error.message}`);
}

/** Guarda un código de vínculo de un solo uso para el usuario. */
export async function setTelegramLinkCode(
  sb: SupabaseClient,
  userId: string,
  code: string,
): Promise<void> {
  const { error } = await sb
    .from('profiles')
    .update({ telegram_link_code: code })
    .eq('user_id', userId);
  if (error) throw new Error(`profiles.setTelegramLinkCode: ${error.message}`);
}

/** Perfil vinculado a un chat de Telegram, o null. */
export async function getProfileByTelegramChatId(
  sb: SupabaseClient,
  chatId: string,
): Promise<Profile | null> {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  if (error) throw new Error(`profiles.byChatId: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/**
 * Canjea un código de vínculo: si existe un perfil con ese telegram_link_code,
 * le asocia el chat_id, limpia el código, activa el opt-in y devuelve el perfil.
 * Devuelve null si el código no existe (inválido o ya usado).
 */
export async function linkTelegram(
  sb: SupabaseClient,
  code: string,
  chatId: string,
): Promise<Profile | null> {
  const clean = code.trim();
  if (!clean) return null;
  // Garantiza unicidad: si ese chat ya estaba en otro perfil, lo libera primero.
  await sb
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_notify: false })
    .eq('telegram_chat_id', chatId);
  const { data, error } = await sb
    .from('profiles')
    .update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_notify: true })
    .eq('telegram_link_code', clean)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`profiles.linkTelegram: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/** Desvincula el chat de Telegram (lo dispara el comando /stop del bot). */
export async function unlinkTelegram(sb: SupabaseClient, chatId: string): Promise<void> {
  const { error } = await sb
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_notify: false })
    .eq('telegram_chat_id', chatId);
  if (error) throw new Error(`profiles.unlinkTelegram: ${error.message}`);
}

/** Desvincula Telegram desde la app (por user_id): limpia chat, opt-in y código. */
export async function clearTelegram(sb: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await sb
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_notify: false, telegram_link_code: null })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(`profiles.clearTelegram: ${error.message}`);
  return data as Profile;
}

/** Persiste la lista de materias del perfil (sin tocar otros campos). */
export async function setProfileCourses(
  sb: SupabaseClient,
  userId: string,
  courses: Course[],
): Promise<void> {
  const { error } = await sb.from('profiles').update({ courses }).eq('user_id', userId);
  if (error) throw new Error(`profiles.setCourses: ${error.message}`);
}
