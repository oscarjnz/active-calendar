-- Esquema de Supabase para Active Calendar Tracker (web app multi-tenant).
-- Ejecutar tal cual en el SQL editor del proyecto Supabase.

-- Perfil por usuario autenticado.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  ical_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tareas extraidas del feed de cada usuario.
create table if not exists tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  uid text not null,
  summary text not null,
  course text,
  due timestamptz,
  url text,
  status text not null default 'pending' check (status in ('pending','done')),
  last_modified timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, uid)
);

create index if not exists idx_tasks_user_due on tasks(user_id, due);

-- Row Level Security: cada usuario solo ve y modifica lo suyo desde el cliente.
-- El Worker usa la service_role key (bypass RLS) para sincronizar el iCal.
alter table profiles enable row level security;
alter table tasks enable row level security;

drop policy if exists "own profile select" on profiles;
drop policy if exists "own profile insert" on profiles;
drop policy if exists "own profile update" on profiles;
drop policy if exists "own tasks select" on tasks;
drop policy if exists "own tasks update" on tasks;

create policy "own profile select" on profiles
  for select using (auth.uid() = user_id);

create policy "own profile insert" on profiles
  for insert with check (auth.uid() = user_id);

create policy "own profile update" on profiles
  for update using (auth.uid() = user_id);

create policy "own tasks select" on tasks
  for select using (auth.uid() = user_id);

-- El usuario solo puede cambiar el campo status; el resto lo mantiene el Worker.
-- A nivel de RLS permitimos update; en el cliente solo actualizaremos status.
create policy "own tasks update" on tasks
  for update using (auth.uid() = user_id);

-- Trigger para mantener updated_at en profiles.
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
