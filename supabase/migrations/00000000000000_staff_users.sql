-- Esta tabla vive en el proyecto de Supabase PROPIO de esta backend interna
-- (no en los proyectos de Rendix cliente). Es el control de autorización
-- real: el login con Google (restringido por "hd" a tu dominio de
-- Workspace) solo autentica; esta tabla decide quién puede efectivamente
-- entrar al dashboard, igual que la tabla profiles hace del lado cliente.
create table if not exists public.staff_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;

-- Un miembro del staff puede leer su propia fila (para que el dashboard
-- pueda chequear is_active). Las altas/bajas de staff_users se hacen a
-- mano vía el SQL Editor de Supabase por ahora — es un equipo chico y de
-- bajo volumen; no amerita una pantalla de auto-gestión todavía.
create policy "El staff puede leer su propia fila"
  on public.staff_users
  for select
  using (auth.uid() = id);
