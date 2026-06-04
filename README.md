# Active Calendar

**Web app** que reúne tus tareas de Blackboard de la semana en una sola vista, organizadas por materia, con secciones, progreso y personalización. Sin instalar nada: tú y tus amigos entran a una URL, inician sesión con **Clerk** (Google, email, etc.), pegan su enlace iCal de Blackboard una vez, y listo.

- **Frontend + API + cron**: un solo Cloudflare Worker.
- **Login**: Clerk (componentes prefabricados, sin límite de emails).
- **Base de datos**: Supabase (Postgres). El navegador **nunca** habla con Supabase: solo el Worker, que verifica el token de Clerk en cada llamada.
- **Deploy web** vía GitHub Actions o conectando el repo en Cloudflare.

## Cómo funciona

```
Navegador ── Clerk (login) ──> obtiene token de sesión
   │
   └── fetch /api/* con  Authorization: Bearer <token Clerk> ──> Cloudflare Worker
                                                                     │ verifica token (Clerk)
                                                                     │ lee/escribe (service key)
                                                                     └──> Supabase (Postgres)
Cron 3×/día ─> Worker ─> por cada usuario con iCal: descarga, parsea, upsert tareas
```

El navegador solo conoce la **publishable key** de Clerk (pública). Las claves secretas (Clerk secret, Supabase service) viven únicamente en el Worker.

## Secciones de la app

1. **Resumen** — pendientes / hechas / total, barra de progreso y próximas tareas.
2. **Materias** — tareas agrupadas por curso, cada una con su progreso.
3. **Todas** — lista completa con filtros (todas / pendientes / hechas).
4. **Ajustes** — nombre, URL iCal, **color de acento** (personalización) y sincronizar.

Si entras y aún no has puesto tu enlace iCal, la app te lleva a una pantalla de **onboarding** para pegarlo.

## Zona horaria

Toda la lógica de "semana actual" usa **America/Santo_Domingo (UTC-4, sin DST)**: lunes 00:00 → domingo 23:59:59.

---

## Cómo obtener tu URL iCal de Blackboard

> El enlace es **personal** (contiene un token). No lo compartas. Solo lo pegas en tu propio perfil.

1. Inicia sesión en el portal de Blackboard de tu universidad.
2. Abre el **Calendario**.
3. Busca **"Get External Calendar Link"** / **"Obtener enlace de calendario externo"** / **"iCal Feed"** (menú de ajustes del calendario — engranaje o `⋯`).
4. Genera el enlace (o **Regenera** si crees que se filtró). Debe terminar en `.ics`.
5. Pégalo en la app (onboarding o Ajustes) y pulsa **Sincronizar**.

---

# Setup completo (operador — una sola vez)

### Paso 1 — Supabase (base de datos)

1. Crea un proyecto en https://supabase.com (plan free).
2. **SQL Editor** → pega [`schema.sql`](schema.sql) → **Run**. (Recrea las tablas; como no hay datos reales, no pasa nada.)
3. **Project Settings → API** → copia:
   - **Project URL** → será `SUPABASE_URL`.
   - **service_role** secret → será `SUPABASE_SERVICE_KEY`.
   > Ya **no** necesitamos la anon key ni el provider de Email: el login lo hace Clerk.

### Paso 2 — Clerk (login)

1. Entra a https://dashboard.clerk.com y crea una **Application** (o usa una existente).
2. Elige los métodos de inicio de sesión que quieras (Google, email, etc.).
3. En **API Keys** copia:
   - **Publishable key** (`pk_...`) → es **pública**.
   - **Secret key** (`sk_...`) → será `CLERK_SECRET_KEY` (secreta).
4. En **Paths / Domains** (o "Allowed origins"): cuando tengas la URL final del Worker, añádela como dominio permitido del frontend. Para empezar, el dominio `*.workers.dev` funciona con las dev keys de Clerk.
   > Sugerencia: usa las **dev keys** de Clerk mientras pruebas; pasa a **production keys** cuando uses un dominio propio.

### Paso 3 — Poner la publishable key y la URL en `wrangler.toml`

Edita [`wrangler.toml`](wrangler.toml), sección `[vars]`:

```toml
[vars]
APP_BASE_URL = "https://active-calendar.TUSUB.workers.dev"
CLERK_PUBLISHABLE_KEY = "pk_test_xxxxxxxx"   # pega tu publishable key real
```

> Estas dos variables son públicas y se versionan en el repo. Lo que pongas aquí **sobrescribe** el dashboard en cada deploy, así que este archivo es la fuente de verdad para ellas.

Haz commit y push de ese cambio.

### Paso 4 — Desplegar el Worker

**Opción A — Dashboard de Cloudflare (lo más simple):**
1. **Workers & Pages → Create → Workers → Connect to Git** → selecciona el repo.
2. Cloudflare detecta `wrangler.toml` y despliega.

**Opción B — GitHub Actions (push = deploy):**
1. En Cloudflare: **My Profile → API Tokens → Create Token** → plantilla **"Edit Cloudflare Workers"** → copia el token.
2. **Account ID**: en **Workers & Pages**, columna derecha.
3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. `git push` a `main` → el workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) corre `tsc` y `wrangler deploy`.

### Paso 5 — Cargar los 3 secrets en el Worker

En **Workers & Pages → active-calendar → Settings → Variables and Secrets** añade (tipo **Secret**):

| Nombre | Valor |
|---|---|
| `CLERK_SECRET_KEY` | la `sk_...` de Clerk |
| `SUPABASE_URL` | el Project URL de Supabase |
| `SUPABASE_SERVICE_KEY` | la service_role key de Supabase |

> Con `wrangler` local sería: `npx wrangler secret put CLERK_SECRET_KEY` (y los otros dos).

### Paso 6 — Ajustar la URL final

Cuando tengas la URL real del Worker:
- Confirma que `APP_BASE_URL` y la publishable key en `wrangler.toml` son correctas (redeploy si las cambiaste).
- En **Clerk dashboard**, añade esa URL como dominio/origen permitido del frontend.

### Paso 7 — Probar

1. Abre la URL del Worker.
2. Inicia sesión con Clerk.
3. Pega tu URL iCal en el onboarding → **Guardar y sincronizar**.
4. Explora las secciones, marca tareas, cambia el color de acento.

### Paso 8 — Compartir con tus amigos

Dales la URL. Cada quien crea su cuenta con Clerk y pega su propio iCal. Sus datos quedan aislados por su `user_id` de Clerk.

---

## Cron triggers

| Cron UTC     | Hora SDQ | Qué hace                                    |
|--------------|----------|----------------------------------------------|
| `0 11 * * *` | 07:00    | Refresca tareas de la semana de todos        |
| `0 15 * * *` | 11:00    | Refresca tareas de la semana de todos        |
| `0 23 * * *` | 19:00    | Refresca tareas de la semana de todos        |

El cron preserva el `status` que cada usuario marcó a mano.

## Endpoints

- `GET /` — SPA.
- `GET /api/me` — perfil + tareas de la semana (crea el perfil si no existe).
- `POST /api/profile` — actualiza nombre / iCal / acento.
- `POST /api/task` — `{ uid, status }`.
- `POST /api/sync` — refresca el iCal del usuario al momento.
- `GET /api/health` — `{ ok: true }`.

Todas (salvo `/` y `/api/health`) exigen `Authorization: Bearer <token de Clerk>`.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars   # rellena CLERK_SECRET_KEY, SUPABASE_*, CLERK_PUBLISHABLE_KEY
npm run dev                       # http://localhost:8787
npm run typecheck
```

## Roadmap

- **v1 (actual)**: login Clerk, dashboard con secciones, materias, filtros, personalización, sync manual + cron.
- **v2**: notificaciones — empezamos por email digest y luego **WhatsApp** (Cloud API de Meta) como canal principal de avisos.
- **v3**: exportar pendientes como `.ics`.

---

## Qué debes hacer **tú** manualmente (resumen)

1. Crear proyecto **Supabase** + correr [`schema.sql`](schema.sql). Copiar Project URL y service_role key.
2. Crear app en **Clerk**. Copiar publishable (`pk_`) y secret (`sk_`) keys.
3. Pegar `APP_BASE_URL` y `CLERK_PUBLISHABLE_KEY` en [`wrangler.toml`](wrangler.toml) y hacer push.
4. Desplegar el Worker (dashboard de Cloudflare o GitHub Actions con sus 2 secrets).
5. Cargar en el Worker los 3 secrets: `CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
6. Añadir la URL del Worker como origen permitido en Clerk.
7. Abrir la URL, login, pegar tu iCal, compartir.
