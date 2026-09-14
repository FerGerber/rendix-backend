import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";

type RouteParams = { params: Promise<{ id: string; accountId: string }> };

const ACCOUNT_SELECT =
  "id, numero_cuenta, denominacion, tipo_cuenta, criterio_asociacion, is_default, is_active";

// Edición puntual de una cuenta (fuera de la carga masiva). El número de
// cuenta no se puede tocar acá: es la clave natural que usa el upload
// para hacer match, así que si está mal hay que desactivar la fila y
// cargar una nueva por archivo en vez de renombrarla.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id, accountId } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  let body: {
    denominacion?: unknown;
    tipo_cuenta?: unknown;
    criterio_asociacion?: unknown;
    is_default?: unknown;
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

  if (body.denominacion !== undefined) {
    if (typeof body.denominacion !== "string" || !body.denominacion.trim()) {
      return NextResponse.json(
        { success: false, error: "La denominación no puede estar vacía." },
        { status: 400 }
      );
    }
    updates.denominacion = body.denominacion.trim();
  }

  if (body.tipo_cuenta !== undefined) {
    updates.tipo_cuenta =
      typeof body.tipo_cuenta === "string" && body.tipo_cuenta.trim()
        ? body.tipo_cuenta.trim()
        : null;
  }

  if (body.criterio_asociacion !== undefined) {
    updates.criterio_asociacion =
      typeof body.criterio_asociacion === "string" &&
      body.criterio_asociacion.trim()
        ? body.criterio_asociacion.trim()
        : null;
  }

  if (body.is_default !== undefined) {
    if (typeof body.is_default !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: 'El valor de "cuenta por defecto" no es válido.',
        },
        { status: 400 }
      );
    }
    updates.is_default = body.is_default;
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { success: false, error: "El estado de la cuenta no es válido." },
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

  const { data: updatedAccount, error: updateError } = await environmentClient
    .from("accounting_accounts")
    .update(updates)
    .eq("id", accountId)
    .eq("company_id", company.remote_company_id)
    .select(ACCOUNT_SELECT)
    .single();

  if (updateError || !updatedAccount) {
    return NextResponse.json(
      { success: false, error: "No se pudo actualizar la cuenta contable." },
      { status: 500 }
    );
  }

  // No hay restricción en la base que garantice una sola cuenta default
  // por empresa (es una convención de aplicación) — si esta cuenta pasó
  // a ser la default, hay que desmarcar manualmente cualquier otra.
  if (updates.is_default === true) {
    const { error: clearError } = await environmentClient
      .from("accounting_accounts")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("company_id", company.remote_company_id)
      .neq("id", accountId);

    if (clearError) {
      console.error(
        "No se pudo desmarcar la cuenta default anterior:",
        clearError
      );
    }
  }

  return NextResponse.json({ success: true, account: updatedAccount });
}
