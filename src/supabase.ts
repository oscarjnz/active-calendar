import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Course, Env, IcalEvent, Profile, TaskRow } from './types';
import { fetchClerkUser } from './clerk';
import { normalizeCode } from './pensum';

const VALID_ACCENTS = ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] as const;

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

/** Sanea una lista de materias: normaliza códigos, recorta nombres y dedup. */
function sanitizeCourses(input: unknown): Course[] {
  if (!Array.isArray(input)) return [];
  const byCode = new Map<string, Course>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const code = normalizeCode(String((raw as Course).code ?? ''));
    if (!code) continue;
    const name = String((raw as Course).name ?? '').trim() || code;
    if (!byCode.has(code)) byCode.set(code, { code, name });
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
  },
): Promise<Profile> {
  const patch: Record<string, unknown> = {};
  if ('display_name' in fields) patch.display_name = fields.display_name?.trim() || null;
  if ('ical_url' in fields) patch.ical_url = fields.ical_url?.trim() || null;
  if ('email_notify' in fields) patch.email_notify = !!fields.email_notify;
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
      ...(prev ? {} : { first_seen: now }),
    };
  });
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
  for (const c of discovered) byCode.set(c.code, c);
  for (const c of existing) byCode.set(c.code, c); // las del perfil tienen prioridad
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Marca que se le acaba de enviar el correo (anti-duplicados en el cron). */
export async function markEmailed(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb
    .from('profiles')
    .update({ last_emailed: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(`profiles.markEmailed: ${error.message}`);
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
