-- Agrega el país a la copia liviana del registro interno de empresas
-- (client_companies), igual que companies.country_code en cada entorno
-- cliente (rendi-platform). El valor de verdad vive en el entorno cliente;
-- acá se guarda para listar sin consultar cada entorno. Código ISO 3166-1
-- de 2 letras en mayúsculas; por defecto 'AR' porque hoy todas las
-- empresas son argentinas.

alter table public.client_companies
  add column if not exists country_code text not null default 'AR';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_companies_country_code_format_check'
      and conrelid = 'public.client_companies'::regclass
  ) then
    alter table public.client_companies
      add constraint client_companies_country_code_format_check
      check (country_code ~ '^[A-Z]{2}$');
  end if;
end
$$;
