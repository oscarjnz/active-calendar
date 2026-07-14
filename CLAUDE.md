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
- El cron corre 3×/día (sync pesado) pero el chequeo de notificación corre en cada tick para
  respetar la hora elegida por cada usuario — ver comentarios en `index.ts`.
