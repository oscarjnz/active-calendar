import type { Env } from './types';

/** SPA servida por el Worker. Login con Clerk; datos vía el API del Worker. */
export function renderApp(env: Env): string {
  const cfg = JSON.stringify({
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY ?? null,
    APP_BASE_URL: env.APP_BASE_URL ?? null,
  });

  return `<!DOCTYPE html>
<html lang="es" class="h-full">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0a0a0a" />
<title>Active Calendar</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .fade-in { animation: fade .18s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .spin { animation: sp 1s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 9999px; }
</style>
</head>
<body class="h-full bg-neutral-50 text-neutral-900">
<div id="root" class="min-h-full"></div>

<script>window.__CFG__ = ${cfg};</script>
<script type="module">
import { Clerk } from 'https://esm.sh/@clerk/clerk-js@5';

const cfg = window.__CFG__;
const root = document.getElementById('root');

if (!cfg.CLERK_PUBLISHABLE_KEY) {
  root.innerHTML = '<div class="max-w-lg mx-auto mt-20 bg-amber-50 border border-amber-300 rounded-xl p-6">' +
    '<h1 class="text-xl font-semibold mb-2">Falta configuración</h1>' +
    '<p class="text-sm text-neutral-700">El Worker no tiene <code class="bg-neutral-200 px-1 rounded">CLERK_PUBLISHABLE_KEY</code>. ' +
    'Cárgala en Cloudflare (Settings → Variables) y vuelve a desplegar.</p></div>';
  throw new Error('Falta CLERK_PUBLISHABLE_KEY');
}

// ---------- utilidades ----------
const ACCENTS = {
  neutral: { solid: 'bg-neutral-900 hover:bg-neutral-800', text: 'text-neutral-900', soft: 'bg-neutral-100', ring: 'focus:ring-neutral-900', bar: 'bg-neutral-900', dot: 'bg-neutral-900' },
  indigo:  { solid: 'bg-indigo-600 hover:bg-indigo-700', text: 'text-indigo-700', soft: 'bg-indigo-50', ring: 'focus:ring-indigo-600', bar: 'bg-indigo-600', dot: 'bg-indigo-600' },
  emerald: { solid: 'bg-emerald-600 hover:bg-emerald-700', text: 'text-emerald-700', soft: 'bg-emerald-50', ring: 'focus:ring-emerald-600', bar: 'bg-emerald-600', dot: 'bg-emerald-600' },
  rose:    { solid: 'bg-rose-600 hover:bg-rose-700', text: 'text-rose-700', soft: 'bg-rose-50', ring: 'focus:ring-rose-600', bar: 'bg-rose-600', dot: 'bg-rose-600' },
  amber:   { solid: 'bg-amber-500 hover:bg-amber-600', text: 'text-amber-700', soft: 'bg-amber-50', ring: 'focus:ring-amber-500', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  sky:     { solid: 'bg-sky-600 hover:bg-sky-700', text: 'text-sky-700', soft: 'bg-sky-50', ring: 'focus:ring-sky-600', bar: 'bg-sky-600', dot: 'bg-sky-600' },
};
function ac() { return ACCENTS[state.profile?.accent] || ACCENTS.neutral; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function fmtDue(iso) {
  if (!iso) return 'Sin fecha';
  const d = new Date(new Date(iso).getTime() - 4 * 3600 * 1000); // a SDQ
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return days[d.getUTCDay()] + ' ' + String(d.getUTCDate()).padStart(2,'0') + '/' + months[d.getUTCMonth()] +
         ' · ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
}
function rangeText(r) {
  if (!r) return '';
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const s = new Date(new Date(r.start).getTime() - 4*3600*1000);
  const e = new Date(new Date(r.end).getTime() - 4*3600*1000);
  return String(s.getUTCDate()).padStart(2,'0')+'/'+months[s.getUTCMonth()]+' – '+String(e.getUTCDate()).padStart(2,'0')+'/'+months[e.getUTCMonth()]+' '+e.getUTCFullYear();
}

// ---------- estado + API ----------
const clerk = new Clerk(cfg.CLERK_PUBLISHABLE_KEY);
const state = { profile: null, tasks: [], range: null, tab: 'resumen', filter: 'all' };

async function api(path, opts = {}) {
  const token = await clerk.session.getToken();
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.text().catch(()=>'')) || ('HTTP ' + res.status));
  return res.json();
}

// ---------- render: login ----------
function renderLanding() {
  root.innerHTML = '';
  const wrap = el(\`
    <div class="fade-in min-h-screen grid md:grid-cols-2">
      <div class="hidden md:flex flex-col justify-center px-12 bg-neutral-900 text-white">
        <h1 class="text-4xl font-semibold tracking-tight">Active Calendar</h1>
        <p class="mt-4 text-neutral-300 max-w-sm">Todas tus tareas de Blackboard de la semana, organizadas por materia, en una sola vista. Sin instalar nada.</p>
        <ul class="mt-8 space-y-2 text-sm text-neutral-400">
          <li>· Resumen de progreso de la semana</li>
          <li>· Tareas agrupadas por materia</li>
          <li>· Marca lo que vas completando</li>
          <li>· Se sincroniza solo varias veces al día</li>
        </ul>
      </div>
      <div class="flex items-center justify-center p-6">
        <div class="w-full max-w-sm">
          <h2 class="text-2xl font-semibold mb-1 md:hidden">Active Calendar</h2>
          <p class="text-neutral-600 mb-6 md:hidden">Tus tareas de Blackboard en un solo lugar.</p>
          <div id="signin"></div>
        </div>
      </div>
    </div>
  \`);
  root.appendChild(wrap);
  clerk.mountSignIn(document.getElementById('signin'), { afterSignInUrl: cfg.APP_BASE_URL, afterSignUpUrl: cfg.APP_BASE_URL });
}

// ---------- render: onboarding (sin enlace) ----------
function renderOnboarding() {
  root.innerHTML = '';
  const a = ac();
  const wrap = el(\`
    <div class="fade-in max-w-xl mx-auto px-4 py-10">
      <div id="topbar" class="flex justify-end mb-6"></div>
      <h1 class="text-2xl font-semibold mb-1">Hola, \${esc(state.profile.display_name || '')}</h1>
      <p class="text-neutral-600 mb-6">Solo falta un paso: conecta tu calendario de Blackboard.</p>
      <div class="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-3">
        <label class="block text-sm font-medium">URL iCal de Blackboard</label>
        <input id="ical" class="w-full border border-neutral-300 rounded-lg px-3 py-2 font-mono text-xs \${a.ring} focus:outline-none focus:ring-2" placeholder="https://…/learn.ics" />
        <details class="text-sm text-neutral-600">
          <summary class="cursor-pointer select-none">¿Cómo obtengo mi enlace? (paso a paso)</summary>
          <ol class="list-decimal ml-5 mt-2 space-y-1">
            <li>Entra al portal de Blackboard de tu universidad.</li>
            <li>Abre el <b>Calendario</b>.</li>
            <li>Busca <b>"Get External Calendar Link"</b> / <b>"Obtener enlace externo"</b> (icono de engranaje o ⋯).</li>
            <li>Genera (o regenera) el enlace y cópialo. Debe terminar en <code>.ics</code>.</li>
            <li>Pégalo aquí arriba.</li>
          </ol>
          <p class="mt-2 text-neutral-500">El enlace es personal. No lo compartas con nadie.</p>
        </details>
        <button id="save" class="\${a.solid} text-white rounded-lg px-4 py-2 font-medium">Guardar y sincronizar</button>
        <span id="msg" class="ml-2 text-sm text-neutral-500"></span>
      </div>
    </div>
  \`);
  root.appendChild(wrap);
  mountUserButton(document.getElementById('topbar'));

  document.getElementById('save').addEventListener('click', async () => {
    const msg = document.getElementById('msg');
    const url = document.getElementById('ical').value.trim();
    if (!url) { msg.textContent = 'Pega tu enlace primero.'; return; }
    msg.textContent = 'Guardando…';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ ical_url: url }) });
      state.profile = r.profile;
      msg.textContent = 'Sincronizando…';
      const s = await api('/api/sync', { method: 'POST' });
      state.tasks = s.tasks || [];
      renderApp2();
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  });
}

function mountUserButton(node) {
  clerk.mountUserButton(node, { afterSignOutUrl: cfg.APP_BASE_URL });
}

// ---------- render: app principal ----------
function stats() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.status === 'done').length;
  return { total, done, pending: total - done, pct: total ? Math.round(done / total * 100) : 0 };
}
function byCourse() {
  const map = new Map();
  for (const t of state.tasks) {
    const k = t.course || 'Sin materia';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()].sort((a,b) => a[0].localeCompare(b[0]));
}

function taskRow(t) {
  const a = ac();
  const done = t.status === 'done';
  const row = el(\`
    <label class="flex items-start gap-3 bg-white border border-neutral-200 rounded-lg p-3 cursor-pointer hover:border-neutral-300 transition">
      <input type="checkbox" class="mt-0.5 h-4 w-4 accent-neutral-900" \${done ? 'checked' : ''} />
      <div class="flex-1 min-w-0">
        <div class="text-sm \${done ? 'line-through text-neutral-400' : 'font-medium'}">\${esc(t.summary)}</div>
        <div class="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2">
          <span>\${esc(fmtDue(t.due))}</span>
          \${t.course ? '<span class="'+a.text+'">'+esc(t.course)+'</span>' : ''}
          \${t.url ? '<a class="underline" target="_blank" rel="noopener" href="'+esc(t.url)+'">abrir en Blackboard</a>' : ''}
        </div>
      </div>
    </label>
  \`);
  row.querySelector('input').addEventListener('change', async (e) => {
    const ns = e.target.checked ? 'done' : 'pending';
    e.target.disabled = true;
    try {
      await api('/api/task', { method: 'POST', body: JSON.stringify({ uid: t.uid, status: ns }) });
      const local = state.tasks.find(x => x.uid === t.uid);
      if (local) local.status = ns;
      renderTab();
    } catch (err) {
      alert('No se pudo actualizar: ' + err.message);
      e.target.checked = !e.target.checked;
      e.target.disabled = false;
    }
  });
  return row;
}

function renderResumen(node) {
  const a = ac();
  const s = stats();
  const upcoming = state.tasks.filter(t => t.status === 'pending').slice(0, 5);
  node.appendChild(el(\`
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-white border border-neutral-200 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.pending}</div><div class="text-xs text-neutral-500">Pendientes</div></div>
      <div class="bg-white border border-neutral-200 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.done}</div><div class="text-xs text-neutral-500">Hechas</div></div>
      <div class="bg-white border border-neutral-200 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.total}</div><div class="text-xs text-neutral-500">Total</div></div>
    </div>
  \`));
  node.appendChild(el(\`
    <div class="bg-white border border-neutral-200 rounded-xl p-4 mt-3">
      <div class="flex justify-between text-sm mb-2"><span class="font-medium">Progreso de la semana</span><span class="\${a.text} font-semibold">\${s.pct}%</span></div>
      <div class="h-2 bg-neutral-100 rounded-full overflow-hidden"><div class="\${a.bar} h-full" style="width:\${s.pct}%"></div></div>
    </div>
  \`));
  const up = el('<div class="mt-4"><h3 class="text-sm font-medium mb-2">Próximas pendientes</h3><div class="space-y-2"></div></div>');
  const list = up.querySelector('div.space-y-2');
  if (upcoming.length === 0) list.appendChild(el('<p class="text-sm text-neutral-500">Nada pendiente. ¡Bien ahí!</p>'));
  else upcoming.forEach(t => list.appendChild(taskRow(t)));
  node.appendChild(up);
}

function renderMaterias(node) {
  const a = ac();
  const groups = byCourse();
  if (groups.length === 0) { node.appendChild(el('<p class="text-sm text-neutral-500">No hay tareas esta semana.</p>')); return; }
  for (const [course, tasks] of groups) {
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = Math.round(done / tasks.length * 100);
    const card = el(\`
      <div class="bg-white border border-neutral-200 rounded-xl p-4 mb-3">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-semibold flex items-center gap-2"><span class="inline-block h-2.5 w-2.5 rounded-full \${a.dot}"></span>\${esc(course)}</h3>
          <span class="text-xs text-neutral-500">\${done}/\${tasks.length}</span>
        </div>
        <div class="h-1.5 bg-neutral-100 rounded-full overflow-hidden mb-3"><div class="\${a.bar} h-full" style="width:\${pct}%"></div></div>
        <div class="space-y-2"></div>
      </div>
    \`);
    const list = card.querySelector('div.space-y-2');
    tasks.forEach(t => list.appendChild(taskRow(t)));
    node.appendChild(card);
  }
}

function renderTodas(node) {
  const a = ac();
  const chips = el(\`<div class="flex gap-2 mb-3">
    \${['all','pending','done'].map(f => '<button data-f="'+f+'" class="chip px-3 py-1.5 rounded-full text-sm border '+(state.filter===f?(a.solid+' text-white border-transparent'):'border-neutral-300 text-neutral-700 bg-white')+'">'+({all:'Todas',pending:'Pendientes',done:'Hechas'}[f])+'</button>').join('')}
  </div>\`);
  chips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; renderTab(); }));
  node.appendChild(chips);

  let list = state.tasks.slice();
  if (state.filter === 'pending') list = list.filter(t => t.status === 'pending');
  if (state.filter === 'done') list = list.filter(t => t.status === 'done');
  const box = el('<div class="space-y-2"></div>');
  if (list.length === 0) box.appendChild(el('<p class="text-sm text-neutral-500">Nada por aquí.</p>'));
  else list.forEach(t => box.appendChild(taskRow(t)));
  node.appendChild(box);
}

function renderAjustes(node) {
  const a = ac();
  const p = state.profile;
  const card = el(\`
    <div class="space-y-4">
      <div class="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
        <h3 class="font-medium">Perfil</h3>
        <label class="block text-sm">Nombre para mostrar</label>
        <input id="dn" class="w-full border border-neutral-300 rounded-lg px-3 py-2 \${a.ring} focus:outline-none focus:ring-2" value="\${esc(p.display_name||'')}" />
        <p class="text-xs text-neutral-500">Correo: \${esc(p.email||'—')}</p>
      </div>
      <div class="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
        <h3 class="font-medium">Calendario de Blackboard</h3>
        <label class="block text-sm">URL iCal</label>
        <input id="ical" class="w-full border border-neutral-300 rounded-lg px-3 py-2 font-mono text-xs \${a.ring} focus:outline-none focus:ring-2" value="\${esc(p.ical_url||'')}" placeholder="https://…/learn.ics" />
      </div>
      <div class="bg-white border border-neutral-200 rounded-xl p-5">
        <h3 class="font-medium mb-3">Color de acento</h3>
        <div id="accents" class="flex gap-3"></div>
      </div>
      <div class="flex items-center gap-3">
        <button id="save" class="\${a.solid} text-white rounded-lg px-4 py-2 font-medium">Guardar cambios</button>
        <button id="resync" class="border border-neutral-300 rounded-lg px-4 py-2">Sincronizar ahora</button>
        <span id="msg" class="text-sm text-neutral-500"></span>
      </div>
    </div>
  \`);
  node.appendChild(card);

  const accents = card.querySelector('#accents');
  Object.keys(ACCENTS).forEach(name => {
    const sel = p.accent === name;
    const sw = el('<button data-a="'+name+'" class="h-8 w-8 rounded-full '+ACCENTS[name].bar+' ring-offset-2 '+(sel?'ring-2 ring-neutral-900':'')+'" title="'+name+'"></button>');
    sw.addEventListener('click', () => { state.profile.accent = name; renderTab(); });
    accents.appendChild(sw);
  });

  card.querySelector('#save').addEventListener('click', async () => {
    const msg = card.querySelector('#msg');
    msg.textContent = 'Guardando…';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({
        display_name: card.querySelector('#dn').value.trim(),
        ical_url: card.querySelector('#ical').value.trim(),
        accent: state.profile.accent,
      })});
      state.profile = r.profile;
      msg.textContent = 'Guardado.';
      renderShell();
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  });

  card.querySelector('#resync').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Sincronizando…';
    try { const s = await api('/api/sync', { method: 'POST' }); state.tasks = s.tasks || []; renderShell(); }
    catch (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = old; }
  });
}

const TABS = [
  ['resumen','Resumen'], ['materias','Materias'], ['todas','Todas'], ['ajustes','Ajustes']
];

function renderTab() {
  const node = document.getElementById('tabContent');
  if (!node) return;
  node.innerHTML = '';
  node.classList.add('fade-in');
  if (state.tab === 'resumen') renderResumen(node);
  else if (state.tab === 'materias') renderMaterias(node);
  else if (state.tab === 'todas') renderTodas(node);
  else if (state.tab === 'ajustes') renderAjustes(node);
  // refrescar estilos de pestañas activas
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === state.tab;
    b.className = 'tabbtn px-3 py-2 text-sm rounded-lg ' + (on ? (ac().soft + ' ' + ac().text + ' font-medium') : 'text-neutral-600 hover:bg-neutral-100');
  });
}

function renderShell() {
  root.innerHTML = '';
  const a = ac();
  const shell = el(\`
    <div class="max-w-3xl mx-auto px-4 py-6">
      <header class="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 class="text-xl font-semibold leading-tight">Hola, \${esc(state.profile.display_name||'')}</h1>
          <p class="text-xs text-neutral-500">Semana \${esc(rangeText(state.range))}</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="syncBtn" class="\${a.solid} text-white text-sm rounded-lg px-3 py-2">Sincronizar</button>
          <div id="userbtn"></div>
        </div>
      </header>
      <nav class="flex gap-1 mb-4 bg-white border border-neutral-200 rounded-xl p-1 w-full overflow-x-auto">
        \${TABS.map(([k,l]) => '<button data-tab="'+k+'" class="tabbtn px-3 py-2 text-sm rounded-lg whitespace-nowrap">'+l+'</button>').join('')}
      </nav>
      <main id="tabContent"></main>
    </div>
  \`);
  root.appendChild(shell);
  mountUserButton(document.getElementById('userbtn'));
  shell.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderTab(); }));
  shell.querySelector('#syncBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Sincronizando…';
    try { const s = await api('/api/sync', { method: 'POST' }); state.tasks = s.tasks || []; renderTab(); btn.textContent = old; btn.disabled = false; }
    catch (err) { alert('Error: ' + err.message); btn.textContent = old; btn.disabled = false; }
  });
  renderTab();
}

// Decide entre onboarding y app según haya enlace.
function renderApp2() {
  if (!state.profile.ical_url) renderOnboarding();
  else renderShell();
}

async function loadAndRender() {
  root.innerHTML = '<div class="flex items-center justify-center h-screen text-neutral-400"><div class="spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full"></div></div>';
  try {
    const me = await api('/api/me');
    state.profile = me.profile;
    state.tasks = me.tasks || [];
    state.range = me.range;
    renderApp2();
  } catch (e) {
    root.innerHTML = '<pre class="text-red-600 text-sm p-6 whitespace-pre-wrap">'+esc(e.message)+'</pre>';
  }
}

// ---------- arranque ----------
await clerk.load();
if (clerk.user) await loadAndRender();
else renderLanding();

clerk.addListener(({ user }) => {
  if (user && !state.profile) loadAndRender();
  else if (!user) renderLanding();
});
</script>
</body>
</html>`;
}
