import type { Env, IcalEvent, Profile, TaskRow } from './types';
import { normalizeCode, pensumName } from './pensum';
import { formatSdq, type AcademicWeek } from './time';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Active Calendar <onboarding@resend.dev>';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Forma mínima que necesitan las plantillas (TaskRow e IcalEvent mapeado la satisfacen). */
type TaskLike = Pick<TaskRow, 'summary' | 'course_code' | 'due'>;

/** Nombre legible de una materia: perfil > pensum > el propio código. */
function courseName(profile: Profile, code: string): string {
  const norm = normalizeCode(code);
  const fromProfile = (profile.courses ?? []).find((c) => normalizeCode(c.code) === norm);
  return fromProfile?.name ?? pensumName(norm) ?? norm;
}

/** Etiqueta "CÓDIGO · NOMBRE" en mayúsculas, o "SIN MATERIA". */
function taskCourseLabel(profile: Profile, t: TaskLike): string {
  const code = t.course_code ? normalizeCode(t.course_code) : null;
  if (!code) return 'SIN MATERIA';
  return code + ' · ' + courseName(profile, code).toUpperCase();
}

/** Agrupa tareas por materia preservando el orden de llegada. */
function groupByCourse(profile: Profile, tasks: TaskLike[]): Map<string, TaskLike[]> {
  const groups = new Map<string, TaskLike[]>();
  for (const t of tasks) {
    const label = taskCourseLabel(profile, t);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(t);
  }
  return groups;
}

function buildHtml(profile: Profile, pending: TaskRow[], week: AcademicWeek, appUrl: string): string {
  const name = (profile.first_name || profile.display_name || 'estudiante').split(' ')[0] || 'estudiante';
  const weekLine = week.week
    ? `Semana ${week.week} de 15 · ${week.blockLabel}`
    : `En receso · ${week.blockLabel}`;

  // Agrupa por materia preservando el orden de vencimiento.
  const groups = groupByCourse(profile, pending);

  const groupHtml = [...groups.entries()]
    .map(([label, tasks]) => {
      const items = tasks
        .map((t) => {
          const due = t.due ? esc(formatSdq(new Date(t.due))) : 'Sin fecha';
          return `<tr><td style="padding:6px 0;font-size:14px;color:#0a0a0a;">${esc(t.summary)}</td>` +
            `<td style="padding:6px 0;font-size:12px;color:#737373;text-align:right;white-space:nowrap;">${due}</td></tr>`;
        })
        .join('');
      return (
        `<div style="margin:18px 0 0;">` +
        `<div style="font-size:11px;font-weight:600;letter-spacing:.04em;color:#737373;margin-bottom:4px;">${esc(label)}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items}</table>` +
        `</div>`
      );
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">
  <tr><td style="padding:24px 24px 0;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="display:inline-block;width:24px;height:24px;background:#0a0a0a;border-radius:6px;text-align:center;line-height:24px;color:#fff;font-size:13px;">✓</span>
      <span style="font-size:14px;font-weight:600;color:#0a0a0a;">Active Calendar</span>
    </div>
  </td></tr>
  <tr><td style="padding:16px 24px 0;">
    <h1 style="margin:0;font-size:20px;font-weight:600;color:#0a0a0a;">Hola, ${esc(name)}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#737373;">${esc(weekLine)}</p>
    <p style="margin:14px 0 0;font-size:15px;color:#0a0a0a;">Tienes <strong>${pending.length}</strong> ${pending.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} esta semana.</p>
  </td></tr>
  <tr><td style="padding:4px 24px 0;">${groupHtml}</td></tr>
  <tr><td style="padding:24px;">
    <a href="${esc(appUrl)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:10px;">Ver mis tareas</a>
  </td></tr>
  <tr><td style="padding:0 24px 24px;">
    <p style="margin:0;font-size:11px;color:#a3a3a3;">Recibes este correo porque activaste el recordatorio semanal. Puedes cambiar el día/hora o desactivarlo en Ajustes.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Envía el recordatorio semanal por correo vía Resend. Lanza si la API responde mal.
 * Asume que ya se validó que hay pendientes y que el usuario quiere el correo.
 */
export async function sendWeeklyEmail(
  env: Env,
  profile: Profile,
  pending: TaskRow[],
  week: AcademicWeek,
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  if (!profile.email) throw new Error('profile has no email');

  const html = buildHtml(profile, pending, week, env.APP_BASE_URL);
  const subject = `${pending.length} ${pending.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} esta semana`;
  await sendViaResend(env, profile.email, subject, html);
}

async function sendViaResend(env: Env, to: string, subject: string, html: string): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || DEFAULT_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`resend ${res.status}: ${body}`);
  }
}

/** Plantilla de alerta instantánea: tareas nuevas detectadas en un sync (no el resumen semanal). */
function buildNewTasksHtml(profile: Profile, tasks: TaskLike[], week: AcademicWeek, appUrl: string): string {
  const name = (profile.first_name || profile.display_name || 'estudiante').split(' ')[0] || 'estudiante';
  const weekLine = week.week
    ? `Semana ${week.week} de 15 · ${week.blockLabel}`
    : `En receso · ${week.blockLabel}`;

  const groups = groupByCourse(profile, tasks);
  const groupHtml = [...groups.entries()]
    .map(([label, items]) => {
      const rows = items
        .map((t) => {
          const due = t.due ? esc(formatSdq(new Date(t.due))) : 'Sin fecha';
          return `<tr><td style="padding:6px 0;font-size:14px;color:#0a0a0a;">${esc(t.summary)}</td>` +
            `<td style="padding:6px 0;font-size:12px;color:#737373;text-align:right;white-space:nowrap;">${due}</td></tr>`;
        })
        .join('');
      return (
        `<div style="margin:18px 0 0;">` +
        `<div style="font-size:11px;font-weight:600;letter-spacing:.04em;color:#737373;margin-bottom:4px;">${esc(label)}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>` +
        `</div>`
      );
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">
  <tr><td style="padding:24px 24px 0;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="display:inline-block;width:24px;height:24px;background:#0a0a0a;border-radius:6px;text-align:center;line-height:24px;color:#fff;font-size:13px;">🔔</span>
      <span style="font-size:14px;font-weight:600;color:#0a0a0a;">Active Calendar</span>
    </div>
  </td></tr>
  <tr><td style="padding:16px 24px 0;">
    <h1 style="margin:0;font-size:20px;font-weight:600;color:#0a0a0a;">Hola, ${esc(name)}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#737373;">${esc(weekLine)}</p>
    <p style="margin:14px 0 0;font-size:15px;color:#0a0a0a;">Se detectaron <strong>${tasks.length}</strong> ${tasks.length === 1 ? 'tarea nueva' : 'tareas nuevas'} en Blackboard.</p>
  </td></tr>
  <tr><td style="padding:4px 24px 0;">${groupHtml}</td></tr>
  <tr><td style="padding:24px;">
    <a href="${esc(appUrl)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:10px;">Ver mis tareas</a>
  </td></tr>
  <tr><td style="padding:0 24px 24px;">
    <p style="margin:0;font-size:11px;color:#a3a3a3;">Recibes este correo porque activaste el recordatorio por correo. Puedes desactivarlo en Ajustes.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Envía una alerta instantánea de tareas nuevas (agrupadas en un solo correo). Se dispara
 * apenas un sync detecta tareas que no existían antes; a diferencia de sendWeeklyEmail, no
 * depende del día/hora elegidos por el usuario ni tiene guard de "ya enviado hoy" (cada
 * tarea solo puede ser "nueva" una vez, ver computeDelta en diff.ts).
 */
export async function sendNewTasksEmail(
  env: Env,
  profile: Profile,
  created: IcalEvent[],
  week: AcademicWeek,
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  if (!profile.email) throw new Error('profile has no email');

  const tasks: TaskLike[] = created.map((ev) => ({
    summary: ev.summary,
    course_code: ev.courseCode,
    due: ev.due ? ev.due.toISOString() : null,
  }));
  const html = buildNewTasksHtml(profile, tasks, week, env.APP_BASE_URL);
  const subject = `${created.length} ${created.length === 1 ? 'tarea nueva' : 'tareas nuevas'} en Blackboard`;
  await sendViaResend(env, profile.email, subject, html);
}
