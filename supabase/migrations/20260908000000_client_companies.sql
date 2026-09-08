-- Registro interno (staff) de todas las empresas cliente de Rendix, sin
-- importar en qué entorno de Supabase viven. Existe para que esta backend
-- pueda listar/administrar empresas con una sola consulta a su propio
-- proyecto, en lugar de tener que consultar los 4 proyectos de entornos
-- cliente cada vez. La fila "real" de la empresa vive en la tabla
-- companies del proyecto de Supabase del entorno elegido
-- (remote_company_id apunta a ese id); acá solo se guarda una copia
-- liviana para listar y un puntero a dónde está la fuente de verdad.
create table if not exists public.client_companies (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  remote_company_id uuid not null,
  name text not null,
  tax_id text,
  base_currency text not null default 'ARS',
  is_active boolean not null default true,
  created_by uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_companies_environment_check
    check (environment in ('production', 'presales', 'testing', 'development')),
  constraint client_companies_unique_remote
    unique (environment, remote_company_id)
);

alter table public.client_companies enable row level security;

-- A propósito, sin políticas para anon/authenticated: toda la lectura y
-- escritura pasa por las rutas /api de esta backend, que validan contra
-- staff_users y después usan la service role key (que bypassa RLS). No
-- hace falta que el browser lea esta tabla directo, igual que ya pasa con
-- las credenciales de servicio de cada entorno cliente.
