-- Segmentación de soporte por empresa: quien NO gestiona el equipo
-- (can_manage_staff = false) solo ve y puede tocar las empresas que
-- tenga asignadas acá (Empresas y Soporte, incluidos los sub-recursos
-- de una empresa: usuarios, cuentas contables, centros de costo). Quien
-- gestiona el equipo (hoy solo Fernando) sigue viendo todas las
-- empresas siempre, sin depender de esta tabla — ver canAccessCompany
-- en lib/api/auth.ts. Vacío para alguien = todavía no ve ninguna
-- empresa, no "ve todas por defecto".
create table if not exists public.staff_company_access (
  staff_id uuid not null references public.staff_users(staff_id) on delete cascade,
  company_id uuid not null references public.client_companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, company_id)
);

alter table public.staff_company_access enable row level security;

-- Mismo criterio que el resto de las tablas de esta backend: sin
-- políticas para anon/authenticated — todo pasa por /api con la service
-- role key.
