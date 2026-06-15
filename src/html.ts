import type { Env } from './types';
import { PENSUM } from './pensum';
import { currentAcademicWeek } from './time';

/** SPA servida por el Worker. Login con Clerk; datos vía el API del Worker. */
export function renderApp(env: Env): string {
  const cfg = JSON.stringify({
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY ?? null,
    APP_BASE_URL: env.APP_BASE_URL ?? null,
  });
  // Pensum completo para el selector de materias (código, nombre, cuatrimestre, electiva).
  const pensum = JSON.stringify(PENSUM.map((c) => [c.code, c.name, c.sem, c.elective ? 1 : 0, c.concentration || '']));
  // Semana académica (bloque + 1-15) calculada server-side con la fecha actual.
  const week = JSON.stringify(currentAcademicWeek());

  return `<!DOCTYPE html>
<!--
  Active Calendar — Developed by Oscar O. Jiménez
  © 2026 Oscar O. Jiménez. Todos los derechos reservados.
  Software propietario. Prohibida su copia, distribución o uso no autorizado.
-->
<html lang="es" class="h-full">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0a0a0a" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/favicon.svg" />
<title>Active Calendar</title>
<script>
  // Aplica el tema antes de pintar para evitar parpadeo.
  (function () {
    try {
      var t = localStorage.getItem('theme');
      var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (dark) document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
</script>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { darkMode: 'class' };</script>
<style>
  :root {
    color-scheme: light;
    /* Curvas de easing con carácter (emil-design): más fuertes que las de CSS. */
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  }
  html.dark { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

  /* Entradas: empiezan desplazadas+escaladas, nunca desde scale(0). */
  .fade-in { animation: fade .26s var(--ease-out) both; }
  @keyframes fade { from { opacity: 0; transform: translateY(6px) scale(0.99); } to { opacity: 1; transform: none; } }

  /* Stagger sutil para listas de tareas. */
  .stagger > * { animation: rise .32s var(--ease-out) both; }
  .stagger > *:nth-child(1){animation-delay:.02s}
  .stagger > *:nth-child(2){animation-delay:.05s}
  .stagger > *:nth-child(3){animation-delay:.08s}
  .stagger > *:nth-child(4){animation-delay:.11s}
  .stagger > *:nth-child(5){animation-delay:.14s}
  .stagger > *:nth-child(6){animation-delay:.17s}
  .stagger > *:nth-child(7){animation-delay:.20s}
  .stagger > *:nth-child(n+8){animation-delay:.22s}
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .spin { animation: sp .8s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }

  /* Feedback de pulsación: todo lo pulsable responde al toque. */
  button, .pressable { transition: transform .16s var(--ease-out), background-color .16s ease, border-color .16s ease, box-shadow .16s var(--ease-out); }
  button:active, .pressable:active { transform: scale(0.97); }
  .card { transition: transform .2s var(--ease-out), border-color .2s ease, box-shadow .2s var(--ease-out); }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 9999px; }
  html.dark ::-webkit-scrollbar-thumb { background: #404040; }

  @media (prefers-reduced-motion: reduce) {
    .fade-in, .stagger > *, .spin { animation: none !important; }
    button, .pressable, .card { transition: none !important; }
  }
</style>
</head>
<body class="h-full overflow-x-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
<div id="root" class="min-h-full"></div>

<script>window.__CFG__ = ${cfg}; window.__PENSUM__ = ${pensum}; window.__WEEK__ = ${week};</script>
<script type="module">
import { Clerk } from 'https://esm.sh/@clerk/clerk-js@5';

const cfg = window.__CFG__;
const root = document.getElementById('root');

// ---------- pensum / materias ----------
const PENSUM = (window.__PENSUM__ || []).map(([code, name, sem, elective, concentration]) => ({ code, name, sem, elective: !!elective, concentration: concentration || '' }));
const PENSUM_BY_CODE = new Map(PENSUM.map(c => [c.code, c]));
const WEEK = window.__WEEK__ || null;
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// Nombre legible de una materia por código: perfil > pensum > el propio código.
function courseName(code) {
  if (!code) return null;
  const c = normCode(code);
  const fromProfile = (state.profile?.courses || []).find(x => normCode(x.code) === c);
  if (fromProfile) return fromProfile.name;
  return PENSUM_BY_CODE.get(c)?.name || code;
}
// Formato de materia para mostrar: "CÓDIGO · NOMBRE EN MAYÚSCULAS".
function fmtCourse(code, name) {
  const nm = String(name || '').toUpperCase();
  return code ? (normCode(code) + ' · ' + nm) : nm;
}
// ¿La materia tiene nombre real? (no vacío y distinto del código).
function hasRealName(c) {
  const name = String(c && c.name || '').trim();
  return !!name && normCode(name) !== normCode(c.code);
}
// Materias del estudiante para los selectores (las del perfil; si no hay, las del cuatrimestre).
function myCourses() {
  const cs = (state.profile?.courses || []).filter(hasRealName);
  if (cs.length) return cs.slice().sort((a,b) => a.name.localeCompare(b.name, 'es'));
  const term = state.profile?.term;
  if (term) return PENSUM.filter(c => c.sem === term && !c.elective).map(c => ({ code: c.code, name: c.name }));
  return [];
}

if (!cfg.CLERK_PUBLISHABLE_KEY) {
  root.innerHTML = '<div class="max-w-lg mx-auto mt-20 bg-amber-50 border border-amber-300 rounded-xl p-6">' +
    '<h1 class="text-xl font-semibold mb-2">Falta configuración</h1>' +
    '<p class="text-sm text-neutral-700 dark:text-neutral-300">El Worker no tiene <code class="bg-neutral-200 px-1 rounded">CLERK_PUBLISHABLE_KEY</code>. ' +
    'Cárgala en Cloudflare (Settings → Variables) y vuelve a desplegar.</p></div>';
  throw new Error('Falta CLERK_PUBLISHABLE_KEY');
}

// ---------- utilidades ----------
const ACCENTS = {
  neutral: { solid: 'bg-neutral-900 hover:bg-neutral-800', text: 'text-neutral-900', soft: 'bg-neutral-100 dark:bg-neutral-800', ring: 'focus:ring-neutral-900', bar: 'bg-neutral-900', dot: 'bg-neutral-900' },
  indigo:  { solid: 'bg-indigo-600 hover:bg-indigo-700', text: 'text-indigo-700', soft: 'bg-indigo-50', ring: 'focus:ring-indigo-600', bar: 'bg-indigo-600', dot: 'bg-indigo-600' },
  emerald: { solid: 'bg-emerald-600 hover:bg-emerald-700', text: 'text-emerald-700', soft: 'bg-emerald-50', ring: 'focus:ring-emerald-600', bar: 'bg-emerald-600', dot: 'bg-emerald-600' },
  rose:    { solid: 'bg-rose-600 hover:bg-rose-700', text: 'text-rose-700', soft: 'bg-rose-50', ring: 'focus:ring-rose-600', bar: 'bg-rose-600', dot: 'bg-rose-600' },
  amber:   { solid: 'bg-amber-500 hover:bg-amber-600', text: 'text-amber-700', soft: 'bg-amber-50', ring: 'focus:ring-amber-500', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  sky:     { solid: 'bg-sky-600 hover:bg-sky-700', text: 'text-sky-700', soft: 'bg-sky-50', ring: 'focus:ring-sky-600', bar: 'bg-sky-600', dot: 'bg-sky-600' },
};
// Equivalente en HEX de cada acento, para el documento exportado (estilos en
// línea, siempre en claro, independientes del tema de la app).
const ACCENT_HEX = { neutral: '#0a0a0a', indigo: '#4f46e5', emerald: '#059669', rose: '#e11d48', amber: '#d97706', sky: '#0284c7' };
function ac() { return ACCENTS[state.profile?.accent] || ACCENTS.neutral; }
function acHex() { return ACCENT_HEX[state.profile && state.profile.accent] || ACCENT_HEX.neutral; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
// Marca minimalista (calendario + check). Usa currentColor para adaptarse al tema.
function logoMark(cls) {
  return '<svg viewBox="0 0 32 32" class="'+(cls||'h-7 w-7')+'" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M11 4.5v3.5M21 4.5v3.5"/>'+
    '<rect x="6.5" y="7" width="19" height="17" rx="3.6"/>'+
    '<path d="M11.5 16l3 3 6.5-7"/></svg>';
}
function brand(cls) {
  return '<span class="inline-flex items-center gap-2 '+(cls||'')+'">'+logoMark('h-6 w-6')+'<span class="font-semibold tracking-tight">Active Calendar</span></span>';
}
function setupThemeToggle() {
  const sun = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const btn = el('<button title="Cambiar tema" class="fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center transition hover:scale-105"></button>');
  const paint = () => { btn.innerHTML = document.documentElement.classList.contains('dark') ? sun : moon; };
  btn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    paint();
  });
  paint();
  document.body.appendChild(btn);
}
// ---------- modal genérico (centrado, animación emil) ----------
function openModal(title, bodyHtml) {
  const prev = document.querySelector('.app-modal');
  if (prev) prev.remove();
  const overlay = el('<div class="app-modal fixed inset-0 z-[60] flex items-center justify-center p-4"></div>');
  const backdrop = el('<div class="absolute inset-0 bg-black/40 opacity-0 transition-opacity duration-200"></div>');
  const panel = el('<div role="dialog" aria-modal="true" class="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl opacity-0 scale-95 transition duration-200 [transition-timing-function:var(--ease-out)]"></div>');
  panel.appendChild(el('<div class="flex items-center justify-between gap-4 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800"><h3 class="font-semibold">'+esc(title)+'</h3><button class="modal-x pressable h-8 w-8 -mr-1 rounded-lg flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Cerrar">✕</button></div>'));
  const body = el('<div class="overflow-y-auto px-5 py-4 space-y-2"></div>');
  body.innerHTML = bodyHtml;
  panel.appendChild(body);
  overlay.appendChild(backdrop);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    backdrop.classList.remove('opacity-0');
    panel.classList.remove('opacity-0', 'scale-95');
  });
  function close() {
    backdrop.classList.add('opacity-0');
    panel.classList.add('opacity-0', 'scale-95');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  panel.querySelector('.modal-x').addEventListener('click', close);
  return close;
}

// Contenido de las Políticas de privacidad. Describe con exactitud qué datos
// se recopilan y qué NO. Mantener sincronizado con lo que el código realmente guarda.
function privacyHtml() {
  const h = (t) => '<h4 class="font-semibold text-sm mt-4 mb-1">'+t+'</h4>';
  const p = (t) => '<p class="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">'+t+'</p>';
  const ul = (items) => '<ul class="list-disc ml-5 space-y-1 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">'+items.map(i => '<li>'+i+'</li>').join('')+'</ul>';
  return [
    '<p class="text-xs text-neutral-400 dark:text-neutral-500">Última actualización: 5 de junio de 2026</p>',
    p('Active Calendar organiza, por materia, las tareas de tu calendario de Blackboard. Recopilamos lo mínimo necesario. Aquí te explicamos con claridad qué datos tocamos y qué hacemos con ellos.'),
    h('Qué información guardamos'),
    ul([
      '<b>Tu cuenta:</b> nombre, correo y foto de perfil, provistos por nuestro proveedor de inicio de sesión al registrarte.',
      '<b>Tu enlace de Blackboard (URL iCal):</b> el que tú pegas. Lo usamos solo para leer tus tareas; es privado y no se comparte.',
      '<b>Tus tareas de la semana</b> leídas de ese enlace: título, materia, fecha de entrega, enlace a Blackboard y si la marcaste como hecha.',
      '<b>Tus preferencias:</b> cuatrimestre, materias que cursas, color de acento y, si lo activas, la configuración del recordatorio por correo (día y hora).',
    ]),
    h('Qué NO hacemos'),
    ul([
      'No vendemos ni compartimos tu información con terceros con fines publicitarios.',
      'No guardamos datos de profesores, aulas, horarios ni de la universidad (solo nombres y códigos de las materias).',
      'No conocemos ni pedimos tu contraseña de Blackboard o de la universidad. Solo usamos el enlace de calendario que tú nos das.',
    ]),
    h('Para qué usamos tus datos'),
    p('Únicamente para mostrarte tus tareas organizadas y, si lo activas, enviarte un recordatorio semanal por correo. Nada más.'),
    h('Servicios que nos ayudan'),
    p('Procesamos datos con proveedores de confianza, solo para que la app funcione: autenticación (Clerk), base de datos (Supabase), alojamiento (Cloudflare) y envío de correos (Resend, únicamente si activas los recordatorios).'),
    h('Seguridad'),
    p('La conexión está cifrada (HTTPS) y la base de datos solo es accesible desde nuestro servidor.'),
    h('Tu control'),
    p('Puedes cambiar o borrar tu enlace de Blackboard, desactivar los correos o eliminar tu cuenta cuando quieras. Al eliminar tu cuenta se borran tus datos asociados.'),
    h('Contacto'),
    p('¿Dudas o quieres eliminar tus datos? Escríbenos a <a class="underline decoration-dotted hover:decoration-solid" href="mailto:privacidad@activecalendar.site">privacidad@activecalendar.site</a>.'),
  ].join('');
}
function openPrivacy() { openModal('Políticas de privacidad', privacyHtml()); }

// ---------- exportar tareas (PDF / imagen / texto) ----------
// Logo en línea (tamaño/color explícitos) para que se vea igual al rasterizar.
function docLogo(px, color) {
  return '<svg viewBox="0 0 32 32" width="'+px+'" height="'+px+'" fill="none" stroke="'+(color||'currentColor')+'" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'+
    '<path d="M11 4.5v3.5M21 4.5v3.5"/><rect x="6.5" y="7" width="19" height="17" rx="3.6"/><path d="M11.5 16l3 3 6.5-7"/></svg>';
}
// Fecha legible en hora de RD (UTC-4), p. ej. "5 de junio de 2026".
function expDateStr() {
  const d = new Date(new Date().getTime() - 4 * 3600 * 1000);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return d.getUTCDate() + ' de ' + months[d.getUTCMonth()] + ' de ' + d.getUTCFullYear();
}
function expStudentName() {
  return (state.profile && state.profile.display_name) ? state.profile.display_name : 'Estudiante';
}
function expFilename(ext) { return 'Tareas - ' + expStudentName() + '.' + ext; }

// HTML del documento (tamaño carta/A4 vertical, estilos en línea, siempre claro).
// Mismo espíritu que el correo, pero como hoja con cabecera, resumen y pie.
function exportDocHtml() {
  const accent = acHex();
  const name = expStudentName();
  const groups = byCourse();
  const s = stats();
  const range = rangeText(state.range);
  const weekLine = WEEK ? (WEEK.week ? ('Semana ' + WEEK.week + ' de 15 · ' + WEEK.blockLabel) : ('En receso · ' + WEEK.blockLabel)) : 'Resumen de tareas';

  function statBox(n, label) {
    return '<div style="flex:1;border:1px solid #e9e9e9;border-radius:12px;padding:14px 16px;">'+
      '<div style="font-size:24px;font-weight:700;line-height:1;">'+n+'</div>'+
      '<div style="font-size:11px;color:#737373;margin-top:5px;">'+label+'</div></div>';
  }

  let bodyHtml;
  if (!groups.length) {
    bodyHtml = '<div style="margin-top:40px;text-align:center;border:1px dashed #e0e0e0;border-radius:16px;padding:52px 24px;">'+
      '<div style="font-size:40px;">🌴</div>'+
      '<div style="margin-top:10px;font-size:16px;font-weight:600;">Semana despejada</div>'+
      '<div style="margin-top:4px;font-size:13px;color:#737373;">No hay tareas registradas para esta semana.</div></div>';
  } else {
    const statsHtml = '<div style="display:flex;gap:12px;margin-top:22px;">'+
      statBox(s.pending,'Pendientes') + statBox(s.done,'Hechas') + statBox(s.total,'Total') + '</div>';
    const groupsHtml = groups.map(function (g) {
      const done = g.tasks.filter(function (t) { return t.status === 'done'; }).length;
      const rows = g.tasks.map(function (t) {
        const isDone = t.status === 'done';
        const ind = isDone
          ? '<span style="display:inline-flex;width:16px;height:16px;border-radius:9999px;background:'+accent+';color:#fff;align-items:center;justify-content:center;font-size:10px;line-height:1;flex:0 0 auto;">✓</span>'
          : '<span style="display:inline-block;width:14px;height:14px;border-radius:9999px;border:1.5px solid #cfcfcf;flex:0 0 auto;"></span>';
        const titleStyle = isDone
          ? 'font-size:13px;line-height:1.4;color:#a3a3a3;text-decoration:line-through;'
          : 'font-size:13px;line-height:1.4;color:#171717;';
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid #efefef;border-radius:10px;margin-bottom:6px;background:#fafafa;">'+
          '<span style="margin-top:1px;">'+ind+'</span>'+
          '<div style="flex:1 1 auto;min-width:0;"><div style="'+titleStyle+'">'+esc(t.summary)+'</div></div>'+
          '<div style="font-size:11px;color:#737373;white-space:nowrap;margin-left:10px;">'+esc(fmtDue(t.due))+'</div></div>';
      }).join('');
      return '<div style="margin-top:22px;break-inside:avoid;">'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+
        '<span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:'+accent+';flex:0 0 auto;"></span>'+
        '<span style="font-size:12px;font-weight:700;letter-spacing:0.03em;color:#404040;">'+esc(g.label)+'</span>'+
        '<span style="margin-left:auto;font-size:11px;color:#a3a3a3;">'+done+'/'+g.tasks.length+'</span></div>'+
        rows + '</div>';
    }).join('');
    bodyHtml = statsHtml + groupsHtml;
  }

  return '<div style="width:794px;box-sizing:border-box;background:#ffffff;color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;min-height:1123px;padding:56px 56px 44px;display:flex;flex-direction:column;">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0a0a0a;padding-bottom:18px;">'+
      '<div style="display:flex;align-items:center;gap:10px;"><span style="display:inline-flex;color:'+accent+';">'+docLogo(28)+'</span>'+
      '<span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">Active Calendar</span></div>'+
      '<div style="text-align:right;font-size:11px;color:#737373;line-height:1.6;"><div style="font-weight:600;color:#0a0a0a;">Reporte de tareas</div><div>'+esc(expDateStr())+'</div></div>'+
    '</div>'+
    '<div style="margin-top:28px;">'+
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:'+accent+';">'+esc(weekLine)+'</div>'+
      '<h1 style="margin:7px 0 0;font-size:27px;font-weight:700;letter-spacing:-0.02em;">'+esc(name)+'</h1>'+
      (range ? '<div style="margin-top:4px;font-size:13px;color:#737373;">Semana del '+esc(range)+'</div>' : '')+
    '</div>'+
    bodyHtml +
    '<div style="flex:1 1 auto;"></div>'+
    '<div style="margin-top:36px;padding-top:16px;border-top:1px solid #ececec;display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#a3a3a3;">'+
      '<span style="display:inline-flex;align-items:center;gap:6px;color:#737373;"><span style="display:inline-flex;color:'+accent+';">'+docLogo(13)+'</span>Powered by Active Calendar</span>'+
      '<span>Developed by Oscar O. Jiménez · © 2026</span></div>'+
  '</div>';
}

// Versión en texto plano: sin asteriscos, almohadillas ni marcas de formato.
function exportText() {
  const name = expStudentName();
  const groups = byCourse();
  const s = stats();
  const range = rangeText(state.range);
  const weekLine = WEEK ? (WEEK.week ? ('Semana ' + WEEK.week + ' de 15 · ' + WEEK.blockLabel) : ('En receso · ' + WEEK.blockLabel)) : '';
  const L = [];
  L.push('ACTIVE CALENDAR — Reporte de tareas');
  L.push(expDateStr());
  L.push('');
  L.push('Estudiante: ' + name);
  if (range) L.push('Semana del ' + range);
  if (weekLine) L.push(weekLine);
  L.push('');
  if (!groups.length) {
    L.push('Semana despejada: no hay tareas registradas para esta semana.');
  } else {
    L.push(s.pending + ' pendientes · ' + s.done + ' hechas · ' + s.total + ' en total');
    L.push('');
    groups.forEach(function (g) {
      L.push(g.label);
      L.push('-'.repeat(Math.min(g.label.length, 44)));
      g.tasks.forEach(function (t) {
        L.push((t.status === 'done' ? '[x] ' : '[ ] ') + t.summary + '  (' + fmtDue(t.due) + ')');
      });
      L.push('');
    });
  }
  L.push('—');
  L.push('Powered by Active Calendar · Developed by Oscar O. Jiménez');
  return L.join('\\n');
}

// Carga perezosa de las librerías de render (solo al exportar PDF/imagen).
let _expLibs = null;
function loadExportLibs() {
  if (_expLibs) return _expLibs;
  _expLibs = Promise.all([
    import('https://esm.sh/html2canvas@1.4.1'),
    import('https://esm.sh/jspdf@2.5.2'),
  ]).then(function (mods) {
    const h2c = mods[0].default || mods[0];
    const jspdf = mods[1];
    const jsPDF = jspdf.jsPDF || (jspdf.default && jspdf.default.jsPDF) || jspdf.default;
    return { html2canvas: h2c, jsPDF: jsPDF };
  });
  return _expLibs;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// Renderiza el documento (fuera de pantalla, a tamaño real) a un <canvas>.
async function expRenderCanvas(html2canvas) {
  const doc = el(exportDocHtml());
  doc.style.width = '794px';
  const holder = el('<div style="position:fixed;left:-10000px;top:0;z-index:-1;"></div>');
  holder.appendChild(doc);
  document.body.appendChild(holder);
  try {
    return await html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  } finally {
    holder.remove();
  }
}

// Popup con las 3 vistas: PDF, imagen .jpg y texto plano. Vista previa en vivo.
function openExportModal() {
  let mode = 'pdf';
  const segBody = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;" id="expSeg" class="p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800">'+
    [['pdf','PDF'],['image','Imagen'],['text','Texto']].map(function (m) {
      return '<button data-m="'+m[0]+'" class="expseg pressable text-sm rounded-lg py-1.5 font-medium">'+m[1]+'</button>';
    }).join('') + '</div>';
  const body = '<div>'+
    segBody +
    '<div id="expPreview" class="mt-4 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 max-h-[52vh] overflow-y-auto"></div>'+
    '<p id="expNote" class="mt-3 text-xs text-neutral-500 dark:text-neutral-400"></p>'+
    '<button id="expDownload" class="'+ac().solid+' text-white rounded-lg px-4 py-2.5 font-medium w-full mt-2 inline-flex items-center justify-center gap-2">Descargar</button>'+
  '</div>';
  openModal('Exportar tareas', body);

  const segBtns = Array.prototype.slice.call(document.querySelectorAll('#expSeg .expseg'));
  const dlBtn = document.getElementById('expDownload');
  const note = document.getElementById('expNote');
  const NOTES = {
    pdf: 'Documento PDF tamaño carta, listo para imprimir o compartir.',
    image: 'Imagen .jpg de una sola página, ideal para enviar por chat.',
    text: 'Texto plano, sin formato, para pegar donde quieras.',
  };
  const LABELS = { pdf: 'Descargar PDF', image: 'Descargar imagen', text: 'Descargar .txt' };

  function paintSeg() {
    segBtns.forEach(function (b) {
      const on = b.dataset.m === mode;
      b.className = 'expseg pressable text-sm rounded-lg py-1.5 font-medium ' +
        (on ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400');
    });
    note.textContent = NOTES[mode];
    dlBtn.textContent = LABELS[mode];
  }
  function renderPreview() {
    const area = document.getElementById('expPreview');
    if (!area) return;
    area.innerHTML = '';
    if (mode === 'text') {
      area.style.background = '#ffffff';
      const pre = el('<pre style="margin:0;padding:16px;font-size:11px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#171717;background:#ffffff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"></pre>');
      pre.textContent = exportText();
      area.appendChild(pre);
      return;
    }
    area.style.background = '';
    const wrapper = el('<div style="padding:16px;display:flex;justify-content:center;"></div>');
    const doc = el(exportDocHtml());
    const w = Math.max(240, area.clientWidth - 32);
    const scale = w / 794;
    doc.style.transformOrigin = 'top left';
    doc.style.transform = 'scale(' + scale + ')';
    const scaler = el('<div style="box-shadow:0 6px 28px rgba(0,0,0,0.14);border-radius:4px;overflow:hidden;background:#fff;"></div>');
    scaler.style.width = w + 'px';
    scaler.appendChild(doc);
    wrapper.appendChild(scaler);
    area.appendChild(wrapper);
    requestAnimationFrame(function () { scaler.style.height = (doc.offsetHeight * scale) + 'px'; });
  }

  segBtns.forEach(function (b) {
    b.addEventListener('click', function () { mode = b.dataset.m; paintSeg(); renderPreview(); });
  });
  dlBtn.addEventListener('click', async function () {
    if (mode === 'text') {
      downloadBlob(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }), expFilename('txt'));
      return;
    }
    const old = dlBtn.textContent; dlBtn.disabled = true; dlBtn.textContent = 'Generando…';
    try {
      const libs = await loadExportLibs();
      const canvas = await expRenderCanvas(libs.html2canvas);
      if (mode === 'image') {
        await new Promise(function (res) { canvas.toBlob(function (b) { if (b) downloadBlob(b, expFilename('jpg')); res(); }, 'image/jpeg', 0.95); });
      } else {
        const pdf = new libs.jsPDF('p', 'mm', 'a4');
        const pw = 210, ph = 297;
        const imgW = pw, imgH = canvas.height * imgW / canvas.width;
        const img = canvas.toDataURL('image/jpeg', 0.95);
        let pos = 0, left = imgH;
        pdf.addImage(img, 'JPEG', 0, pos, imgW, imgH, '', 'FAST');
        left -= ph;
        while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, imgW, imgH, '', 'FAST'); left -= ph; }
        pdf.save(expFilename('pdf'));
      }
    } catch (err) {
      note.textContent = 'No se pudo generar: ' + (err && err.message ? err.message : err);
    } finally { dlBtn.disabled = false; dlBtn.textContent = old; }
  });

  paintSeg();
  renderPreview();
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
        <div class="flex items-center gap-3">\${logoMark('h-9 w-9')}<h1 class="text-4xl font-semibold tracking-tight">Active Calendar</h1></div>
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
          <div class="md:hidden mb-1 text-xl">\${brand()}</div>
          <p class="text-neutral-600 dark:text-neutral-300 mb-6 md:hidden">Tus tareas de Blackboard en un solo lugar.</p>
          <div id="signin"></div>
          <p class="mt-6 text-center text-xs text-neutral-400 dark:text-neutral-500"><button id="privacyLink" class="pressable underline decoration-dotted hover:decoration-solid hover:text-neutral-600 dark:hover:text-neutral-300">Políticas de privacidad</button></p>
          <p class="mt-2 text-center text-xs text-neutral-300 dark:text-neutral-600">Developed by Oscar O. Jiménez</p>
        </div>
      </div>
    </div>
  \`);
  root.appendChild(wrap);
  clerk.mountSignIn(document.getElementById('signin'), { afterSignInUrl: cfg.APP_BASE_URL, afterSignUpUrl: cfg.APP_BASE_URL });
  wrap.querySelector('#privacyLink').addEventListener('click', openPrivacy);
}

// ---------- render: onboarding (sin enlace) ----------
function renderOnboarding() {
  root.innerHTML = '';
  const a = ac();
  const wrap = el(\`
    <div class="fade-in max-w-xl mx-auto px-4 py-10">
      <div id="topbar" class="flex justify-end mb-6"></div>
      <h1 class="text-2xl font-semibold mb-1">Hola, \${esc(state.profile.display_name || '')}</h1>
      <p class="text-neutral-600 dark:text-neutral-300 mb-6">Solo falta un paso: conecta tu calendario de Blackboard.</p>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-sm space-y-3">
        <label class="block text-sm font-medium">URL iCal de Blackboard</label>
        <input id="ical" class="w-full border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-2 font-mono text-xs \${a.ring} focus:outline-none focus:ring-2" placeholder="https://…/learn.ics" />
        <details class="text-sm text-neutral-600 dark:text-neutral-300">
          <summary class="cursor-pointer select-none">¿Cómo obtengo mi enlace? (paso a paso)</summary>
          <ol class="list-decimal ml-5 mt-2 space-y-1">
            <li>Entra al portal de Blackboard de tu universidad.</li>
            <li>Abre el <b>Calendario</b>.</li>
            <li>Busca <b>"Get External Calendar Link"</b> / <b>"Obtener enlace externo"</b> (icono de engranaje o ⋯).</li>
            <li>Genera (o regenera) el enlace y cópialo. Debe terminar en <code>.ics</code>.</li>
            <li>Pégalo aquí arriba.</li>
          </ol>
          <p class="mt-2 text-neutral-500 dark:text-neutral-400">El enlace es personal. No lo compartas con nadie.</p>
        </details>
        <button id="save" class="\${a.solid} text-white rounded-lg px-4 py-2 font-medium">Guardar y sincronizar</button>
        <span id="msg" class="ml-2 text-sm text-neutral-500 dark:text-neutral-400"></span>
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
      // Tras sincronizar, el perfil puede traer materias autodescubiertas.
      try { const me = await api('/api/me'); state.profile = me.profile; state.range = me.range; } catch (e2) {}
      renderCourseSetup();
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  });
}

function mountUserButton(node) {
  clerk.mountUserButton(node, { afterSignOutUrl: cfg.APP_BASE_URL });
}

// ---------- render: selección de cuatrimestre + materias ----------
// Devuelve un elemento reutilizable con el selector de cuatrimestre y los chips
// de materias. \`selected\` es un Map(code -> {code,name}) que se muta in-place.
function coursePicker(selected, initialTerm) {
  const a = ac();
  // Si el estudiante ya tiene seleccionadas materias de otro cuatrimestre o
  // electivas, abrimos la sección avanzada de entrada.
  let showMore = false;
  for (const [code] of selected) {
    const p = PENSUM_BY_CODE.get(code);
    if (p && (p.elective || (initialTerm && p.sem !== initialTerm))) { showMore = true; break; }
  }
  const wrap = el(\`
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">¿En qué cuatrimestre vas?</label>
        <select id="termSel" class="w-full sm:w-auto border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-2 \${a.ring} focus:outline-none focus:ring-2">
          <option value="">Selecciona…</option>
          \${Array.from({length:12}, (_,i)=> '<option value="'+(i+1)+'"'+(initialTerm===i+1?' selected':'')+'>Cuatrimestre '+(i+1)+'</option>').join('')}
        </select>
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">Tus materias</span>
          <span id="selCount" class="text-xs text-neutral-500 dark:text-neutral-400"></span>
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-3">Selecciona las materias que estás cursando. Las electivas que detectemos en tu Blackboard ya vienen marcadas.</p>
        <div id="chips" class="flex flex-wrap gap-2"></div>
      </div>
      <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input id="moreToggle" type="checkbox" class="\${a.text} rounded border-neutral-300 dark:border-neutral-600 focus:ring-0" \${showMore?'checked':''} />
        <span>Estoy fuera de bloque o tomo electivas / materias de otros cuatrimestres</span>
      </label>
      <div id="moreBox" class="space-y-4 \${showMore?'':'hidden'}">
        <div>
          <span class="text-sm font-medium">Electivas por concentración</span>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Marca las electivas que estás cursando. Están agrupadas por concentración.</p>
          <div id="elecChips" class="space-y-3"></div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Materias de otro cuatrimestre</label>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Si llevas materias adelantadas o atrasadas, elige el cuatrimestre para verlas.</p>
          <select id="otherTerm" class="w-full sm:w-auto border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-2 \${a.ring} focus:outline-none focus:ring-2 mb-2">
            <option value="">Selecciona un cuatrimestre…</option>
            \${Array.from({length:12}, (_,i)=> '<option value="'+(i+1)+'">Cuatrimestre '+(i+1)+'</option>').join('')}
          </select>
          <div id="otherChips" class="flex flex-wrap gap-2"></div>
        </div>
      </div>
    </div>
  \`);
  const chipsBox = wrap.querySelector('#chips');
  const elecBox = wrap.querySelector('#elecChips');
  const otherBox = wrap.querySelector('#otherChips');
  const countEl = wrap.querySelector('#selCount');
  const moreBox = wrap.querySelector('#moreBox');

  function chipClass(on) {
    return 'chip pressable px-3 py-1.5 rounded-full text-sm border ' +
      (on ? (a.solid + ' text-white border-transparent') : 'border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600');
  }
  function updateCount() {
    const n = selected.size;
    countEl.textContent = n ? (n + ' seleccionada' + (n===1?'':'s')) : '';
  }
  function makeChip(c, redraw) {
    const on = selected.has(c.code);
    const chip = el('<button type="button" class="'+chipClass(on)+'">'+esc(fmtCourse(c.code, c.name))+'</button>');
    chip.addEventListener('click', () => {
      if (selected.has(c.code)) selected.delete(c.code); else selected.set(c.code, c);
      redraw(); updateCount();
    });
    return chip;
  }
  function drawCore() {
    chipsBox.innerHTML = '';
    const term = parseInt(wrap.querySelector('#termSel').value, 10);
    // Núcleo del cuatrimestre (no electivas) + las ya seleccionadas de ese término.
    const byCode = new Map();
    if (term) for (const c of PENSUM.filter(x => x.sem === term && !x.elective)) byCode.set(c.code, { code: c.code, name: c.name });
    for (const [code, c] of selected) {
      const p = PENSUM_BY_CODE.get(code);
      if (!byCode.has(code) && (!p || (!p.elective && (!term || p.sem === term)))) byCode.set(code, c);
    }
    const list = [...byCode.values()].sort((x,y) => x.name.localeCompare(y.name, 'es'));
    if (!list.length) chipsBox.appendChild(el('<p class="text-sm text-neutral-400 dark:text-neutral-500">Elige tu cuatrimestre para ver las materias.</p>'));
    for (const c of list) chipsBox.appendChild(makeChip(c, drawAll));
  }
  function drawElectives() {
    elecBox.innerHTML = '';
    // Agrupa las electivas por concentración para una elección más clara.
    const groups = new Map();
    for (const c of PENSUM.filter(x => x.elective)) {
      const g = c.concentration || 'Otras electivas';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    for (const [g, list] of groups) {
      list.sort((x,y) => x.name.localeCompare(y.name, 'es'));
      const sec = el('<div class="space-y-1.5"></div>');
      sec.appendChild(el('<div class="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">'+esc(g)+'</div>'));
      const chips = el('<div class="flex flex-wrap gap-2"></div>');
      for (const c of list) chips.appendChild(makeChip({ code: c.code, name: c.name }, drawAll));
      sec.appendChild(chips);
      elecBox.appendChild(sec);
    }
  }
  function drawOther() {
    otherBox.innerHTML = '';
    const term = parseInt(wrap.querySelector('#otherTerm').value, 10);
    if (!term) return;
    const list = PENSUM.filter(x => x.sem === term && !x.elective).sort((x,y) => x.name.localeCompare(y.name, 'es'));
    for (const c of list) otherBox.appendChild(makeChip({ code: c.code, name: c.name }, drawAll));
  }
  function drawAll() { drawCore(); drawElectives(); drawOther(); updateCount(); }

  wrap.querySelector('#termSel').addEventListener('change', drawAll);
  wrap.querySelector('#otherTerm').addEventListener('change', drawOther);
  wrap.querySelector('#moreToggle').addEventListener('change', (e) => {
    moreBox.classList.toggle('hidden', !e.currentTarget.checked);
  });
  drawAll();
  return wrap;
}

function renderCourseSetup() {
  root.innerHTML = '';
  const a = ac();
  // Prefill con lo autodescubierto del feed.
  const selected = new Map((state.profile.courses || []).map(c => [normCode(c.code), { code: normCode(c.code), name: c.name }]));
  const wrap = el(\`
    <div class="fade-in max-w-xl mx-auto px-4 py-10">
      <div id="topbar" class="flex justify-end mb-6"></div>
      <h1 class="text-2xl font-semibold mb-1">Casi listo, \${esc(state.profile.display_name || '')}</h1>
      <p class="text-neutral-600 dark:text-neutral-300 mb-6">Dinos en qué cuatrimestre vas y qué materias cursas. Así podemos agrupar tus tareas por materia.</p>
      <div class="card bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 shadow-sm">
        <div id="pickerSlot"></div>
        <div class="flex items-center gap-3 mt-6">
          <button id="save" class="\${a.solid} text-white rounded-lg px-4 py-2 font-medium">Guardar y continuar</button>
          <button id="skip" class="text-sm text-neutral-500 dark:text-neutral-400 underline">Omitir por ahora</button>
          <span id="msg" class="text-sm text-neutral-500 dark:text-neutral-400"></span>
        </div>
      </div>
    </div>
  \`);
  root.appendChild(wrap);
  mountUserButton(wrap.querySelector('#topbar'));
  const picker = coursePicker(selected, state.profile.term || null);
  wrap.querySelector('#pickerSlot').appendChild(picker);

  wrap.querySelector('#save').addEventListener('click', async () => {
    const msg = wrap.querySelector('#msg');
    const term = parseInt(picker.querySelector('#termSel').value, 10) || null;
    msg.textContent = 'Guardando…';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ term, courses: [...selected.values()] }) });
      state.profile = r.profile;
      renderShell();
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  });
  wrap.querySelector('#skip').addEventListener('click', () => renderShell());
}

// ---------- render: app principal ----------
function stats() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.status === 'done').length;
  return { total, done, pending: total - done, pct: total ? Math.round(done / total * 100) : 0 };
}
// Materia de una tarea como {code,name}, o null si no tiene o si no conocemos su
// nombre real (en ese caso se trata como "Sin materia", no mostramos códigos sueltos).
function taskCourse(t) {
  if (t.course_code) {
    const code = normCode(t.course_code);
    const name = courseName(t.course_code);
    if (name && normCode(name) !== code) return { code, name };
  }
  if (t.course) return { code: null, name: String(t.course).trim() };
  return null;
}
// Agrupa tareas por materia. Devuelve [{code,name,label,tasks}], "Sin materia" al final.
function byCourse() {
  const map = new Map();
  for (const t of state.tasks) {
    const c = taskCourse(t);
    const key = c ? (c.code || c.name) : '__none__';
    if (!map.has(key)) {
      map.set(key, c ? { code: c.code, name: c.name, label: fmtCourse(c.code, c.name), tasks: [] }
                     : { code: null, name: 'Sin materia', label: 'SIN MATERIA', tasks: [] });
    }
    map.get(key).tasks.push(t);
  }
  return [...map.values()].sort((a,b) => {
    if (a.name === 'Sin materia') return 1;
    if (b.name === 'Sin materia') return -1;
    return a.name.localeCompare(b.name, 'es');
  });
}

function taskRow(t) {
  const a = ac();
  const done = t.status === 'done';
  const row = el(\`
    <div class="card flex items-start gap-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-3 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm">
      <input type="checkbox" class="chk mt-0.5 h-4 w-4 accent-neutral-900 cursor-pointer shrink-0" \${done ? 'checked' : ''} />
      <div class="flex-1 min-w-0">
        <div class="text-sm break-words \${done ? 'line-through text-neutral-400 dark:text-neutral-600' : 'font-medium'}">\${esc(t.summary)}</div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span>\${esc(fmtDue(t.due))}</span>
          <span class="materia-slot min-w-0 max-w-full"></span>
          \${t.url ? '<a class="underline decoration-dotted hover:decoration-solid" target="_blank" rel="noopener" href="'+esc(t.url)+'">abrir en Blackboard</a>' : ''}
        </div>
      </div>
    </div>
  \`);
  // Checkbox -> estado.
  row.querySelector('.chk').addEventListener('change', async (e) => {
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
  // Materia: muestra la asignada (clic para cambiarla/quitarla) o un selector
  // para asignarla. El estudiante siempre puede corregir una materia equivocada.
  const slot = row.querySelector('.materia-slot');
  if (slot) {
    const opts = myCourses();
    const cur = taskCourse(t);
    // Asegura que la materia actual aparezca en el selector aunque no esté en "mis materias".
    const optList = opts.slice();
    if (cur && cur.code && !optList.some(o => normCode(o.code) === cur.code)) optList.unshift({ code: cur.code, name: cur.name });

    function buildSelect() {
      const first = cur ? '<option value="">— Sin materia</option>' : '<option value="">+ Asignar materia</option>';
      const body = optList.map(c => '<option value="'+esc(c.code)+'"'+((cur && cur.code && cur.code === normCode(c.code))?' selected':'')+'>'+esc(fmtCourse(c.code, c.name))+'</option>').join('');
      const sel = el('<select class="pressable text-xs rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-neutral-500 dark:text-neutral-400 focus:outline-none focus:ring-2 max-w-full min-w-0 truncate '+a.ring+'">'+first+body+'</select>');
      sel.addEventListener('change', async (e) => {
        const code = e.target.value || null;
        e.target.disabled = true;
        try {
          await api('/api/task', { method: 'POST', body: JSON.stringify({ uid: t.uid, course_code: code }) });
          const local = state.tasks.find(x => x.uid === t.uid);
          if (local) local.course_code = code;
          renderTab();
        } catch (err) {
          alert('No se pudo asignar: ' + err.message);
          e.target.disabled = false;
        }
      });
      return sel;
    }

    if (cur) {
      // Materia asignada: chip con punto de color; clic para editarla.
      const chip = el('<button type="button" title="Cambiar materia" class="pressable inline-flex items-center gap-1 max-w-full min-w-0 '+a.text+' hover:opacity-80"><span class="inline-block h-1.5 w-1.5 rounded-full shrink-0 '+a.dot+'"></span><span class="truncate">'+esc(fmtCourse(cur.code, cur.name))+'</span><span class="text-neutral-400 dark:text-neutral-500 text-[10px] shrink-0">✎</span></button>');
      chip.addEventListener('click', () => { const s = buildSelect(); chip.replaceWith(s); s.focus(); });
      slot.replaceWith(chip);
    } else if (optList.length) {
      slot.replaceWith(buildSelect());
    } else {
      slot.remove();
    }
  }
  return row;
}

function weekBadge() {
  if (!WEEK) return null;
  const a = ac();
  const label = WEEK.week
    ? 'Semana ' + WEEK.week + ' de 15 · ' + WEEK.blockLabel
    : 'En receso · ' + WEEK.blockLabel;
  const dot = WEEK.week ? a.bar : 'bg-neutral-400 dark:bg-neutral-600';
  return el('<div class="fade-in flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3">'+
    '<span class="inline-block h-1.5 w-1.5 rounded-full '+dot+'"></span>'+esc(label)+'</div>');
}

function renderResumen(node) {
  const a = ac();
  const s = stats();
  const wb = weekBadge();
  if (wb) node.appendChild(wb);
  // Sin tareas esta semana -> modo vacaciones.
  if (s.total === 0) {
    node.appendChild(el(\`
      <div class="card text-center bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl px-6 py-14">
        <div class="text-5xl mb-3" aria-hidden="true">🌴</div>
        <h2 class="text-xl font-semibold">Semana despejada</h2>
        <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto">No hay tareas para esta semana. Si crees que deberías ver algo, sincroniza de nuevo o revisa tu enlace en Ajustes.</p>
        <button id="vacSync" class="\${a.solid} text-white text-sm rounded-lg px-4 py-2 mt-6">Sincronizar ahora</button>
      </div>
    \`));
    const vb = node.querySelector('#vacSync');
    if (vb) vb.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Sincronizando…';
      try { const r = await api('/api/sync', { method: 'POST' }); state.tasks = r.tasks || []; renderShell(); }
      catch (err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = old; }
    });
    return;
  }
  const upcoming = state.tasks.filter(t => t.status === 'pending').slice(0, 5);
  node.appendChild(el(\`
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.pending}</div><div class="text-xs text-neutral-500 dark:text-neutral-400">Pendientes</div></div>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.done}</div><div class="text-xs text-neutral-500 dark:text-neutral-400">Hechas</div></div>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"><div class="text-2xl font-semibold">\${s.total}</div><div class="text-xs text-neutral-500 dark:text-neutral-400">Total</div></div>
    </div>
  \`));
  node.appendChild(el(\`
    <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 mt-3">
      <div class="flex justify-between text-sm mb-2"><span class="font-medium">Progreso de la semana</span><span class="\${a.text} font-semibold">\${s.pct}%</span></div>
      <div class="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden"><div class="\${a.bar} h-full transition-[width] duration-500 [transition-timing-function:var(--ease-out)]" style="width:\${s.pct}%"></div></div>
    </div>
  \`));
  const up = el('<div class="mt-4"><h3 class="text-sm font-medium mb-2">Próximas pendientes</h3><div class="space-y-2 stagger"></div></div>');
  const list = up.querySelector('div.space-y-2');
  if (upcoming.length === 0) list.appendChild(el('<p class="text-sm text-neutral-500 dark:text-neutral-400">Sin pendientes próximas. Vas al día.</p>'));
  else upcoming.forEach(t => list.appendChild(taskRow(t)));
  node.appendChild(up);
}

function renderMaterias(node) {
  const a = ac();
  const groups = byCourse();
  if (groups.length === 0) {
    node.appendChild(el('<div class="card text-center bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl px-6 py-12"><div class="text-4xl mb-2" aria-hidden="true">🌴</div><p class="text-sm text-neutral-500 dark:text-neutral-400">Sin tareas esta semana. Estás al día.</p></div>'));
    return;
  }
  for (const g of groups) {
    const tasks = g.tasks;
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = Math.round(done / tasks.length * 100);
    const card = el(\`
      <div class="card bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 mb-3">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-semibold text-sm flex items-center gap-2"><span class="inline-block h-2.5 w-2.5 rounded-full \${a.dot}"></span>\${esc(g.label)}</h3>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">\${done}/\${tasks.length}</span>
        </div>
        <div class="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden mb-3"><div class="\${a.bar} h-full transition-[width] duration-500 [transition-timing-function:var(--ease-out)]" style="width:\${pct}%"></div></div>
        <div class="space-y-2 stagger"></div>
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
    \${['all','pending','done'].map(f => '<button data-f="'+f+'" class="chip px-3 py-1.5 rounded-full text-sm border '+(state.filter===f?(a.solid+' text-white border-transparent'):'border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900')+'">'+({all:'Todas',pending:'Pendientes',done:'Hechas'}[f])+'</button>').join('')}
  </div>\`);
  chips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; renderTab(); }));
  node.appendChild(chips);

  let list = state.tasks.slice();
  if (state.filter === 'pending') list = list.filter(t => t.status === 'pending');
  if (state.filter === 'done') list = list.filter(t => t.status === 'done');
  const box = el('<div class="space-y-2 stagger"></div>');
  if (list.length === 0) box.appendChild(el('<p class="text-sm text-neutral-500 dark:text-neutral-400">No hay tareas que mostrar.</p>'));
  else list.forEach(t => box.appendChild(taskRow(t)));
  node.appendChild(box);
}

function renderAjustes(node) {
  const a = ac();
  const p = state.profile;
  const card = el(\`
    <div class="space-y-4">
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-3">
        <h3 class="font-medium">Perfil</h3>
        <label class="block text-sm">Nombre para mostrar</label>
        <input id="dn" class="w-full border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-2 \${a.ring} focus:outline-none focus:ring-2" value="\${esc(p.display_name||'')}" />
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Correo: \${esc(p.email||'—')}</p>
      </div>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-3">
        <h3 class="font-medium">Calendario de Blackboard</h3>
        <label class="block text-sm">URL iCal</label>
        <input id="ical" class="w-full border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-2 font-mono text-xs \${a.ring} focus:outline-none focus:ring-2" value="\${esc(p.ical_url||'')}" placeholder="https://…/learn.ics" />
      </div>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="font-medium">Recordatorio semanal por correo</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Un resumen de tus pendientes a \${esc(p.email||'tu correo')}, una vez por semana, el día y la hora que tú elijas.</p>
            <span id="nmsg" class="text-xs text-neutral-400 dark:text-neutral-500"></span>
          </div>
          <button id="emailToggle" role="switch" aria-checked="\${p.email_notify?'true':'false'}" class="pressable shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 [transition-timing-function:var(--ease-out)] \${p.email_notify?a.bar:'bg-neutral-300 dark:bg-neutral-700'}">
            <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-out)] \${p.email_notify?'translate-x-5':'translate-x-0.5'}"></span>
          </button>
        </div>
        <div id="notifyRow" class="flex flex-wrap items-center gap-3 transition-opacity duration-200 \${p.email_notify?'':'opacity-50 pointer-events-none'}">
          <label class="text-sm" for="notifyDow">Cada</label>
          <select id="notifyDow" class="border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-1.5 text-sm \${a.ring} focus:outline-none focus:ring-2">
            \${[[1,'lunes'],[2,'martes'],[3,'miércoles'],[4,'jueves'],[5,'viernes'],[6,'sábado'],[7,'domingo']].map(d => '<option value="'+d[0]+'"'+((p.notify_dow||1)===d[0]?' selected':'')+'>'+d[1]+'</option>').join('')}
          </select>
          <label class="text-sm" for="notifyTime">a las</label>
          <input id="notifyTime" type="time" value="\${esc(p.notify_time||'07:00')}" class="border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-1.5 text-sm \${a.ring} focus:outline-none focus:ring-2" />
          <span class="text-xs text-neutral-400 dark:text-neutral-500">hora de RD (±30 min)</span>
          <button id="saveSchedule" class="pressable ml-auto \${a.solid} text-white rounded-lg px-3 py-1.5 text-sm">Guardar</button>
          <button id="testEmail" title="Envía un correo ahora para confirmar que recibes de Active Calendar" class="pressable border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-1.5 text-sm">Enviar prueba</button>
        </div>
      </div>
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="font-medium">Recordatorio semanal por Telegram</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Recibe tu resumen semanal de pendientes en Telegram, el mismo día y hora que configures arriba.</p>
            <span id="tgmsg" class="text-xs text-neutral-400 dark:text-neutral-500"></span>
          </div>
          <button id="tgToggle" role="switch" aria-checked="\${p.telegram_notify?'true':'false'}" class="pressable shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 [transition-timing-function:var(--ease-out)] \${p.telegram_notify?a.bar:'bg-neutral-300 dark:bg-neutral-700'} \${p.telegram_chat_id?'':'opacity-40 pointer-events-none'}">
            <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-out)] \${p.telegram_notify?'translate-x-5':'translate-x-0.5'}"></span>
          </button>
        </div>
        <div id="tgRow" class="flex flex-wrap items-center gap-3">
          \${p.telegram_chat_id
            ? '<span class="inline-flex items-center gap-1 text-sm '+a.text+'"><span class="inline-block h-1.5 w-1.5 rounded-full '+a.dot+'"></span>Conectado</span><button id="tgUnlink" class="pressable ml-auto border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-3 py-1.5 text-sm">Desconectar</button>'
            : '<button id="tgConnect" class="pressable '+a.solid+' text-white rounded-lg px-3 py-1.5 text-sm">Conectar Telegram</button><span class="text-xs text-neutral-400 dark:text-neutral-500">Abre el bot y pulsa <b>Start</b>.</span>'}
        </div>
      </div>
      <div class="card bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">Cuatrimestre y materias</h3>
          <button id="saveCourses" class="\${a.solid} text-white text-sm rounded-lg px-3 py-1.5">Guardar materias</button>
        </div>
        <div id="pickerSlot"></div>
        <span id="cmsg" class="text-xs text-neutral-500 dark:text-neutral-400"></span>
      </div>
      <div class="card bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
        <h3 class="font-medium mb-3">Color de acento</h3>
        <div id="accents" class="flex gap-3"></div>
      </div>
      <div class="flex items-center gap-3">
        <button id="save" class="\${a.solid} text-white rounded-lg px-4 py-2 font-medium">Guardar cambios</button>
        <button id="resync" class="border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 rounded-lg px-4 py-2">Sincronizar ahora</button>
        <span id="msg" class="text-sm text-neutral-500 dark:text-neutral-400"></span>
      </div>
      <div class="pt-1">
        <button id="privacyLink" class="pressable text-sm text-neutral-500 dark:text-neutral-400 underline decoration-dotted hover:decoration-solid hover:text-neutral-700 dark:hover:text-neutral-200">Políticas de privacidad</button>
      </div>
    </div>
  \`);
  node.appendChild(card);
  card.querySelector('#privacyLink').addEventListener('click', openPrivacy);

  // Selector de cuatrimestre + materias.
  const selected = new Map((p.courses || []).map(c => [normCode(c.code), { code: normCode(c.code), name: c.name }]));
  const picker = coursePicker(selected, p.term || null);
  card.querySelector('#pickerSlot').appendChild(picker);
  card.querySelector('#saveCourses').addEventListener('click', async (e) => {
    const cmsg = card.querySelector('#cmsg');
    const btn = e.currentTarget; btn.disabled = true;
    cmsg.textContent = 'Guardando…';
    try {
      const term = parseInt(picker.querySelector('#termSel').value, 10) || null;
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ term, courses: [...selected.values()] }) });
      state.profile = r.profile;
      cmsg.textContent = 'Materias guardadas.';
      renderTab();
    } catch (err) { cmsg.textContent = 'Error: ' + err.message; btn.disabled = false; }
  });

  // Toggle de recordatorio por correo: guarda al instante.
  const toggle = card.querySelector('#emailToggle');
  const knob = toggle.querySelector('span');
  const nmsg = card.querySelector('#nmsg');
  const notifyRow = card.querySelector('#notifyRow');
  function paintToggle(on) {
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    toggle.classList.toggle(ac().bar, on);
    toggle.classList.toggle('bg-neutral-300', !on);
    toggle.classList.toggle('dark:bg-neutral-700', !on);
    knob.classList.toggle('translate-x-5', on);
    knob.classList.toggle('translate-x-0.5', !on);
    notifyRow.classList.toggle('opacity-50', !on);
    notifyRow.classList.toggle('pointer-events-none', !on);
  }
  toggle.addEventListener('click', async () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    paintToggle(next);
    nmsg.textContent = 'Guardando…';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ email_notify: next }) });
      state.profile = r.profile;
      nmsg.textContent = next ? 'Recordatorio activado.' : 'Recordatorio desactivado.';
    } catch (err) {
      paintToggle(!next);
      nmsg.textContent = 'Error: ' + err.message;
    }
  });

  // Día y hora personalizados: se guardan SOLO al pulsar "Guardar". Esto no
  // envía nada en el momento; solo registra cuándo debe enviarse el sistema.
  const DOW_NAMES = { 1:'lunes', 2:'martes', 3:'miércoles', 4:'jueves', 5:'viernes', 6:'sábado', 7:'domingo' };
  const notifyDow = card.querySelector('#notifyDow');
  const notifyTime = card.querySelector('#notifyTime');
  card.querySelector('#saveSchedule').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Guardando…';
    nmsg.textContent = '';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({
        notify_dow: parseInt(notifyDow.value, 10) || 1,
        notify_time: notifyTime.value || '07:00',
      })});
      state.profile = r.profile;
      notifyDow.value = String(r.profile.notify_dow || 1);
      notifyTime.value = r.profile.notify_time || '07:00';
      nmsg.textContent = 'Guardado: cada ' + (DOW_NAMES[r.profile.notify_dow] || 'lunes') + ' a las ' + (r.profile.notify_time || '07:00') + '.';
    } catch (err) { nmsg.textContent = 'Error: ' + err.message; }
    finally { btn.disabled = false; btn.textContent = old; }
  });

  // Botón de prueba: dispara un correo ahora.
  card.querySelector('#testEmail').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Enviando…';
    nmsg.textContent = '';
    try {
      const r = await api('/api/test-email', { method: 'POST' });
      nmsg.textContent = 'Correo de prueba enviado a ' + r.sent_to + ' (' + r.pending + ' pendientes).';
    } catch (err) {
      nmsg.textContent = 'Error: ' + err.message;
    } finally { btn.disabled = false; btn.textContent = old; }
  });

  // ---- Telegram: conectar / desconectar / opt-in ----
  const tgmsg = card.querySelector('#tgmsg');
  const tgToggle = card.querySelector('#tgToggle');
  const tgKnob = tgToggle.querySelector('span');
  function paintTg(on) {
    tgToggle.setAttribute('aria-checked', on ? 'true' : 'false');
    tgToggle.classList.toggle(ac().bar, on);
    tgToggle.classList.toggle('bg-neutral-300', !on);
    tgToggle.classList.toggle('dark:bg-neutral-700', !on);
    tgKnob.classList.toggle('translate-x-5', on);
    tgKnob.classList.toggle('translate-x-0.5', !on);
  }
  tgToggle.addEventListener('click', async () => {
    if (!state.profile.telegram_chat_id) return; // sin vincular no hace nada
    const next = tgToggle.getAttribute('aria-checked') !== 'true';
    paintTg(next);
    tgmsg.textContent = 'Guardando…';
    try {
      const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ telegram_notify: next }) });
      state.profile = r.profile;
      tgmsg.textContent = next ? 'Recordatorio por Telegram activado.' : 'Recordatorio por Telegram desactivado.';
    } catch (err) { paintTg(!next); tgmsg.textContent = 'Error: ' + err.message; }
  });

  // Espera (en segundo plano) a que el usuario complete el "Start" en Telegram.
  async function pollTgLink() {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const me = await api('/api/me');
        if (me.profile && me.profile.telegram_chat_id) { state.profile = me.profile; renderTab(); return; }
      } catch (e) {}
    }
  }
  const tgConnect = card.querySelector('#tgConnect');
  if (tgConnect) {
    tgConnect.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Generando…';
      tgmsg.textContent = '';
      try {
        const r = await api('/api/telegram/link', { method: 'POST' });
        window.open(r.url, '_blank', 'noopener');
        tgmsg.textContent = 'Abre Telegram y pulsa Start. Esta página se actualizará sola al conectar…';
        pollTgLink();
      } catch (err) {
        tgmsg.textContent = 'Error: ' + err.message;
      } finally { btn.disabled = false; btn.textContent = old; }
    });
  }
  const tgUnlink = card.querySelector('#tgUnlink');
  if (tgUnlink) {
    tgUnlink.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Desconectando…';
      try {
        const r = await api('/api/telegram/unlink', { method: 'POST' });
        state.profile = r.profile;
        renderTab();
      } catch (err) { btn.disabled = false; btn.textContent = old; tgmsg.textContent = 'Error: ' + err.message; }
    });
  }

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
    try {
      const s = await api('/api/sync', { method: 'POST' }); state.tasks = s.tasks || [];
      try { const me = await api('/api/me'); state.profile = me.profile; state.range = me.range; } catch (e2) {}
      renderShell();
    }
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
    b.className = 'tabbtn px-3 py-2 text-sm rounded-lg ' + (on ? (ac().soft + ' ' + ac().text + ' font-medium') : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800');
  });
}

function renderShell() {
  root.innerHTML = '';
  const a = ac();
  const shell = el(\`
    <div class="max-w-3xl mx-auto px-4 py-6">
      <header class="flex items-center justify-between gap-3 mb-5">
        <div>
          <div class="text-neutral-400 dark:text-neutral-500 mb-1">\${brand('text-sm')}</div>
          <h1 class="text-xl font-semibold leading-tight">Hola, \${esc(state.profile.display_name||'')}</h1>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">Semana \${esc(rangeText(state.range))}</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="exportBtn" title="Exportar tareas" class="pressable border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 text-sm rounded-lg px-3 py-2 inline-flex items-center gap-1.5"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span class="hidden sm:inline">Exportar</span></button>
          <button id="syncBtn" class="\${a.solid} text-white text-sm rounded-lg px-3 py-2">Sincronizar</button>
          <div id="userbtn"></div>
        </div>
      </header>
      <nav class="flex gap-1 mb-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-1 w-full overflow-x-auto">
        \${TABS.map(([k,l]) => '<button data-tab="'+k+'" class="tabbtn px-3 py-2 text-sm rounded-lg whitespace-nowrap">'+l+'</button>').join('')}
      </nav>
      <main id="tabContent"></main>
      <footer class="mt-10 pt-4 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-400 dark:text-neutral-500">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span>© 2026 Active Calendar</span>
          <button id="privacyLink" class="pressable hover:text-neutral-700 dark:hover:text-neutral-300 underline decoration-dotted hover:decoration-solid">Políticas de privacidad</button>
        </div>
        <p class="mt-2 text-center sm:text-left">Developed by <span class="font-medium text-neutral-500 dark:text-neutral-400">Oscar O. Jiménez</span></p>
      </footer>
    </div>
  \`);
  root.appendChild(shell);
  mountUserButton(document.getElementById('userbtn'));
  shell.querySelector('#privacyLink').addEventListener('click', openPrivacy);
  shell.querySelector('#exportBtn').addEventListener('click', openExportModal);
  shell.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderTab(); }));
  shell.querySelector('#syncBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Sincronizando…';
    try {
      const s = await api('/api/sync', { method: 'POST' }); state.tasks = s.tasks || [];
      try { const me = await api('/api/me'); state.profile = me.profile; state.range = me.range; } catch (e2) {}
      renderTab(); btn.textContent = old; btn.disabled = false;
    }
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
function fatal(e) {
  const msg = (e && e.message) ? e.message : String(e);
  root.innerHTML = '<div class="max-w-lg mx-auto mt-20 px-4">' +
    '<div class="bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-800 rounded-xl p-6">' +
    '<h1 class="text-lg font-semibold mb-2">No se pudo iniciar la app</h1>' +
    '<pre class="text-sm whitespace-pre-wrap text-rose-700 dark:text-rose-300">' + esc(msg) + '</pre>' +
    '<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-3">Si dice algo de "production"/"domain", es porque estás usando una clave de Clerk de producción en localhost. Prueba en el dominio real o usa una instancia de desarrollo de Clerk (pk_test_…).</p>' +
    '</div></div>';
  console.error(e);
}

// Firma de autoría + aviso. (El código del navegador siempre es visible; esto
// deja claro que es propietario y de quién es.)
try {
  console.log('%cActive Calendar', 'font-size:20px;font-weight:700;color:#0a0a0a;background:#fafafa;padding:4px 8px;border-radius:6px;');
  console.log('%cDeveloped by Oscar O. Jiménez · © 2026 · Todos los derechos reservados.', 'color:#737373;');
  console.log('%c⚠️ Software propietario. Prohibida su copia o redistribución no autorizada.', 'color:#b91c1c;font-weight:600;');
} catch (e) {}

setupThemeToggle();
try {
  await clerk.load();
  if (clerk.user) await loadAndRender();
  else renderLanding();

  clerk.addListener(({ user }) => {
    if (user && !state.profile) loadAndRender();
    else if (!user) renderLanding();
  });
} catch (e) {
  fatal(e);
}
</script>
</body>
</html>`;
}
