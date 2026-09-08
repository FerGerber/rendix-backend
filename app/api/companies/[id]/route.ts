import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getEnvironmentServiceClient,
  EnvironmentNotConfiguredError,
} from "@/lib/supabase/environments-server";
import type { RendixClientEnvironment } from "@/lib/environments";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("client_companies")
    .select(
      "id, environment, remote_company_id, name, tax_id, base_currency, is_active, created_at"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, company: data });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("client_companies")
    .select("id, environment, remote_company_id")
    .eq("id", id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  let body: {
    name?: unknown;
    tax_id?: unknown;
    base_currency?: unknown;
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

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (body.tax_id === null || typeof body.tax_id === "string") {
    updates.tax_id =
      typeof body.tax_id === "string" && body.tax_id.trim()
        ? body.tax_id.trim()
        : null;
  }
  if (typeof body.base_currency === "string" && body.base_currency.trim()) {
    updates.base_currency = body.base_currency.trim().toUpperCase();
  }
  if (typeof body.is_active === "boolean") {
    updates.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, error: "No hay cambios para guardar." },
      { status: 400 }
    );
  }

  let environmentClient;
  try {
    environmentClient = getEnvironmentServiceClient(
      existing.environment as RendixClientEnvironment
    );
  } catch (error) {
    if (error instanceof EnvironmentNotConfiguredError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }

  // Se actualiza primero la fuente de verdad (la tabla companies del
  // entorno cliente) y recién si eso sale bien se actualiza el registro
  // interno — así el registro nunca queda mostrando algo distinto de lo
  // que realmente hay en el entorno cliente.
  const { error: remoteError } = await environmentClient
    .from("companies")
    .update(updates)
    .eq("id", existing.remote_company_id);

  if (remoteError) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo actualizar la empresa en el entorno "${existing.environment}": ${remoteError.message}`,
      },
      { status: 500 }
    );
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from("client_companies")
    .update(updates)
    .eq("id", id)
    .select(
      "id, environment, remote_company_id, name, tax_id, base_currency, is_active, created_at"
    )
    .single();

  if (updateError || !updatedRow) {
    return NextResponse.json(
      {
        success: false,
        error: `Se actualizó en el entorno "${existing.environment}" pero no se pudo actualizar el registro interno: ${
          updateError?.message || "error desconocido"
        }. Contactá a un administrador.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, company: updatedRow });
}
