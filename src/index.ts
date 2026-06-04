import type { Env, Profile } from './types';
import { filterInRange, parseIcal } from './ical';
import { computeDelta } from './diff';
import {
  adminClient,
  listAllProfilesWithIcal,
  listWeekTasks,
  upsertEvents,
  userIdFromJwt,
} from './supabase';
import { currentWeekRangeSdq } from './time';
import { renderApp } from './html';

async function fetchIcal(url: string): Promise<string> {
  const res = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`ical fetch ${res.status}`);
  return await res.text();
}

async function syncOne(env: Env, profile: Profile): Promise<{ weekCount: number; created: number; modified: number }> {
  if (!profile.ical_url) return { weekCount: 0, created: 0, modified: 0 };
  const sb = adminClient(env);
  const raw = await fetchIcal(profile.ical_url);
  const all = parseIcal(raw);
  const { start, end } = currentWeekRangeSdq();
  const inWeek = filterInRange(all, start, end);

  const existingRows = await listWeekTasks(sb, profile.user_id, start, end);
  const existing = new Map(existingRows.map((r) => [r.uid, r]));
  const delta = computeDelta(inWeek, existing);
  await upsertEvents(sb, profile.user_id, inWeek, existing);

  return {
    weekCount: inWeek.length,
    created: delta.created.length,
    modified: delta.modified.length,
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const sb = adminClient(env);
          const profiles = await listAllProfilesWithIcal(sb);
          // Procesamos en paralelo con un limite suave para no abusar del runtime.
          const concurrency = 5;
          let i = 0;
          async function worker(): Promise<void> {
            while (i < profiles.length) {
              const p = profiles[i++]!;
              try {
                await syncOne(env, p);
              } catch (err) {
                console.error(`sync user ${p.user_id}:`, (err as Error).message);
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(concurrency, profiles.length) }, worker));
        } catch (err) {
          console.error('scheduled error:', err);
        }
      })(),
    );
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Health/root: si es GET y no es /api/*, sirve la SPA.
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      return new Response(renderApp(env), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=60',
        },
      });
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const auth = req.headers.get('authorization') ?? '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) return json({ error: 'missing token' }, { status: 401 });
      const jwt = m[1]!;
      const userId = await userIdFromJwt(env, jwt);
      if (!userId) return json({ error: 'invalid token' }, { status: 401 });

      const sb = adminClient(env);
      const { data, error } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
      if (error) return json({ error: error.message }, { status: 500 });
      const profile = data as Profile | null;
      if (!profile || !profile.ical_url) {
        return json({ error: 'profile missing ical_url' }, { status: 400 });
      }
      try {
        const result = await syncOne(env, profile);
        return json(result);
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 502 });
      }
    }

    if (url.pathname === '/api/health') return json({ ok: true });

    return new Response('Not found', { status: 404 });
  },
};
