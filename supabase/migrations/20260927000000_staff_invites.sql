-- Habilita invitar gente nueva al equipo por mail, antes de que se
-- loguee por primera vez con Google. Hoy staff_users.id es la primary key
-- y referencia auth.users(id) — pero ese id recién existe después del
-- primer login, así que no se podía insertar una fila "pendiente" solo
-- con el mail. Se cambia a una primary key propia (staff_id) y se deja id
-- como columna nullable + unique (sigue sirviendo para las FKs que ya
-- referencian staff_users(id) desde client_companies.created_by y
-- support_ticket_messages.sender_staff_id). El mail pasa a ser único
-- (case-insensitive) para poder buscar por ahí antes de tener id. El link
-- real (completar id) pasa en requireActiveStaff la primera vez que esa
-- persona se loguea con Google — ver lib/api/auth.ts.
--
-- Se agrega también can_manage_staff: solo quien lo tenga puede invitar o
-- desactivar gente desde la pantalla de Equipo. Se activa automáticamente
-- para cualquier fila ya existente (hoy, Fernando) para no perder acceso
-- a la nueva pantalla apenas se corra esta migración.
--
-- Las dos FKs de arriba dependen del índice que respalda staff_users_pkey,
-- así que hay que soltarlas antes de poder soltar esa primary key, y
-- recrearlas después apuntando al nuevo unique constraint sobre id
-- (staff_users_id_key). Quedan con el mismo comportamiento que tenían
-- (ninguna tenía on delete/on update explícito).
alter table public.client_companies
  drop constraint client_companies_created_by_fkey;

alter table public.support_ticket_messages
  drop constraint support_ticket_messages_sender_staff_id_fkey;

alter table public.staff_users drop constraint staff_users_pkey;

alter table public.staff_users
  add column staff_id uuid not null default gen_random_uuid() primary key;

alter table public.staff_users
  alter column id drop not null;

alter table public.staff_users
  add constraint staff_users_id_key unique (id);

create unique index staff_users_lower_email_idx
  on public.staff_users (lower(email));

alter table public.staff_users
  add column can_manage_staff boolean not null default false;

update public.staff_users set can_manage_staff = true;

alter table public.staff_users
  add column invited_by uuid references auth.users(id),
  add column invited_at timestamptz;

alter table public.client_companies
  add constraint client_companies_created_by_fkey
  foreign key (created_by) references public.staff_users(id);

alter table public.support_ticket_messages
  add constraint support_ticket_messages_sender_staff_id_fkey
  foreign key (sender_staff_id) references public.staff_users(id);
