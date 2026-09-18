-- Foto mensual de la cantidad de usuarios por empresa. Existe para tener un
-- respaldo confiable de a qué rango de precio corresponde facturar cada mes
-- (ver Backlog de Rendix: cobro por rangos de usuarios) sin depender de
-- mirar el dashboard justo el día que se factura, cuando el conteo ya
-- pudo haber cambiado.
--
-- No hay un cron aparte armando esto (esta backend corre solo local, sin
-- deploy): se completa sola. Cada vez que alguien abre el dashboard
-- general o la ficha de una empresa y todavía no hay foto del mes en
-- curso para esa empresa, se guarda una con el conteo de ese momento (ver
-- ensureCurrentMonthSnapshot en lib/api/companyStats.ts). Si nadie abre
-- ninguna de las dos pantallas en todo un mes, ese mes queda sin foto —
-- aceptable por ahora, ya que las alertas/indicadores de pricing quedaron
-- explícitamente fuera de alcance por el momento.
create table if not exists public.company_user_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.client_companies(id) on delete cascade,
  snapshot_month date not null,
  users_total integer not null,
  users_active integer not null,
  captured_at timestamptz not null default now(),
  constraint company_user_snapshots_unique_month
    unique (company_id, snapshot_month)
);

alter table public.company_user_snapshots enable row level security;

-- Mismo criterio que client_companies: sin políticas para anon/authenticated,
-- toda la lectura y escritura pasa por las rutas /api de esta backend con
-- la service role key.
