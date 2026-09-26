import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  SUPPORT_ATTACHMENT_ALLOWED_TYPES,
  SUPPORT_ATTACHMENT_MAX_BYTES,
} from "@/lib/support/constants";

export type ClientCompanyRef = { id: string; name: string };

// Resuelve la empresa REGISTRADA (client_companies) a partir del entorno +
// id real que rendi-platform ya conoce de su propio Supabase — el mismo
// par (environment, remote_company_id) que graba el alta de empresas
// (ver client_companies_unique_remote en la migración).
export async function resolveClientCompanyByRemoteId(
  environment: string,
  remoteCompanyId: string
): Promise<ClientCompanyRef | null> {
  const { data, error } = await supabaseAdmin
    .from("client_companies")
    .select("id, name")
    .eq("environment", environment)
    .eq("remote_company_id", remoteCompanyId)
    .single();

  if (error || !data) return null;
  return data;
}

// Direcciones del staff activo, para las notificaciones de "nuevo
// ticket"/"nuevo mensaje" — ver la propuesta "Sistema de soporte" del
// 2026-09-18.
export async function getActiveStaffEmails(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("email")
    .eq("is_active", true);

  return (data || []).map((row) => row.email).filter(Boolean);
}

// Adjuntos de soporte (la captura de pantalla que manda el cliente) — ver
// la migración 20260926000000_support_attachments_bucket.sql. Bucket
// privado: se sube y se lee siempre con la service role key, nunca con una
// URL pública fija.
const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hora, se regenera en cada lectura

export type SupportAttachmentInput = {
  data?: unknown; // base64, sin el prefijo "data:...;base64,"
  filename?: unknown;
  content_type?: unknown;
};

export type UploadedSupportAttachment = {
  attachment_url: string;
  attachment_filename: string;
};

function sanitizeAttachmentFilename(name: string): string {
  const trimmed = name.trim().slice(-120) || "adjunto";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Valida y sube un adjunto a ticketId/<uuid>-<nombre saneado>. Nunca tira
// excepción: si algo falla, devuelve el motivo en `error` y quien llama
// decide seguir sin adjunto en vez de romper la creación del ticket/mensaje
// (mismo criterio que sendEmail: un adjunto que falla no debería tirar
// abajo el resto de la operación).
export async function uploadSupportAttachment(
  ticketId: string,
  input: unknown
): Promise<{ attachment: UploadedSupportAttachment | null; error: string | null }> {
  if (!input || typeof input !== "object") {
    return { attachment: null, error: null };
  }

  const { data, filename, content_type } = input as SupportAttachmentInput;

  if (typeof data !== "string" || !data.trim()) {
    return { attachment: null, error: null };
  }

  if (typeof filename !== "string" || !filename.trim()) {
    return { attachment: null, error: "Falta el nombre del archivo adjunto." };
  }

  if (
    typeof content_type !== "string" ||
    !(SUPPORT_ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(
      content_type
    )
  ) {
    return {
      attachment: null,
      error: "El adjunto tiene que ser una imagen (PNG, JPG, WEBP o GIF).",
    };
  }

  // Por si llega como data URL completa ("data:image/png;base64,AAAA...")
  // en vez de solo el base64 — se acepta cualquiera de las dos formas.
  const base64 = data.includes(",") ? data.split(",").slice(1).join(",") : data;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { attachment: null, error: "El adjunto no es un archivo válido." };
  }

  if (buffer.length === 0) {
    return { attachment: null, error: "El adjunto no es un archivo válido." };
  }

  if (buffer.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return {
      attachment: null,
      error: `El adjunto supera el tamaño máximo permitido (${Math.floor(
        SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024)
      )} MB).`,
    };
  }

  const path = `${ticketId}/${crypto.randomUUID()}-${sanitizeAttachmentFilename(filename)}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .upload(path, buffer, { contentType: content_type, upsert: false });

  if (uploadError) {
    return {
      attachment: null,
      error: `No se pudo subir el adjunto: ${uploadError.message}`,
    };
  }

  return {
    attachment: { attachment_url: path, attachment_filename: filename },
    error: null,
  };
}

// Cambia el path interno guardado en attachment_url por una URL firmada de
// corta duración — nunca se persiste una URL firmada (expiraría), se
// genera de nuevo en cada lectura del hilo.
async function getSupportAttachmentSignedUrl(
  path: string | null
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Helper para las rutas GET de hilo: reemplaza attachment_url (el path
// interno) por la URL firmada en cada mensaje que tenga adjunto, así el
// frontend (staff o rendi-platform) puede usarlo directo como href/src.
export async function withSupportAttachmentUrls<
  T extends { attachment_url: string | null },
>(messages: T[]): Promise<T[]> {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      attachment_url: await getSupportAttachmentSignedUrl(message.attachment_url),
    }))
  );
}
