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

// Lista las empresas que existen en la tabla companies de un entorno
// cliente pero todavía NO tienen fila en el registro interno
// client_companies — son las que se dieron de alta antes de que existiera
// esta backend (o por afuera de ella) y hay que "importar" para poder
// administrarlas desde acá.
export async function GET(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const environmentParam = url.searchParams.get("environment");

  if (!isValidEnvironment(environmentParam)) {
    return NextResponse.json(
      { success: false, error: "El entorno indicado no es válido." },
      { status: 400 }
    );
  }

  const environment = environmentParam;

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

  const [remoteResult, registeredResult] = await Promise.all([
    environmentClient
      .from("companies")
      .select("id, name, tax_id, base_currency, is_active")
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("client_companies")
      .select("remote_company_id")
      .eq("environment", environment),
  ]);

  if (remoteResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudieron leer las empresas del entorno "${environment}": ${remoteResult.error.message}`,
      },
      { status: 500 }
    );
  }

  if (registeredResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: `Error consultando el registro interno: ${registeredResult.error.message}`,
      },
      { status: 500 }
    );
  }

  const registeredIds = new Set(
    (registeredResult.data || []).map((row) => row.remote_company_id)
  );
  const unregistered = (remoteResult.data || []).filter(
    (company) => !registeredIds.has(company.id)
  );

  return NextResponse.json({ success: true, companies: unregistered });
}
