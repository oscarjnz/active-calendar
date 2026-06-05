-- Esquema de Supabase para Active Calendar (auth con Clerk).
-- IMPORTANTE: esto recrea las tablas. Como aún no hay datos reales, no pasa nada.
-- Ejecútalo completo en el SQL Editor de Supabase.

-- El user_id ahora es el ID de Clerk (texto, ej. "user_2abc..."), no un uuid de auth.users.
drop table if exists tasks cascade;
drop table if exists profiles cascade;
drop table if exists bb_tasks cascade;   -- limpieza de esquemas viejos
drop table if exists bb_meta cascade;

create table profiles (
  user_id text primary key,                 -- ID de Clerk
  display_name text,
  first_name text,
  last_name text,
  email text,
  avatar_url text,
  ical_url text,
  accent text not null default 'neutral',
  term int,                                 -- cuatrimestre/semestre actual (1-12)
  courses jsonb not null default '[]'::jsonb, -- materias: [{code,name}, ...]
  email_notify boolean not null default true, -- recibir recordatorio semanal por correo
  notify_dow int not null default 1,         -- día del envío (1=Lun..7=Dom)
  notify_time text not null default '07:00', -- hora local SDQ "HH:MM" del envío
  last_emailed timestamptz,                 -- último correo enviado (anti-duplicados)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tasks (
  user_id text not null references profiles(user_id) on delete cascade,
  uid text not null,
  summary text not null,
  course text,
  course_code text,                         -- materia asignada (manual o derivada)
  due timestamptz,
  url text,
  status text not null default 'pending' check (status in ('pending','done')),
  last_modified timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, uid)
);

create index if not exists idx_tasks_user_due on tasks(user_id, due);

-- RLS: solo el Worker (service_role) toca estas tablas. El navegador NUNCA habla
-- directo con Supabase, así que bloqueamos todo acceso anónimo/autenticado.
-- service_role siempre hace bypass de RLS, por eso no necesitamos políticas.
alter table profiles enable row level security;
alter table tasks enable row level security;

-- Trigger para updated_at en profiles.
create or replace function touch_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_touch on profiles;
create trigger trg_profiles_touch
  before update on profiles
  for each row execute function touch_profiles_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN para bases ya creadas (no destructiva). Si vas a ejecutar este
-- archivo completo sobre una base vacía, estas sentencias son redundantes pero
-- inofensivas. Si ya tienes datos en producción, ejecuta SOLO este bloque.
alter table profiles add column if not exists term int;
alter table profiles add column if not exists courses jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists email_notify boolean not null default true;
alter table profiles add column if not exists notify_dow int not null default 1;
alter table profiles add column if not exists notify_time text not null default '07:00';
alter table profiles add column if not exists last_emailed timestamptz;
alter table tasks add column if not exists course_code text;
