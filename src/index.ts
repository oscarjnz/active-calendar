import type { Env, Profile } from './types';
import { filterInRange, parseIcal } from './ical';
import { computeDelta } from './diff';
import {
  adminClient,
  ensureProfile,
  getProfile,
  listAllProfilesWithIcal,
  listWeekTasks,
  setTaskStatus,
  updateProfile,
  upsertEvents,
} from './supabase';
import { getAuthUserId } from './clerk';
import { currentWeekRangeSdq } from './time';
import { renderApp } from './html';

async function fetchIcal(url: string): Promise<string> {
  const res = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`ical fetch ${res.status}`);
  return await res.text();
}

async function syncOne(
  env: Env,
  profile: Profile,
): Promise<{ weekCount: number; created: number; modified: number }> {
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

  return { weekCount: inWeek.length, created: delta.created.length, modified: delta.modified.length };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

async function requireUser(req: Request, env: Env): Promise<string | Response> {
  const userId = await getAuthUserId(req, env);
  if (!userId) return json({ error: 'unauthorized' }, { status: 401 });
  return userId;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const sb = adminClient(env);
          const profiles = await listAllProfilesWithIcal(sb);
          const concurrency = 5;
          let i = 0;
          const worker = async (): Promise<void> => {
            while (i < profiles.length) {
              const p = profiles[i++]!;
              try {
                await syncOne(env, p);
              } catch (err) {
                console.error(`sync user ${p.user_id}:`, (err as Error).message);
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(concurrency, profiles.length) }, worker));
        } catch (err) {
          console.error('scheduled error:', err);
        }
      })(),
    );
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // SPA.
    if (req.method === 'GET' && !path.startsWith('/api/')) {
      return new Response(renderApp(env), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (path === '/api/health') return json({ ok: true });

    // --- API autenticada con Clerk ---
    const sb = adminClient(env);

    if (path === '/api/me' && req.method === 'GET') {
      const u = await requireUser(req, env);
      if (u instanceof Response) return u;
      try {
        const profile = await ensureProfile(sb, env, u);
        const { start, end } = currentWeekRangeSdq();
        const tasks = await listWeekTasks(sb, u, start, end);
        return json({ profile, tasks, range: { start: start.toISOString(), end: end.toISOString() } });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 });
      }
    }

    if (path === '/api/profile' && req.method === 'POST') {
      const u = await requireUser(req, env);
      if (u instanceof Response) return u;
      try {
        const body = (await req.json()) as {
          display_name?: string | null;
          ical_url?: string | null;
          accent?: string;
        };
        const profile = await updateProfile(sb, u, body);
        return json({ profile });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
      }
    }

    if (path === '/api/task' && req.method === 'POST') {
      const u = await requireUser(req, env);
      if (u instanceof Response) return u;
      try {
        const body = (await req.json()) as { uid?: string; status?: 'pending' | 'done' };
        if (!body.uid || (body.status !== 'pending' && body.status !== 'done')) {
          return json({ error: 'bad request' }, { status: 400 });
        }
        await setTaskStatus(sb, u, body.uid, body.status);
        return json({ ok: true });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
      }
    }

    if (path === '/api/sync' && req.method === 'POST') {
      const u = await requireUser(req, env);
      if (u instanceof Response) return u;
      try {
        const profile = await getProfile(sb, u);
        if (!profile || !profile.ical_url) {
          return json({ error: 'profile missing ical_url' }, { status: 400 });
        }
        const result = await syncOne(env, profile);
        const { start, end } = currentWeekRangeSdq();
        const tasks = await listWeekTasks(sb, u, start, end);
        return json({ ...result, tasks });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 502 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
