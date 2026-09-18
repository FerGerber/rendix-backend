import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveEnvironmentClient } from "@/lib/api/companies";
import type { RendixClientEnvironment } from "@/lib/environments";

export type CompanyUserCounts = {
  users_total: number;
  users_active: number;
};

export type CompanyUserSnapshot = {
  snapshot_month: string;
  users_total: number;
  users_active: number;
};

// Cuenta usuarios (profiles) de una empresa en el proyecto de Supabase de su
// entorno. Devuelve null (en vez de tirar) cuando ese entorno todavía no
// tiene credenciales cargadas en esta backend, para que el dashboard
// general pueda seguir mostrando el resto de las empresas en vez de
// romperse entero por una sola sin configurar — hoy pasa con
// production/presales/testing, que todavía no existen (ver Backlog).
export async function getCompanyUserCounts(company: {
  environment: RendixClientEnvironment;
  remote_company_id: string;
}): Promise<CompanyUserCounts | null> {
  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return null;

  const { data, error } = await envResult.client
    .from("profiles")
    .select("is_active")
    .eq("company_id", company.remote_company_id);

  if (error || !data) return null;

  return {
    users_total: data.length,
    users_active: data.filter((row) => row.is_active).length,
  };
}

function currentSnapshotMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// Si todavía no hay una foto guardada del mes en curso para esta empresa,
// guarda una con el conteo actual. A propósito no pisa una foto que ya
// exista (ignoreDuplicates): lo que importa para facturar es tener AL
// MENOS una foto por mes, no la más reciente del mes — si se pisara con
// cada carga de pantalla, la foto del día de facturación podría terminar
// siendo la del día de facturación mismo, perdiendo el propósito de
// "respaldo" independiente del momento en que se mira.
export async function ensureCurrentMonthSnapshot(
  companyId: string,
  counts: CompanyUserCounts
): Promise<void> {
  const { error } = await supabaseAdmin.from("company_user_snapshots").upsert(
    {
      company_id: companyId,
      snapshot_month: currentSnapshotMonth(),
      users_total: counts.users_total,
      users_active: counts.users_active,
    },
    { onConflict: "company_id,snapshot_month", ignoreDuplicates: true }
  );

  if (error) {
    // No bloqueante: el dashboard/la ficha de empresa ya mostraron el
    // conteo en vivo, esto es solo el respaldo histórico.
    console.error("No se pudo guardar la foto mensual de usuarios:", error);
  }
}

export async function getRecentSnapshots(
  companyId: string,
  limit = 6
): Promise<CompanyUserSnapshot[]> {
  const { data, error } = await supabaseAdmin
    .from("company_user_snapshots")
    .select("snapshot_month, users_total, users_active")
    .eq("company_id", companyId)
    .order("snapshot_month", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("No se pudieron cargar las fotos mensuales:", error);
    return [];
  }

  return data || [];
}
