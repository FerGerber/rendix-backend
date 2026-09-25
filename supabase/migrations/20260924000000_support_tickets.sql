-- Tickets de soporte que un usuario de rendi-platform crea desde el ícono
-- de soporte en PersistentAppShell. Centralizados acá (no en el Supabase
-- de cada entorno cliente) para poder armar una bandeja única de todos
-- los tickets sin consultar N proyectos por separado — ver la propuesta
-- "Sistema de soporte" del 2026-09-18. rendi-platform no tiene acceso
-- directo a esta base: llega acá a través de un endpoint nuevo de esta
-- backend (server-to-server, con un secreto compartido).
--
-- No hay FK real hacia profiles del cliente (vive en otro proyecto de
-- Supabase, uno por entorno) — remote_profile_id es solo un puntero, y
-- requester_name/requester_email quedan copiados acá al crear el ticket
-- para no depender de esa base para mostrar el remitente.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity,
  company_id uuid not null references public.client_companies(id),
  remote_profile_id uuid not null,
  requester_name text not null,
  requester_email text not null,
  category text not null,
  context_screen text,
  status text not null default 'abierto',
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_category_check
    check (category in ('rendicion', 'adelanto', 'acceso', 'otro')),
  constraint support_tickets_status_check
    check (status in ('abierto', 'en_progreso', 'resuelto')),
  constraint support_tickets_ticket_number_unique
    unique (ticket_number)
);

create index if not exists support_tickets_company_id_idx
  on public.support_tickets (company_id);
create index if not exists support_tickets_status_idx
  on public.support_tickets (status);
create index if not exists support_tickets_last_activity_idx
  on public.support_tickets (last_activity_at desc);

alter table public.support_tickets enable row level security;

-- Mismo criterio que client_companies y company_user_snapshots: sin
-- políticas para anon/authenticated. La ticketera del staff y el
-- endpoint nuevo para rendi-platform pasan los dos por rutas /api de
-- esta backend, con la service role key.

-- El hilo de mensajes de cada ticket: el mensaje inicial del usuario (el
-- "mensaje libre" del formulario) es la primera fila acá, no un campo
-- aparte en support_tickets, para no duplicar el modelo de hilo entre la
-- creación del ticket y las respuestas de seguimiento.
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null,
  sender_staff_id uuid references public.staff_users(id),
  sender_name text not null,
  body text not null,
  is_internal_note boolean not null default false,
  attachment_url text,
  attachment_filename text,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_sender_type_check
    check (sender_type in ('cliente', 'staff')),
  constraint support_ticket_messages_internal_note_only_staff
    check (not is_internal_note or sender_type = 'staff')
);

create index if not exists support_ticket_messages_ticket_id_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_ticket_messages enable row level security;

-- Mismo criterio: sin políticas para anon/authenticated, todo pasa por
-- rutas /api con la service role key.
