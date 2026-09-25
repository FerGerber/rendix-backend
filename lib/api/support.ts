import { supabaseAdmin } from "@/lib/supabase/admin";

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
