import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env, IcalEvent, Profile, TaskRow } from './types';
import { fetchClerkUser } from './clerk';

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
  };
  const { data, error } = await sb.from('profiles').insert(row).select('*').single();
  if (error) throw new Error(`profiles.insert: ${error.message}`);
  return data as Profile;
}

export async function updateProfile(
  sb: SupabaseClient,
  userId: string,
  fields: { display_name?: string | null; ical_url?: string | null; accent?: string },
): Promise<Profile> {
  const patch: Record<string, unknown> = {};
  if ('display_name' in fields) patch.display_name = fields.display_name?.trim() || null;
  if ('ical_url' in fields) patch.ical_url = fields.ical_url?.trim() || null;
  if ('accent' in fields && fields.accent) {
    patch.accent = (VALID_ACCENTS as readonly string[]).includes(fields.accent)
      ? fields.accent
      : 'neutral';
  }
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
      course: ev.course,
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
