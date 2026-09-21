# Active Calendar — memoria activa del proyecto

Web app que reúne las tareas de Blackboard de la semana en una sola vista, agrupadas por
materia, con progreso, personalización y recordatorios (email + Telegram). Es un proyecto
personal del usuario (estudiante de Ingeniería en Tecnologías Computacionales, UNIBE) y de
sus amigos, que comparten la misma app pero cada uno con su propio login y su propio feed
iCal de Blackboard.

## Stack

- **Todo en un Cloudflare Worker**: frontend (HTML servido inline), API REST y cron, sin
  build de frontend separado (`src/html.ts` genera el HTML/JS que ve el navegador).
- **Auth**: Clerk (componentes prefabricados). El navegador solo conoce la publishable key.
- **DB**: Supabase (Postgres), accedida únicamente desde el Worker con la `service_role` key
  (RLS bloquea todo acceso directo). Esquema en [`schema.sql`](schema.sql).
- **Notificaciones**: Resend (email) y bot de Telegram (long-lived webhook), semanales,
  configurables por usuario (día + hora + canal).
- **Deploy**: `wrangler deploy` vía GitHub Actions (`.github/workflows/deploy.yml`) o
  conectando el repo en el dashboard de Cloudflare.

## Estructura de `src/`

- `index.ts` — entrypoint del Worker: rutas `/api/*`, `scheduled()` (cron), orquesta sync +
  notificaciones.
- `ical.ts` — parser de iCal (RFC 5545) minimalista para el feed de Blackboard. Distingue
  eventos de **sesión/clase** (traen materia confiable en el UID/SUMMARY) de **tareas**
  (no la traen necesariamente). `deriveCourseCode()` es el corazón de la auto-asignación de
  materia a una tarea.
- `pensum.ts` — catálogo estático del pensum UNIBE (código → nombre, semestre, electiva) +
  `COURSE_SIGNALS` (palabras clave por materia para el tercer nivel de `deriveCourseCode`).
- `supabase.ts` — todo el acceso a Postgres (perfiles, tareas, upsert, merge de materias).
- `diff.ts` — calcula delta (created/modified/unchanged) entre el feed nuevo y lo guardado.
- `time.ts` — lógica de "semana académica actual" en America/Santo_Domingo (UTC-4, sin DST).
- `clerk.ts` — verifica el token de Clerk en cada request autenticado y consulta datos de
  usuario.
- `email.ts` / `telegram.ts` — envío de recordatorios semanales por cada canal.
- `html.ts` — genera el HTML/CSS/JS del SPA (sin framework, se sirve inline desde el Worker).
  Tabs: Resumen, Horario, Materias, Todas, Pensum, Ajustes.
  **OJO:** casi todo el archivo vive dentro de un template literal, así que un backtick o un
  `${` sueltos (incluso dentro de un comentario) rompen el archivo; `tsc` los reporta como
  errores raros de sintaxis a decenas de líneas de distancia. Como `tsc` no revisa el JS del
  navegador, para validarlo: `npx esbuild src/html.ts --bundle --format=esm --outfile=tmp.mjs`,
  llamar a `renderApp({})`, extraer el `<script type="module">` y pasarle `node --check`.
  Teclado: usar `submitOnEnter(ids, buttonId, root)` y `trapFocus(panel, initial)` en cada
  formulario o panel nuevo (el usuario exige que todo se pueda usar sin mouse).
  Incluye **Exportar** (100% cliente, sin endpoint en el Worker), con tres documentos en
  `EXPORTS`: tareas, horario y pensum. Los tres comparten la misma maquinaria: cada
  documento es una lista de bloques HTML, `expPaginate` los mide de verdad y los reparte en
  hojas A4 completas sin partir ninguno, y `expRenderCanvases` rasteriza **una hoja por
  canvas** con `html2canvas` (CDN, `loadExportLibs`) para armar el PDF con `jsPDF`, la
  imagen `.jpg` o el texto plano. **No volver al esquema viejo** de rasterizar todo el
  documento en una imagen larga y cortarla cada 297 mm: partía tarjetas por la mitad y
  siempre añadía una página en blanco al final por el redondeo del alto.
  Para agregar un documento nuevo basta con una entrada en `EXPORTS` con `blocks()` y
  `text()`; cada bloque lleva su propio `margin-bottom` (la paginación lo mide).

## Cómo se asigna la materia a una tarea (`deriveCourseCode`, en `ical.ts`)

Las **sesiones de clase** sí traen el código de materia confiable en el SUMMARY (se usa
para descubrir automáticamente las materias matriculadas, `collectEnrolledCourses`). Las
**tareas** (entregas) no siempre lo traen, así que se derivan en cascada, solo contra las
materias que el estudiante ya tiene matriculadas (`profile.courses`):

1. Código explícito en el texto de la tarea (ej. "TI3712-...").
2. Nombre completo de alguna materia matriculada dentro del SUMMARY.
3. `COURSE_SIGNALS[code]` — palabras/frases clave específicas de la materia (ej. "xamarin",
   "criptograf", "malware") para tareas cuyo título es genérico ("Actividad 4",
   "TAREA 15_Analisis de Malware.docx") y no menciona ni código ni nombre de materia.

Si los tres niveles anteriores fallan, `syncOne` (en `index.ts`) aplica un **cuarto nivel**:
`deriveCourseCodeByProximity`, que infiere la materia por cercanía del ID numérico de
"gradebook item" de Blackboard (parte del UID, ej. `..._870039_1` -> `870039`) contra tareas
YA clasificadas del estudiante (manual o automáticamente, de cualquier semana, vía
`listClassifiedTasks` en `supabase.ts`). Blackboard suele crear los ítems de un curso en
bloques contiguos de ID, así que una tarea sin señal de texto que cae entre dos tareas ya
clasificadas de la MISMA materia (o muy cerca de una sola) probablemente es de esa materia.
Esto requiere que exista al menos una tarea "semilla" (resuelta por los tiers 1-3 o asignada
a mano) cerca en ID; materias 100% genéricas en su naming (sin ninguna palabra clave posible,
ej. "Laboratorio05", "Primer Parcial") solo empiezan a autoasignarse una vez el estudiante
clasifique manualmente la primera tarea de esa materia.

Si nada matchea, la tarea queda sin materia y el estudiante puede asignarla a mano desde la
UI (`setTaskCourse`, endpoint `POST /api/task` con `course_code`). Una asignación manual
**nunca** se pisa en syncs futuros (`upsertEvents` en `supabase.ts` prioriza
`prev.course_code` sobre lo derivado del feed).

Al agregar soporte para una materia electiva nueva o mejorar el matching, extender
`COURSE_SIGNALS` en `pensum.ts` es el lugar correcto — usar frases/palabras razonablemente
distintivas (evitar términos genéricos tipo "actividad" o "laboratorio" que colisionan entre
materias) y sin tildes (el matching normaliza acentos).

### Backfill de tareas de otras semanas (`backfillCourseCodes`, en `index.ts`)

**Importante:** `syncOne` solo pasa por los 3 niveles de `deriveCourseCode` (y el nivel 4 con
las tareas de la propia semana) para las tareas de la **semana académica actual**
(`filterInRange`). Las tareas de semanas pasadas o futuras, una vez guardadas, no se vuelven a
tocar en syncs normales — así que si el algoritmo de derivación mejora (o el estudiante recién
agrega una materia a su perfil), esas tareas viejas se quedarían con `course_code = null` para
siempre. Por eso, al final de cada `syncOne`, `backfillCourseCodes` corre sobre **todas** las
tareas sin materia del estudiante (cualquier semana, vía `listUnclassifiedTasks` en
`supabase.ts`) y les aplica los 4 niveles usando el `summary` ya guardado (no necesita
refetch del feed). Solo escribe la columna `course_code` (`bulkSetCourseCodes`); nunca toca
`status`, `first_seen` ni `last_seen`. Es idempotente y barato (solo hace algo si hay filas con
`course_code IS NULL`), así que es seguro que corra en cada sync, incluido el cron 3×/día.

Con un feed real de ejemplo (85 tareas de 9 materias, cuatrimestre 2026-3): el pipeline de 4
niveles + backfill resolvió 66/85 (78%) sin falsos positivos verificados a mano. Las 19
restantes eran de dos materias (Sistemas Operativos, Criptografía) cuyos títulos de tarea no
traen ninguna palabra clave posible (ej. "Laboratorio05", "actividad 2") — esas necesitan que
el estudiante clasifique manualmente la primera tarea de esa materia para darle una "semilla"
al nivel 4; el resto de esa materia se autoasigna solo en el siguiente sync.

## Horario semanal (tab Horario)

Tiene **dos fuentes** y manda la académica. Cada `ClassSlot` recuerda de dónde salió
(`src: 'academic' | 'ical'`), y eso no es decorativo: la fuente académica se consulta con
throttle de 12 h y el iCal en cada sync, así que sin esa marca un tick normal borraría los
bloques buenos y los sustituiría por los del feed. La fusión vive en `syncOne` (`index.ts`):
los bloques académicos ya guardados se conservan mientras no haya consulta nueva, y del iCal
solo se usan las materias que la fuente académica no reporte.

- **Fuente académica** (`fetchEnrolledSchedule` en `academic.ts`): trae el horario completo
  del período, con **profesor**, **sección** y **aula** (cuando la universidad la publica).
  Sale de la misma fila de la que ya se leían las materias, así que no cuesta una petición
  extra. Cada día llega como una celda de texto que mezcla hora, profesor y aula;
  `parseScheduleCell()` la desarma de forma tolerante (varios formatos de hora, uno o dos
  bloques por día, celda vacía = sin clase) y está exportada para poder probarla sola.
  **OJO:** el marcador am/pm exige la `m`; con la `m` opcional, un `"11:30\rPEREZ…"` se comía
  la P del apellido como si fuera "pm" y convertía las 11:30 en las 23:30.
  `cleanSlot()` (exportada en `academic.ts`) vuelve a filtrar cada bloque **ya guardado** en
  `syncOne`: quita el rango de fechas del cuatrimestre ("DEL : … AL : …"), el código de
  empleado delante del profesor y el descriptor del aula. Sin eso, un horario escrito por un
  parser viejo se quedaría sucio hasta la próxima consulta a la fuente (12 h). El navegador
  repite el mismo saneo al leer `profiles.schedule` (`cleanSlot`/`cleanTeacher`/`cleanRoom` en
  `html.ts`), así que la tarjeta se ve limpia aunque la fila todavía no se haya reescrito.
  La tarjeta del día muestra una línea por dato (Código · Sec., Prof., Aula) en vez de todo
  junto, y el profesor se acorta a "Nombre Apellido" (`teacherShort`, completo en el `title`).
- **iCal**, de respaldo: solo cubre las materias cuyo profesor publique las sesiones de clase
  en el calendario de Blackboard, que en la práctica son pocas (en el feed real del usuario,
  una de nueve). Por eso el tab avisa cuántas materias faltan y por qué: sin ese aviso se
  lee como un bug de la app. No trae profesor ni aula.

Detalle del respaldo por iCal: las sesiones de clase traen `DTSTART`/`DTEND`
y el código de materia, así que `buildWeeklySchedule` (en `ical.ts`) deduplica las semanas
repetidas del cuatrimestre y deja una "semana tipo" `[{code,name,day,start,end}]` en hora de
Santo Domingo (`day`: 0=Lun..6=Dom). `syncOne` la guarda en `profiles.schedule` con
`setSchedule` (aparte de `updateProfile`, para que no se pueda escribir desde
`/api/profile`), y solo cuando cambió. El horario también alimenta el tab Resumen:
`nextClassCard()` (tarjeta de próxima clase o clase en curso, también en modo vacaciones) y
`classOnDueDay(t)`, que marca en cada tarea pendiente si ese día hay clase de esa misma
materia.

## Fuente académica y matrícula (`academic.ts`)

Segunda fuente de materias matriculadas, además de las sesiones del iCal. **El repo es
público: en el código no puede haber nada de la fuente** (host, rutas, parámetros ni campos).
Todo vive en el secret `ACADEMIC_SOURCE` (JSON, forma documentada en `academic.ts`) y el
módulo solo lo interpreta de forma genérica. Solo corre en el Worker; el navegador nunca la
toca. No agregar aquí, en comentarios ni en commits ningún detalle de esa fuente.

- La matrícula (`profiles.student_id`) se captura y **verifica** en el paso previo al
  onboarding (`renderStudentId`): nombre + matrícula + correo institucional, pop-up de
  confirmación, y código de 6 dígitos enviado por Resend a ese correo
  (`/api/identity/start` y `/verify`, tabla `identity_checks`, solo se guarda el hash). El
  servidor compara nombre y correo con el nombre oficial y nunca lo devuelve al navegador;
  los fallos responden igual para no filtrar si una matrícula existe. Se fija **una sola
  vez**: solo `setStudentId` la escribe (update atómico con `is null`), nunca
  `updateProfile`. Única por cuenta (índice único parcial). Cuentas nuevas lo ven a
  pantalla completa; quien ya estaba dentro entra a su app y lo ve como ventana encima
  (`openIdentityModal`, una vez por sesión hasta verificar), sin reiniciar nada.
- También alimenta `completed_courses` (solo códigos aprobados del pensum, aditivo).
- `syncOne` consulta con throttle de 12 h (`academic_synced_at`) y fusiona con
  `mergeCourses` (aditivo; el iCal sigue de respaldo si la fuente falla).
- Siempre se usa la matrícula guardada en el perfil, jamás una que llegue del navegador.
- Del horario se leen código, nombre, sección, día, hora, profesor y aula (ver "Horario
  semanal"). No se leen ni guardan notas, cédula, fecha de nacimiento ni ningún otro dato
  personal: del historial solo salen los códigos aprobados, y el nombre oficial se compara en
  el servidor y nunca se devuelve al navegador.
- Los campos de día y de sección en el secret son **opcionales**: si faltan, el horario se
  queda solo con lo que dé el iCal y nada más se rompe.
- Las peticiones a la fuente **deben llevar `User-Agent`**: el `fetch` de un Worker sale sin
  ninguno y el proveedor responde 403. Si vuelve a fallar, `call()` loguea el código HTTP y la
  cabecera `cf-mitigated` (con `challenge` sería un WAF de verdad, sin eso es la aplicación).
- Si la fuente está caída o bloquea, `/api/identity/start` responde 503 y la pantalla ofrece
  continuar sin verificar: una fuente caída nunca debe dejar a un estudiante fuera de la app.

## Cómo correr / testear

```bash
npm install
cp .dev.vars.example .dev.vars   # rellenar CLERK_SECRET_KEY, SUPABASE_*, CLERK_PUBLISHABLE_KEY, etc.
npm run dev                       # http://localhost:8787
npm run typecheck
```

No hay suite de tests automatizada; los cambios en `ical.ts`/`pensum.ts` se verifican
manualmente o con `tsc` + revisión de lógica.

## Convenciones

- Comentarios en español, estilo conciso, solo cuando explican el "por qué" (ver el resto
  del código para el tono — abundan notas tipo "OJO:" antes de trade-offs no obvios).
- `normalizeCode()` (en `pensum.ts`) es la forma canónica de comparar códigos de materia:
  mayúsculas, sin guiones ni espacios.
- El cron corre cada 30 min (un solo trigger `*/30 * * * *`) y en cada tick hace TODO:
  sincroniza el iCal de cada usuario (`syncOne`), dispara la alerta instantánea de tareas
  nuevas si aplica, y chequea el resumen semanal — ver `notificaciones` abajo.

## Notificaciones: resumen semanal vs. alerta instantánea de tareas nuevas

Hay dos mecanismos de notificación independientes, ambos en `index.ts`, evaluados en cada
tick del cron (cada 30 min):

- **`maybeNotify`** — el resumen semanal de siempre: un correo/Telegram por semana, el día y
  hora que cada usuario eligió en Ajustes, con guard "ya enviado hoy" (`last_emailed` /
  `last_telegram`) para no duplicar.
- **`notifyNewTasks`** — alerta instantánea: se dispara apenas `syncOne` detecta tareas que
  no existían antes (`computeDelta.created` en `diff.ts`). Si el profesor sube 15 tareas de
  un tirón, todas caen en el mismo `sync` (cada 30 min) y se agrupan en **un solo**
  correo/mensaje por canal (`sendNewTasksEmail` en `email.ts`, `sendNewTasksTelegram` en
  `telegram.ts`) — nunca una notificación por tarea. No depende del día/hora elegidos por el
  usuario (dispara apenas hay algo nuevo) ni necesita guard de "ya enviado hoy": es
  idempotente porque `computeDelta` solo marca una tarea como `created` la primera vez que
  aparece (tras `upsertEvents` ya queda como "existing" para el próximo sync). Respeta los
  mismos toggles de canal que el resumen semanal (`email_notify` / `telegram_notify`).

Antes el sync pesado (fetch + parse del iCal) solo corría 3×/día; ahora corre en los 48
ticks/día del cron para poder detectar tareas nuevas casi en tiempo real. Si esto genera
carga notable contra el feed de Blackboard de cada usuario, considerar separar de nuevo el
sync en dos cadencias (una liviana solo para detectar `created` y otra pesada para
backfill/descubrimiento de materias), pero por ahora un solo `syncOne` cada 30 min cubre
todo.
