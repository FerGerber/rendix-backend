import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  const { data, error } = await environmentClient
    .from("accounting_accounts")
    .select(
      "id, numero_cuenta, denominacion, tipo_cuenta, criterio_asociacion, is_default, is_active"
    )
    .eq("company_id", company.remote_company_id)
    .order("numero_cuenta", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Error cargando cuentas contables: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, accounts: data || [] });
}

const ACCOUNT_SELECT =
  "id, numero_cuenta, denominacion, tipo_cuenta, criterio_asociacion, is_default, is_active";

// Alta puntual de una cuenta (fuera de la carga masiva), para no obligar
// a armar un CSV por un alta suelta.
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  let body: {
    numero_cuenta?: unknown;
    denominacion?: unknown;
    tipo_cuenta?: unknown;
    criterio_asociacion?: unknown;
    is_default?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const numeroCuenta =
    typeof body.numero_cuenta === "string" ? body.numero_cuenta.trim() : "";
  if (!numeroCuenta) {
    return NextResponse.json(
      { success: false, error: "El número de cuenta es obligatorio." },
      { status: 400 }
    );
  }

  const denominacion =
    typeof body.denominacion === "string" ? body.denominacion.trim() : "";
  if (!denominacion) {
    return NextResponse.json(
      { success: false, error: "La denominación es obligatoria." },
      { status: 400 }
    );
  }

  const tipoCuenta =
    typeof body.tipo_cuenta === "string" && body.tipo_cuenta.trim()
      ? body.tipo_cuenta.trim()
      : null;
  const criterioAsociacion =
    typeof body.criterio_asociacion === "string" &&
    body.criterio_asociacion.trim()
      ? body.criterio_asociacion.trim()
      : null;
  const isDefault = body.is_default === true;

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  const { data: existingRow, error: existingError } = await environmentClient
    .from("accounting_accounts")
    .select("id")
    .eq("company_id", company.remote_company_id)
    .eq("numero_cuenta", numeroCuenta)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { success: false, error: "No se pudo verificar si la cuenta ya existe." },
      { status: 500 }
    );
  }

  if (existingRow) {
    return NextResponse.json(
      {
        success: false,
        error: `Ya existe una cuenta con el número "${numeroCuenta}" en esta empresa.`,
      },
      { status: 409 }
    );
  }

  const { data: newAccount, error: insertError } = await environmentClient
    .from("accounting_accounts")
    .insert({
      company_id: company.remote_company_id,
      numero_cuenta: numeroCuenta,
      denominacion,
      tipo_cuenta: tipoCuenta,
      criterio_asociacion: criterioAsociacion,
      is_default: isDefault,
      is_active: true,
    })
    .select(ACCOUNT_SELECT)
    .single();

  if (insertError || !newAccount) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo crear la cuenta: ${
          insertError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  // Igual que en la carga masiva y en la edición: si esta cuenta nace
  // como default, hay que desmarcar cualquier otra a mano.
  if (isDefault) {
    const { error: clearError } = await environmentClient
      .from("accounting_accounts")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("company_id", company.remote_company_id)
      .neq("id", newAccount.id);

    if (clearError) {
      console.error(
        "No se pudo desmarcar la cuenta default anterior:",
        clearError
      );
    }
  }

  return NextResponse.json({ success: true, account: newAccount });
}
