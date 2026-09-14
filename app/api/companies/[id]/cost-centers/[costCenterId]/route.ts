import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";

type RouteParams = { params: Promise<{ id: string; costCenterId: string }> };

const COST_CENTER_SELECT =
  "id, numero_centro_costo, nombre_centro_costo, is_active";

// Edición puntual de un centro de costo (fuera de la carga masiva). El
// número no se puede tocar acá por la misma razón que en cuentas
// contables: es la clave natural que usa el upload para hacer match.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id, costCenterId } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  let body: {
    nombre_centro_costo?: unknown;
    is_active?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};

  if (body.nombre_centro_costo !== undefined) {
    if (
      typeof body.nombre_centro_costo !== "string" ||
      !body.nombre_centro_costo.trim()
    ) {
      return NextResponse.json(
        { success: false, error: "El nombre no puede estar vacío." },
        { status: 400 }
      );
    }
    updates.nombre_centro_costo = body.nombre_centro_costo.trim();
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: "El estado del centro de costo no es válido.",
        },
        { status: 400 }
      );
    }
    updates.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, error: "No hay cambios para guardar." },
      { status: 400 }
    );
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  updates.updated_at = new Date().toISOString();

  const { data: updatedCostCenter, error: updateError } = await environmentClient
    .from("cost_centers")
    .update(updates)
    .eq("id", costCenterId)
    .eq("company_id", company.remote_company_id)
    .select(COST_CENTER_SELECT)
    .single();

  if (updateError || !updatedCostCenter) {
    return NextResponse.json(
      { success: false, error: "No se pudo actualizar el centro de costo." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, costCenter: updatedCostCenter });
}
