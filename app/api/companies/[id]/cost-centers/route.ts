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
    .from("cost_centers")
    .select("id, numero_centro_costo, nombre_centro_costo, is_active")
    .eq("company_id", company.remote_company_id)
    .order("numero_centro_costo", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Error cargando centros de costo: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, costCenters: data || [] });
}

const COST_CENTER_SELECT =
  "id, numero_centro_costo, nombre_centro_costo, is_active";

// Alta puntual de un centro de costo (fuera de la carga masiva), para no
// obligar a armar un CSV por un alta suelta.
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
    numero_centro_costo?: unknown;
    nombre_centro_costo?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const numeroCentroCosto =
    typeof body.numero_centro_costo === "string"
      ? body.numero_centro_costo.trim()
      : "";
  if (!numeroCentroCosto) {
    return NextResponse.json(
      { success: false, error: "El número de centro de costo es obligatorio." },
      { status: 400 }
    );
  }

  const nombreCentroCosto =
    typeof body.nombre_centro_costo === "string"
      ? body.nombre_centro_costo.trim()
      : "";
  if (!nombreCentroCosto) {
    return NextResponse.json(
      { success: false, error: "El nombre es obligatorio." },
      { status: 400 }
    );
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  const { data: existingRow, error: existingError } = await environmentClient
    .from("cost_centers")
    .select("id")
    .eq("company_id", company.remote_company_id)
    .eq("numero_centro_costo", numeroCentroCosto)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        error: "No se pudo verificar si el centro de costo ya existe.",
      },
      { status: 500 }
    );
  }

  if (existingRow) {
    return NextResponse.json(
      {
        success: false,
        error: `Ya existe un centro de costo con el número "${numeroCentroCosto}" en esta empresa.`,
      },
      { status: 409 }
    );
  }

  const { data: newCostCenter, error: insertError } = await environmentClient
    .from("cost_centers")
    .insert({
      company_id: company.remote_company_id,
      numero_centro_costo: numeroCentroCosto,
      nombre_centro_costo: nombreCentroCosto,
      is_active: true,
    })
    .select(COST_CENTER_SELECT)
    .single();

  if (insertError || !newCostCenter) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo crear el centro de costo: ${
          insertError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, costCenter: newCostCenter });
}
