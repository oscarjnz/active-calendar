# Active Calendar

**Web app** que reúne las tareas de Blackboard de la semana en una sola vista, sin instalar nada. Inicias sesión con tu email (enlace mágico, sin contraseñas), pegas tu URL iCal de Blackboard una vez, y listo: ves todas tus tareas de la semana y las marcas como hechas con un check. Diseñada para que tú y tus amigos la usen desde cualquier navegador, escritorio o móvil.

- **Frontend + backend + cron**: un solo Cloudflare Worker.
- **Auth + base de datos**: Supabase (magic link + Postgres con RLS).
- **Deploy 100% web** vía GitHub Actions — solo haces `git push` y se actualiza.
- **Privacidad**: solo se guarda email (lo gestiona Supabase Auth), nombre que el usuario ingrese, y la URL iCal personal. Nada más.

> Para tus amigos no hay configuración: les pasas la URL del Worker, entran con su email y pegan su iCal. Eso es todo.

---

## Stack

- Cloudflare Workers (runtime + Cron Triggers)
- TypeScript estricto
- Supabase (Auth + Postgres + RLS)
- Tailwind (CDN) y `@supabase/supabase-js` (CDN) en el frontend — sin build step
- GitHub Actions (deploy automático con `cloudflare/wrangler-action`)

## Zona horaria

Toda la lógica de "semana actual" usa **America/Santo_Domingo (UTC-4, sin DST)**. Lunes 00:00 → Domingo 23:59:59 hora local.

## Arquitectura

```
Browser  ──HTML+JS──>  Cloudflare Worker  ──REST──>  Supabase (Auth + DB)
   │                         │                          │
   │     magic link login    │                          │
   └────supabase-js direct───┴── lecturas/updates ──────┘
                             │
              Cron x3/día ───┘  fetch iCal por usuario → upsert tasks
```

- El navegador habla **directamente** con Supabase para login, leer perfil y tareas, y togglear `status` (RLS asegura que cada usuario solo ve lo suyo).
- El Worker se encarga de **servir el HTML** y de **sincronizar con Blackboard** (servicio que solo él puede hacer porque tiene la `service_role` key y respeta CORS).

## Estructura

```
active-calendar/
  src/
    index.ts        # entry: GET / sirve la SPA, POST /api/sync, scheduled cron
    html.ts         # SPA inline (HTML + JS) servida por el Worker
    ical.ts         # parser VEVENT + filtro semanal
    supabase.ts     # wrappers (admin + user)
    diff.ts         # cálculo de deltas
    time.ts         # zona horaria SDQ
    types.ts        # tipos compartidos
  .github/workflows/deploy.yml
  schema.sql
  wrangler.toml
  package.json
  tsconfig.json
  .dev.vars.example
  .gitignore
  README.md
```

---

## Cómo obtener tu URL iCal de Blackboard

> El enlace es **personal** (contiene un token). No lo compartas. Solo lo pegas en tu propio perfil dentro de la app.

1. Inicia sesión en tu portal de Blackboard.
2. Abre el **Calendario**.
3. Busca el botón **"Get External Calendar Link"** / **"Obtener enlace de calendario externo"** / **"iCal Feed"** (suele estar en el menú de ajustes — engranaje o `⋯` — del calendario).
4. Si nunca lo generaste, dale **Generar**. Si crees que alguien lo vio, **Regenera** para invalidar el viejo.
5. Copia la URL (debe terminar en `.ics`).
6. En la app, pégala en el campo "URL iCal de Blackboard" y pulsa **Guardar** y luego **Sincronizar**.

---

## Setup (operador — una sola vez)

### 1. Crear el proyecto en Supabase

1. Crea proyecto en https://supabase.com (plan free es suficiente).
2. SQL Editor → pega [`schema.sql`](schema.sql) → Run.
3. **Authentication → Providers → Email** → asegúrate de que **Email** esté habilitado y **"Enable email confirmations"** está activado (es el magic link).
4. **Authentication → URL Configuration**:
   - `Site URL` → la URL de tu Worker (ej: `https://active-calendar.<tu-sub>.workers.dev`).
   - `Redirect URLs` → añade la misma URL.
5. **Project Settings → API** → copia:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_KEY` *(secreto — nunca expongas en el cliente)*

### 2. Crear el Worker en Cloudflare (web, sin local)

Opción A — **todo desde GitHub** (recomendado):

1. Sube este repo a GitHub (ya está listo).
2. En **Cloudflare dashboard → Workers & Pages → Create → Workers → Connect a Git repo**.
3. Selecciona el repo y confirma. Cloudflare detecta `wrangler.toml` y despliega solo.
4. Una vez creado el Worker, ve a **Settings → Variables and Secrets** y añade:
   - `SUPABASE_URL` (Type: **Secret**)
   - `SUPABASE_ANON_KEY` (Type: **Secret** — aunque sea pública, así no queda en el repo)
   - `SUPABASE_SERVICE_KEY` (Type: **Secret**)
5. En **Settings → Variables** edita `APP_BASE_URL` (text) con la URL real del Worker.

Opción B — **GitHub Actions** (push automático):

1. En GitHub → **Settings → Secrets and variables → Actions** añade:
   - `CLOUDFLARE_API_TOKEN` (créalo en Cloudflare con plantilla "Edit Cloudflare Workers")
   - `CLOUDFLARE_ACCOUNT_ID` (lo encuentras en el dashboard de Cloudflare, columna derecha)
2. Haz `git push` a `main`. El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) corre `tsc --noEmit` y `wrangler deploy`.
3. La primera vez carga los secrets en el dashboard como en Opción A (sólo se hace una vez).

### 3. Configurar Supabase con la URL final

Una vez tengas la URL del Worker (ej. `https://active-calendar.tusub.workers.dev`):
- Actualiza `Site URL` y `Redirect URLs` en Supabase con esa URL.
- Actualiza la variable `APP_BASE_URL` en el Worker con esa URL.

### 4. Probar

1. Abre la URL del Worker.
2. Ingresa tu email → revisa la bandeja → clic al enlace.
3. Pega tu URL iCal → **Guardar** → **Sincronizar**.
4. Deberías ver tus tareas de la semana. Marca alguna como hecha.

### 5. Compartir con tus amigos

Solo dales la URL del Worker. Cada quien crea su sesión con su email y pega su propia iCal.

---

## Cron triggers

| Cron UTC     | Hora SDQ | Qué hace                                              |
|--------------|----------|-------------------------------------------------------|
| `0 11 * * *` | 07:00    | Refresca tareas de la semana de todos los usuarios    |
| `0 15 * * *` | 11:00    | Refresca tareas de la semana de todos los usuarios    |
| `0 23 * * *` | 19:00    | Refresca tareas de la semana de todos los usuarios    |

El cron preserva el `status` que el usuario haya marcado a mano.

## Endpoints HTTP

- `GET /` — SPA.
- `POST /api/sync` — `Authorization: Bearer <jwt>` del usuario. Refresca su iCal en el momento.
- `GET /api/health` — `{ ok: true }`.

## Desarrollo local (opcional)

```bash
npm install
cp .dev.vars.example .dev.vars   # rellena valores
npm run dev
```

`npm run typecheck` para validar tipos.

## Roadmap

- **v1 (actual)**: dashboard web, login email, sync manual + cron 3×/día, checks.
- **v2**: digest semanal por email (Resend) los domingos con el resumen del lunes.
- **v3**: exportar tareas pendientes como `.ics` para enchufar a Google/Apple Calendar.

---

## Qué debes hacer **tú** manualmente (una vez)

1. Crear el proyecto en **Supabase** y correr [`schema.sql`](schema.sql).
2. Habilitar el provider **Email** en Supabase y configurar `Site URL` / `Redirect URLs`.
3. Subir este repo a GitHub.
4. Crear el Worker en Cloudflare conectando el repo de GitHub (o configurar el secret `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` en GitHub Actions).
5. Añadir como secrets en el Worker: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
6. Editar la variable `APP_BASE_URL` con la URL real del Worker.
7. Abrir la URL, hacer login con tu email, pegar tu iCal y compartir la URL con tus amigos.
