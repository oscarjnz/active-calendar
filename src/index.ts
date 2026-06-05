import type { Env, Profile } from './types';
import { collectEnrolledCourses, deriveCourseCode, filterInRange, parseIcal } from './ical';
import { computeDelta } from './diff';
import {
  adminClient,
  ensureProfile,
  getProfile,
  listAllProfilesWithIcal,
  listWeekTasks,
  markEmailed,
  mergeCourses,
  setProfileCourses,
  setTaskCourse,
  setTaskStatus,
  updateProfile,
  upsertEvents,
} from './supabase';
import { getAuthUserId } from './clerk';
import { currentAcademicWeek, currentWeekRangeSdq, toSdqParts } from './time';
import { sendWeeklyEmail } from './email';
import { renderApp } from './html';

// Logo / favicon: marca minimalista (calendario + check) en SVG. Se sirve como
// archivo y también se reutiliza incrustado en el HTML (ver html.ts).
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="#0a0a0a"/>
<path d="M11 7.5v3M21 7.5v3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
<rect x="7" y="9.5" width="18" height="15" rx="3.2" fill="none" stroke="#fff" stroke-width="2"/>
<path d="M11.5 17.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

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

  // 1) Descubrir materias matriculadas desde las sesiones de clase (todo el feed)
  //    y fusionarlas con las que el estudiante ya tenga en su perfil.
  const discovered = collectEnrolledCourses(all);
  const courses = mergeCourses(profile.courses ?? [], discovered);
  if (discovered.length > 0) {
    await setProfileCourses(sb, profile.user_id, courses);
  }

  // 2) Solo las tareas/entregas (no las sesiones) se guardan como tareas.
  const { start, end } = currentWeekRangeSdq();
  const inWeek = filterInRange(all, start, end).filter((ev) => !ev.isSession);
  // Derivar la materia de cada tarea contra las materias matriculadas.
  for (const ev of inWeek) {
    if (!ev.courseCode) ev.courseCode = deriveCourseCode(ev.summary, courses);
  }

  const existingRows = await listWeekTasks(sb, profile.user_id, start, end);
  const existing = new Map(existingRows.map((r) => [r.uid, r]));
  const delta = computeDelta(inWeek, existing);
  await upsertEvents(sb, profile.user_id, inWeek, existing);

  return { weekCount: inWeek.length, created: delta.created.length, modified: delta.modified.length };
}

function sameSdqDay(a: Date, b: Date): boolean {
  const pa = toSdqParts(a);
  const pb = toSdqParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** True si ya pasó la hora local SDQ ("HH:MM") que el usuario eligió para hoy. */
function notifyTimeReached(notifyTime: string | null, now: Date): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((notifyTime ?? '07:00').trim());
  const h = m ? parseInt(m[1]!, 10) : 7;
  const min = m ? parseInt(m[2]!, 10) : 0;
  const p = toSdqParts(now);
  return p.hour * 60 + p.minute >= h * 60 + min;
}

/**
 * Envía el recordatorio SEMANAL por correo si corresponde: el usuario lo quiere,
 * tiene correo, hoy es SU día elegido, ya pasó SU hora, hay pendientes y no se le
 * ha enviado hoy. Como solo un día de la semana coincide, sale un correo/semana.
 * Silencioso si no aplica.
 */
async function maybeEmail(
  env: Env,
  sb: ReturnType<typeof adminClient>,
  profile: Profile,
  now: Date,
): Promise<void> {
  if (!env.RESEND_API_KEY || !profile.email || !profile.email_notify) return;
  if (profile.last_emailed && sameSdqDay(new Date(profile.last_emailed), now)) return;
  const dow = profile.notify_dow >= 1 && profile.notify_dow <= 7 ? profile.notify_dow : 1;
  if (toSdqParts(now).weekday !== dow) return;
  if (!notifyTimeReached(profile.notify_time, now)) return;
  const { start, end } = currentWeekRangeSdq();
  const tasks = await listWeekTasks(sb, profile.user_id, start, end);
  const pending = tasks.filter((t) => t.status === 'pending');
  if (pending.length === 0) return;
  await sendWeeklyEmail(env, profile, pending, currentAcademicWeek());
  await markEmailed(sb, profile.user_id);
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
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const sb = adminClient(env);
          const profiles = await listAllProfilesWithIcal(sb);
          const now = new Date();
          // El iCal se sincroniza solo en las corridas "pesadas" (3/día). El
          // chequeo de correo corre en cada tick (cada 30 min) para respetar la
          // hora personalizada de cada usuario; el guard de "ya enviado hoy" evita
          // duplicados.
          const SYNC_CRONS = ['0 11 * * *', '0 15 * * *', '0 23 * * *'];
          const doSync = SYNC_CRONS.includes(event.cron);
          const concurrency = 5;
          let i = 0;
          const worker = async (): Promise<void> => {
            while (i < profiles.length) {
              const p = profiles[i++]!;
              if (doSync) {
                try {
                  await syncOne(env, p);
                } catch (err) {
                  console.error(`sync user ${p.user_id}:`, (err as Error).message);
                }
              }
              try {
                await maybeEmail(env, sb, p, now);
              } catch (err) {
                console.error(`email user ${p.user_id}:`, (err as Error).message);
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

    // Favicon / icono (SVG). Lo piden el navegador y el <link> del HTML.
    if (req.method === 'GET' && (path === '/favicon.svg' || path === '/favicon.ico' || path === '/icon.svg')) {
      return new Response(FAVICON_SVG, {
        headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      });
    }

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
          term?: number | null;
          courses?: { code: string; name: string }[];
          email_notify?: boolean;
          notify_dow?: number;
          notify_time?: string;
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
        const body = (await req.json()) as {
          uid?: string;
          status?: 'pending' | 'done';
          course_code?: string | null;
        };
        if (!body.uid) return json({ error: 'bad request' }, { status: 400 });
        // Asignación de materia (puede venir sola o junto al status).
        if ('course_code' in body) {
          await setTaskCourse(sb, u, body.uid, body.course_code ?? null);
        }
        if (body.status === 'pending' || body.status === 'done') {
          await setTaskStatus(sb, u, body.uid, body.status);
        } else if (!('course_code' in body)) {
          return json({ error: 'bad request' }, { status: 400 });
        }
        return json({ ok: true });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
      }
    }

    if (path === '/api/test-email' && req.method === 'POST') {
      const u = await requireUser(req, env);
      if (u instanceof Response) return u;
      try {
        if (!env.RESEND_API_KEY) {
          return json({ error: 'RESEND_API_KEY no está configurada en el Worker' }, { status: 400 });
        }
        const profile = await getProfile(sb, u);
        if (!profile || !profile.email) {
          return json({ error: 'tu perfil no tiene un correo asociado' }, { status: 400 });
        }
        const { start, end } = currentWeekRangeSdq();
        const tasks = await listWeekTasks(sb, u, start, end);
        const pending = tasks.filter((t) => t.status === 'pending');
        // Es una prueba: se envía aunque no haya pendientes para ver el formato.
        await sendWeeklyEmail(env, profile, pending, currentAcademicWeek());
        return json({ ok: true, sent_to: profile.email, pending: pending.length });
      } catch (err) {
        return json({ error: (err as Error).message }, { status: 502 });
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
