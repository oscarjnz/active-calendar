import type { Env } from './types';

/** SPA mínima servida por el Worker. Usa Supabase JS + Tailwind por CDN. */
export function renderApp(env: Env): string {
  // Inyectamos URL y anon key como constantes globales seguras para el cliente.
  const cfg = JSON.stringify({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    APP_BASE_URL: env.APP_BASE_URL,
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Active Calendar</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .fade-in { animation: fade .15s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body class="min-h-screen bg-neutral-50 text-neutral-900">
<div id="app" class="max-w-3xl mx-auto px-4 py-8"></div>

<script>window.__CFG__ = ${cfg};</script>
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cfg = window.__CFG__;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.getElementById('app');

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function fmtDue(iso) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  // Forzamos zona Santo Domingo (UTC-4 fijo).
  const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const dd = String(shifted.getUTCDate()).padStart(2,'0');
  const mm = months[shifted.getUTCMonth()];
  const hh = String(shifted.getUTCHours()).padStart(2,'0');
  const mi = String(shifted.getUTCMinutes()).padStart(2,'0');
  return days[shifted.getUTCDay()] + ' ' + dd + '/' + mm + ' ' + hh + ':' + mi;
}

function weekRangeSdq() {
  const now = new Date();
  const shifted = new Date(now.getTime() - 4 * 3600 * 1000);
  const dow = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - (dow - 1)));
  const start = new Date(monday.getTime() + 4 * 3600 * 1000); // UTC ms para SDQ 00:00
  const end = new Date(start.getTime() + 7 * 86400000 - 1);
  return { start, end };
}

async function renderLogin() {
  app.innerHTML = '';
  app.appendChild(el(\`
    <div class="fade-in">
      <h1 class="text-3xl font-semibold mb-2">Active Calendar</h1>
      <p class="text-neutral-600 mb-6">Tus tareas de Blackboard, todas en una sola vista. Te enviamos un enlace mágico para iniciar sesión, sin contraseñas.</p>
      <form id="login" class="bg-white border border-neutral-200 rounded-xl p-5 space-y-3 shadow-sm">
        <label class="block text-sm font-medium">Email</label>
        <input id="email" type="email" required class="w-full border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900" placeholder="tu@correo.com" />
        <button class="w-full bg-neutral-900 text-white rounded-lg py-2 font-medium hover:bg-neutral-800">Enviarme el enlace</button>
        <p id="login-msg" class="text-sm text-neutral-500"></p>
      </form>
    </div>
  \`));
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const msg = document.getElementById('login-msg');
    msg.textContent = 'Enviando…';
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: cfg.APP_BASE_URL }
    });
    msg.textContent = error ? ('Error: ' + error.message) : 'Listo. Revisa tu email y haz clic en el enlace.';
  });
}

async function loadProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function ensureProfile(user) {
  let p = await loadProfile(user.id);
  if (!p) {
    const defaultName = (user.email || '').split('@')[0];
    const { data, error } = await sb.from('profiles').insert({ user_id: user.id, display_name: defaultName }).select('*').single();
    if (error) throw error;
    p = data;
  }
  return p;
}

async function loadWeekTasks(userId) {
  const { start, end } = weekRangeSdq();
  const { data, error } = await sb.from('tasks')
    .select('*').eq('user_id', userId)
    .gte('due', start.toISOString()).lte('due', end.toISOString())
    .order('due', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function triggerSync(session) {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || ('HTTP ' + res.status));
  }
  return await res.json();
}

async function setTaskStatus(userId, uid, status) {
  const { error } = await sb.from('tasks').update({ status }).eq('user_id', userId).eq('uid', uid);
  if (error) throw error;
}

async function saveProfile(userId, fields) {
  const { error } = await sb.from('profiles').update(fields).eq('user_id', userId);
  if (error) throw error;
}

function rangeText() {
  const { start, end } = weekRangeSdq();
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const s = new Date(start.getTime() - 4*3600*1000);
  const e = new Date(end.getTime() - 4*3600*1000);
  return String(s.getUTCDate()).padStart(2,'0') + '/' + months[s.getUTCMonth()] +
         ' – ' + String(e.getUTCDate()).padStart(2,'0') + '/' + months[e.getUTCMonth()] +
         ' ' + e.getUTCFullYear();
}

async function renderDashboard(session) {
  const user = session.user;
  let profile = await ensureProfile(user);
  const tasks = await loadWeekTasks(user.id);

  app.innerHTML = '';
  app.appendChild(el(\`
    <div class="fade-in space-y-6">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">Hola, \${esc(profile.display_name || user.email)}</h1>
          <p class="text-neutral-600 text-sm">Semana \${esc(rangeText())}</p>
        </div>
        <div class="flex gap-2">
          <button id="sync" class="px-3 py-2 text-sm bg-neutral-900 text-white rounded-lg hover:bg-neutral-800">Sincronizar</button>
          <button id="logout" class="px-3 py-2 text-sm border border-neutral-300 rounded-lg hover:bg-neutral-100">Salir</button>
        </div>
      </header>

      <section class="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
        <h2 class="font-medium mb-3">Configuración</h2>
        <label class="block text-sm font-medium">Tu nombre</label>
        <input id="display_name" class="w-full border border-neutral-300 rounded-lg px-3 py-2 mb-3" value="\${esc(profile.display_name || '')}" />
        <label class="block text-sm font-medium">URL iCal de Blackboard</label>
        <input id="ical_url" class="w-full border border-neutral-300 rounded-lg px-3 py-2 mb-3 font-mono text-xs" placeholder="https://…/learn.ics" value="\${esc(profile.ical_url || '')}" />
        <details class="text-sm text-neutral-600 mb-3">
          <summary class="cursor-pointer">¿Cómo obtener mi URL iCal?</summary>
          <ol class="list-decimal ml-5 mt-2 space-y-1">
            <li>Entra al portal de Blackboard.</li>
            <li>Abre <b>Calendario</b>.</li>
            <li>Busca el botón <b>"Get External Calendar Link"</b> / <b>"Obtener enlace externo"</b> (engranaje o ⋯).</li>
            <li>Genera (o regenera) el enlace y cópialo.</li>
            <li>Pégalo arriba y guarda.</li>
          </ol>
          <p class="mt-2">El enlace es personal y contiene un token. No lo compartas con nadie. Active Calendar lo guarda cifrado en reposo (Supabase) y solo lo usa para leer tu calendario.</p>
        </details>
        <button id="save" class="px-3 py-2 text-sm bg-neutral-900 text-white rounded-lg hover:bg-neutral-800">Guardar</button>
        <span id="save-msg" class="ml-3 text-sm text-neutral-500"></span>
      </section>

      <section>
        <h2 class="font-medium mb-3">Tareas de la semana</h2>
        <div id="tasks" class="space-y-2"></div>
      </section>
    </div>
  \`));

  const list = document.getElementById('tasks');
  if (!profile.ical_url) {
    list.appendChild(el(\`<p class="text-sm text-neutral-500 bg-amber-50 border border-amber-200 rounded-lg p-3">Aún no has configurado tu URL iCal. Hazlo arriba y pulsa <b>Sincronizar</b>.</p>\`));
  } else if (tasks.length === 0) {
    list.appendChild(el(\`<p class="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-3">No hay tareas registradas esta semana. Si crees que falta algo, pulsa <b>Sincronizar</b>.</p>\`));
  } else {
    for (const t of tasks) {
      const done = t.status === 'done';
      const row = el(\`
        <label class="flex items-start gap-3 bg-white border border-neutral-200 rounded-lg p-3 cursor-pointer hover:border-neutral-300">
          <input type="checkbox" class="mt-1 h-4 w-4" \${done ? 'checked' : ''} />
          <div class="flex-1">
            <div class="text-sm \${done ? 'line-through text-neutral-400' : ''}">
              \${t.course ? '<span class="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded mr-1">' + esc(t.course) + '</span>' : ''}
              <span class="\${done ? '' : 'font-medium'}">\${esc(t.summary)}</span>
            </div>
            <div class="text-xs text-neutral-500 mt-0.5">\${esc(fmtDue(t.due))}\${t.url ? ' · <a class="underline" target="_blank" rel="noopener" href="' + esc(t.url) + '">abrir</a>' : ''}</div>
          </div>
        </label>
      \`);
      const cb = row.querySelector('input');
      cb.addEventListener('change', async () => {
        const newStatus = cb.checked ? 'done' : 'pending';
        try {
          await setTaskStatus(user.id, t.uid, newStatus);
          await renderDashboard(session);
        } catch (err) {
          alert('No se pudo actualizar: ' + err.message);
        }
      });
      list.appendChild(row);
    }
  }

  document.getElementById('save').addEventListener('click', async () => {
    const msg = document.getElementById('save-msg');
    msg.textContent = 'Guardando…';
    try {
      await saveProfile(user.id, {
        display_name: document.getElementById('display_name').value.trim() || null,
        ical_url: document.getElementById('ical_url').value.trim() || null,
      });
      msg.textContent = 'Guardado.';
      setTimeout(() => renderDashboard(session), 400);
    } catch (err) {
      msg.textContent = 'Error: ' + err.message;
    }
  });

  document.getElementById('sync').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Sincronizando…';
    try {
      const r = await triggerSync(session);
      btn.textContent = 'Listo (' + (r.weekCount ?? 0) + ')';
      await renderDashboard(session);
    } catch (err) {
      alert('Error al sincronizar: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Sincronizar';
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.href = '/';
  });
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await renderDashboard(session);
  else await renderLogin();

  sb.auth.onAuthStateChange((_event, s) => {
    if (s) renderDashboard(s);
    else renderLogin();
  });
}

boot().catch(err => {
  app.innerHTML = '<pre class="text-red-600 text-sm whitespace-pre-wrap">' + (err && err.message || err) + '</pre>';
});
</script>
</body>
</html>`;
}
