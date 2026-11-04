import { NextResponse } from "next/server";
import { requireStaffManager } from "@/lib/api/auth";
import {
  getEnvironmentServiceClient,
  EnvironmentNotConfiguredError,
} from "@/lib/supabase/environments-server";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  type RendixClientEnvironment,
} from "@/lib/environments";

function isValidEnvironment(value: unknown): value is RendixClientEnvironment {
  return (
    typeof value === "string" &&
    (RENDIX_CLIENT_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

const ACCOUNT_STATUSES = [
  "exists_active",
  "exists_inactive",
  "not_found",
  "unknown",
];
const METHODS = ["password", "google", "azure"];
const DAYS_OPTIONS = [1, 7, 30, 90];
const MAX_ROWS = 200;

// Intentos de ingreso fallidos de un entorno cliente (los registra
// /api/auth/login-attempt de rendi-platform). Incluye mails de personas de
// todas las empresas, por eso solo lo ve quien gestiona el equipo.
export async function GET(request: Request) {
  const auth = await requireStaffManager(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const environment = url.searchParams.get("environment") || "production";
  const emailFilter = (url.searchParams.get("email") || "").trim().toLowerCase();
  const statusFilter = url.searchParams.get("account_status");
  const methodFilter = url.searchParams.get("method");
  const days = Number(url.searchParams.get("days") || "7");

  if (!isValidEnvironment(environment)) {
    return NextResponse.json(
      { success: false, error: "El entorno indicado no es válido." },
      { status: 400 }
    );
  }
  if (statusFilter && !ACCOUNT_STATUSES.includes(statusFilter)) {
    return NextResponse.json(
      { success: false, error: "El estado de cuenta indicado no es válido." },
      { status: 400 }
    );
  }
  if (methodFilter && !METHODS.includes(methodFilter)) {
    return NextResponse.json(
      { success: false, error: "El método indicado no es válido." },
      { status: 400 }
    );
  }
  if (!DAYS_OPTIONS.includes(days)) {
    return NextResponse.json(
      { success: false, error: "El período indicado no es válido." },
      { status: 400 }
    );
  }

  let environmentClient;
  try {
    environmentClient = getEnvironmentServiceClient(environment);
  } catch (error) {
    if (error instanceof EnvironmentNotConfiguredError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = environmentClient
    .from("login_attempts")
    .select(
      "id, created_at, email, method, reason, account_status, company_id, ip, user_agent"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (statusFilter) query = query.eq("account_status", statusFilter);
  if (methodFilter) query = query.eq("method", methodFilter);
  if (emailFilter) {
    // Búsqueda "contiene", con los comodines de ilike escapados.
    const escaped = emailFilter.replace(/[\\%_]/g, (char) => `\\${char}`);
    query = query.ilike("email", `%${escaped}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "No se pudieron leer los intentos de ingreso de ese entorno. Puede que todavía no tenga la tabla creada.",
      },
      { status: 500 }
    );
  }

  const rows = data || [];
  const companyIds = Array.from(
    new Set(rows.map((row) => row.company_id).filter(Boolean))
  ) as string[];

  const companyNames = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await environmentClient
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    for (const company of companies || []) {
      companyNames.set(company.id as string, company.name as string);
    }
  }

  return NextResponse.json({
    success: true,
    truncated: rows.length >= MAX_ROWS,
    attempts: rows.map((row) => ({
      ...row,
      company_name: row.company_id
        ? companyNames.get(row.company_id as string) ?? null
        : null,
    })),
  });
}
