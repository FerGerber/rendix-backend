-- Bucket de Storage para los adjuntos de soporte (la captura de pantalla
-- que el cliente manda al crear un ticket o al responder uno propio) — ver
-- la propuesta "Sistema de soporte" del 2026-09-18, que dejaba esto para
-- una vuelta siguiente (las columnas attachment_url/attachment_filename ya
-- existían en support_ticket_messages desde la migración original).
--
-- Privado (public = false): nunca se sirve por URL pública fija, todas las
-- lecturas pasan por URLs firmadas de corta duración que genera esta
-- backend con la service role key (ver getSupportAttachmentSignedUrl en
-- lib/api/support.ts) — mismo criterio de "todo por service role" que el
-- resto del sistema de soporte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  3145728, -- 3 MB, mismo tope que valida la ruta /api antes de subir
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Storage usa RLS propio sobre storage.objects; como acá se sube y se lee
-- siempre con la service role key (nunca desde el browser ni con el token
-- del cliente), no hace falta ninguna política — mismo patrón que
-- support_tickets/support_ticket_messages, sin políticas para anon/authenticated.
