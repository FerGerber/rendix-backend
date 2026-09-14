import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

// Crea la fila de registro interno para una empresa que YA existe en el
// entorno cliente pero se dio de alta antes de que existiera esta backend
// (o por afuera de ella, como la que ya tenía Rendix en Desarrollo). No
// crea nada nuevo del lado del entorno cliente — solo engancha el registro
// a la fila real que ya está ahí.
export async function POST(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  let body: { environment?: unknown; remote_company_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  if (!isValidEnvironment(body.environment)) {
    return NextResponse.json(
      { success: false, error: "El entorno indicado no es válido." },
      { status: 400 }
    );
  }
  const environment = body.environment;

  if (typeof body.remote_company_id !== "string" || !body.remote_company_id) {
    return NextResponse.json(
      { success: false, error: "Falta el id de la empresa a importar." },
      { status: 400 }
    );
  }
  const remoteCompanyId = body.remote_company_id;

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

  const { data: remoteCompany, error: remoteError } = await environmentClient
    .from("companies")
    .select("id, name, tax_id, base_currency, is_active")
    .eq("id", remoteCompanyId)
    .single();

  if (remoteError || !remoteCompany) {
    return NextResponse.json(
      {
        success: false,
        error: `No se encontró esa empresa en el entorno "${environment}".`,
      },
      { status: 404 }
    );
  }

  const { data: registryRow, error: registryError } = await supabaseAdmin
    .from("client_companies")
    .insert({
      environment,
      remote_company_id: remoteCompany.id,
      name: remoteCompany.name,
      tax_id: remoteCompany.tax_id,
      base_currency: remoteCompany.base_currency,
      is_active: remoteCompany.is_active,
      created_by: auth.staff.id,
    })
    .select(
      "id, environment, remote_company_id, name, tax_id, base_currency, is_active, created_at"
    )
    .single();

  if (registryError || !registryRow) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo importar la empresa al registro interno: ${
          registryError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, company: registryRow });
}
