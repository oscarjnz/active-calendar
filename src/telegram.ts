import type { Env, Profile, TaskRow } from './types';
import { normalizeCode, pensumName } from './pensum';
import { formatSdq, currentAcademicWeek, currentWeekRangeSdq, type AcademicWeek } from './time';
import {
  type SbClient,
  getProfileByTelegramChatId,
  linkTelegram,
  listWeekTasks,
  unlinkTelegram,
} from './supabase';

const API = 'https://api.telegram.org';

/** Escapa texto para parse_mode=HTML de Telegram. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Nombre legible de una materia: perfil > pensum > el propio código. */
function courseName(profile: Profile, code: string): string {
  const norm = normalizeCode(code);
  const fromProfile = (profile.courses ?? []).find((c) => normalizeCode(c.code) === norm);
  return fromProfile?.name ?? pensumName(norm) ?? norm;
}

/** Etiqueta "CÓDIGO · NOMBRE" en mayúsculas, o "SIN MATERIA". */
function taskCourseLabel(profile: Profile, t: TaskRow): string {
  const code = t.course_code ? normalizeCode(t.course_code) : null;
  if (!code) return 'SIN MATERIA';
  return code + ' · ' + courseName(profile, code).toUpperCase();
}

/** Envía un mensaje de Telegram. Lanza si la API responde mal. */
export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  text: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telegram ${res.status}: ${body}`);
  }
}

/** Primer nombre del estudiante para saludarlo. */
function firstName(profile: Profile): string {
  return (profile.first_name || profile.display_name || 'estudiante').split(' ')[0] || 'estudiante';
}

/** Construye el texto (HTML) de la lista de pendientes agrupada por materia. */
function buildTasksText(profile: Profile, pending: TaskRow[], week: AcademicWeek, appUrl: string): string {
  const weekLine = week.week
    ? `Semana ${week.week} de 15 · ${week.blockLabel}`
    : `En receso · ${week.blockLabel}`;

  const head =
    `🗓️ <b>Active Calendar</b>\n` +
    `Hola, ${esc(firstName(profile))}\n` +
    `<i>${esc(weekLine)}</i>\n\n`;

  if (pending.length === 0) {
    return head + `🎉 No tienes tareas pendientes esta semana. ¡A descansar!`;
  }

  // Agrupa por materia preservando el orden de vencimiento.
  const groups = new Map<string, TaskRow[]>();
  for (const t of pending) {
    const label = taskCourseLabel(profile, t);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(t);
  }

  let body = `Tienes <b>${pending.length}</b> ${pending.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} esta semana.\n`;
  for (const [label, tasks] of groups) {
    body += `\n<b>${esc(label)}</b>\n`;
    for (const t of tasks) {
      const due = t.due ? esc(formatSdq(new Date(t.due))) : 'Sin fecha';
      body += `• ${esc(t.summary)} — <i>${due}</i>\n`;
    }
  }
  body += `\n<a href="${esc(appUrl)}">Abrir Active Calendar</a>`;
  return head + body;
}

/** Envía el recordatorio semanal por Telegram. Asume pendientes>0 y opt-in. */
export async function sendWeeklyTelegram(
  env: Env,
  profile: Profile,
  pending: TaskRow[],
  week: AcademicWeek,
): Promise<void> {
  if (!profile.telegram_chat_id) throw new Error('profile has no telegram_chat_id');
  const text = buildTasksText(profile, pending, week, env.APP_BASE_URL);
  await sendTelegramMessage(env, profile.telegram_chat_id, text);
}

/** Genera un código de vínculo de un solo uso (corto y legible). */
export function newLinkCode(): string {
  // 8 chars base36 sin ambigüedades; suficiente entropía para un código efímero.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

// ─── Webhook: procesa los mensajes entrantes del bot ───

interface TgUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
    from?: { first_name?: string };
  };
}

/** Texto de ayuda con los comandos disponibles. */
function helpText(linked: boolean): string {
  const base =
    `🗓️ <b>Active Calendar</b>\n\n` +
    `Comandos:\n` +
    `• /tareas — tus pendientes de la semana\n` +
    `• /semana — resumen de la semana\n` +
    `• /stop — desconectar este chat\n`;
  if (!linked) {
    return (
      `👋 ¡Hola! Para recibir tus recordatorios, conéctate desde la app:\n` +
      `Ajustes → Recordatorio por Telegram → <b>Conectar Telegram</b>.\n\n` +
      base
    );
  }
  return base;
}

/**
 * Procesa un update del webhook de Telegram. Devuelve true si lo manejó.
 * Es tolerante a errores: nunca lanza (responde silencioso para que Telegram
 * no reintente en bucle).
 */
export async function handleTelegramUpdate(
  env: Env,
  sb: SbClient,
  raw: unknown,
): Promise<void> {
  const update = (raw ?? {}) as TgUpdate;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text ?? '').trim();
  if (chatId === undefined || chatId === null) return;
  const chat = String(chatId);

  try {
    // /start <code> -> vincula la cuenta; /start solo -> saludo.
    if (text.startsWith('/start')) {
      const code = text.slice('/start'.length).trim();
      if (code) {
        const profile = await linkTelegram(sb, code, chat);
        if (profile) {
          await sendTelegramMessage(
            env,
            chat,
            `✅ <b>¡Conectado!</b> Hola, ${esc(firstName(profile))}.\n` +
              `Te enviaré tu recordatorio semanal por aquí. Usa /tareas para verlas ahora.`,
          );
        } else {
          await sendTelegramMessage(
            env,
            chat,
            `⚠️ Ese enlace de conexión no es válido o ya se usó. Genera uno nuevo desde la app (Ajustes → Conectar Telegram).`,
          );
        }
        return;
      }
      const existing = await getProfileByTelegramChatId(sb, chat);
      await sendTelegramMessage(env, chat, helpText(!!existing));
      return;
    }

    if (text === '/stop') {
      await unlinkTelegram(sb, chat);
      await sendTelegramMessage(env, chat, `🔕 Listo, desconecté este chat. No recibirás más recordatorios por Telegram.\nPuedes reconectarlo cuando quieras desde la app.`);
      return;
    }

    if (text === '/tareas' || text === '/semana' || text === '/start@') {
      const profile = await getProfileByTelegramChatId(sb, chat);
      if (!profile) {
        await sendTelegramMessage(env, chat, helpText(false));
        return;
      }
      const { start, end } = currentWeekRangeSdq();
      const tasks = await listWeekTasks(sb, profile.user_id, start, end);
      const pending = tasks.filter((t) => t.status === 'pending');
      if (text === '/semana') {
        const wk = currentAcademicWeek();
        const wl = wk.week ? `Semana ${wk.week} de 15 · ${wk.blockLabel}` : `En receso · ${wk.blockLabel}`;
        await sendTelegramMessage(
          env,
          chat,
          `🗓️ <b>${esc(wl)}</b>\nPendientes: <b>${pending.length}</b> de ${tasks.length} tareas.\nUsa /tareas para el detalle.`,
        );
        return;
      }
      await sendTelegramMessage(env, chat, buildTasksText(profile, pending, currentAcademicWeek(), env.APP_BASE_URL));
      return;
    }

    // Cualquier otro texto -> ayuda.
    const existing = await getProfileByTelegramChatId(sb, chat);
    await sendTelegramMessage(env, chat, helpText(!!existing));
  } catch (err) {
    console.error('telegram update error:', (err as Error).message);
  }
}
