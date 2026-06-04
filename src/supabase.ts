import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env, IcalEvent, Profile, TaskRow } from './types';

/** Cliente con service_role: bypass RLS. Solo para el Worker (cron + sync por usuario). */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'active-calendar/admin' } },
  });
}

/** Cliente con anon key + JWT del usuario; respeta RLS. */
export function userClient(env: Env, jwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'X-Client-Info': 'active-calendar/user',
      },
    },
  });
}

/** Verifica el JWT y devuelve el user_id, o null. */
export async function userIdFromJwt(env: Env, jwt: string): Promise<string | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

export async function getProfile(sb: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles.select: ${error.message}`);
  return (data as Profile | null) ?? null;
}

export async function listAllProfilesWithIcal(sb: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .not('ical_url', 'is', null);
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
