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

export async function GET(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("client_companies")
    .select(
      "id, environment, remote_company_id, name, tax_id, base_currency, is_active, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: `Error cargando empresas: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, companies: data || [] });
}

export async function POST(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  let body: {
    name?: unknown;
    tax_id?: unknown;
    base_currency?: unknown;
    environment?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const taxId =
    typeof body.tax_id === "string" && body.tax_id.trim()
      ? body.tax_id.trim()
      : null;
  const baseCurrency =
    typeof body.base_currency === "string" && body.base_currency.trim()
      ? body.base_currency.trim().toUpperCase()
      : "ARS";

  if (!name) {
    return NextResponse.json(
      { success: false, error: "El nombre de la empresa es obligatorio." },
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
    .insert({ name, tax_id: taxId, base_currency: baseCurrency })
    .select("id")
    .single();

  if (remoteError || !remoteCompany) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo crear la empresa en el entorno "${environment}": ${
          remoteError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  const { data: registryRow, error: registryError } = await supabaseAdmin
    .from("client_companies")
    .insert({
      environment,
      remote_company_id: remoteCompany.id,
      name,
      tax_id: taxId,
      base_currency: baseCurrency,
      created_by: auth.staff.id,
    })
    .select(
      "id, environment, remote_company_id, name, tax_id, base_currency, is_active, created_at"
    )
    .single();

  if (registryError || !registryRow) {
    // La empresa YA se creó en el entorno cliente pero no pudimos guardar
    // el registro local. Se avisa explícitamente en vez de fallar en
    // silencio: si esto pasa queda una empresa "huérfana" del lado del
    // registro que un administrador va a tener que revisar a mano
    // (comparando contra la tabla companies del entorno indicado).
    return NextResponse.json(
      {
        success: false,
        error: `La empresa se creó en el entorno "${environment}" (id ${remoteCompany.id}) pero no se pudo guardar en el registro interno: ${
          registryError?.message || "error desconocido"
        }. Contactá a un administrador.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, company: registryRow });
}
