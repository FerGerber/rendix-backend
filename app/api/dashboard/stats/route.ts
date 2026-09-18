import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCurrentMonthSnapshot,
  getCompanyUserCounts,
} from "@/lib/api/companyStats";
import {
  RENDIX_CLIENT_ENVIRONMENT_LABELS,
  type RendixClientEnvironment,
} from "@/lib/environments";

// Dashboard general de referencia para facturación (ver Backlog de
// Rendix): cantidad de empresas, usuarios totales y activos en conjunto, y
// el detalle por empresa para poder ubicar a cada una en su rango de
// precio. De paso, cada carga de esta pantalla deja una foto mensual
// guardada por empresa (ver ensureCurrentMonthSnapshot) — es la forma más
// simple de tener ese respaldo sin un cron aparte, ya que esta backend
// corre solo local.
export async function GET(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { data: companies, error } = await supabaseAdmin
    .from("client_companies")
    .select("id, environment, remote_company_id, name, is_active")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: `Error cargando empresas: ${error.message}` },
      { status: 500 }
    );
  }

  const companiesList = companies || [];

  const perCompany = await Promise.all(
    companiesList.map(async (company) => {
      const counts = await getCompanyUserCounts({
        environment: company.environment as RendixClientEnvironment,
        remote_company_id: company.remote_company_id,
      });

      if (counts) {
        // Fire-and-forget a propósito: no tiene sentido que guardar la
        // foto retrase la respuesta del dashboard si tarda un poco: si
        // falla, solo queda logueado y se reintenta en la próxima carga.
        void ensureCurrentMonthSnapshot(company.id, counts);
      }

      return {
        id: company.id,
        name: company.name,
        environment: company.environment,
        environment_label:
          RENDIX_CLIENT_ENVIRONMENT_LABELS[
            company.environment as RendixClientEnvironment
          ] ?? company.environment,
        is_active: company.is_active,
        users_total: counts?.users_total ?? null,
        users_active: counts?.users_active ?? null,
        environment_configured: counts !== null,
      };
    })
  );

  const companiesActive = companiesList.filter((c) => c.is_active).length;
  const usersTotal = perCompany.reduce(
    (sum, c) => sum + (c.users_total ?? 0),
    0
  );
  const usersActive = perCompany.reduce(
    (sum, c) => sum + (c.users_active ?? 0),
    0
  );
  const environmentsPending = perCompany.some(
    (c) => !c.environment_configured
  );

  return NextResponse.json({
    success: true,
    companies: {
      total: companiesList.length,
      active: companiesActive,
      inactive: companiesList.length - companiesActive,
    },
    users: {
      total: usersTotal,
      active: usersActive,
    },
    companies_detail: perCompany,
    // Avisa en la UI, sin bloquear nada, que el total de usuarios no
    // incluye a las empresas cuyo entorno todavía no tiene credenciales
    // cargadas (hoy: production/presales/testing) — para que "usuarios
    // totales" no se lea como una cifra más completa de lo que es.
    environments_pending: environmentsPending,
  });
}
