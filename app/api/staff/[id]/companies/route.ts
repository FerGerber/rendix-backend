import { NextResponse } from "next/server";
import { requireStaffManager } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reemplaza el conjunto completo de empresas a las que una persona del
// staff tiene acceso (ver staff_company_access y canAccessCompany en
// lib/api/auth.ts). Se manda la lista completa deseada en vez de
// altas/bajas sueltas porque así lo arma el checklist de la pantalla de
// Equipo — más simple que diffear a mano en el cliente.
//
// Asignarle empresas a alguien con can_manage_staff no rompe nada (esa
// persona ve todas igual, la lista queda ignorada), pero la pantalla de
// Equipo no ofrece este control para managers, justamente para no dar a
// entender que hace falta.
export async function PUT(request: Request, { params }: RouteParams) {
  const authorization = await requireStaffManager(request);
  if ("response" in authorization) return authorization.response;

  const { id: staffId } = await params;

  const { data: target, error: targetError } = await supabaseAdmin
    .from("staff_users")
    .select("staff_id")
    .eq("staff_id", staffId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json(
      { success: false, error: "No se encontró a esa persona." },
      { status: 404 }
    );
  }

  let body: { company_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.company_ids)) {
    return NextResponse.json(
      { success: false, error: "Falta la lista de empresas." },
      { status: 400 }
    );
  }

  const companyIds = Array.from(new Set(body.company_ids));
  const allValid = companyIds.every(
    (value) => typeof value === "string" && UUID_PATTERN.test(value)
  );
  if (!allValid) {
    return NextResponse.json(
      { success: false, error: "Alguna empresa de la lista no es válida." },
      { status: 400 }
    );
  }

  // Se reemplaza en dos pasos (no hay upsert masivo "poné exactamente
  // este conjunto" en supabase-js) — no hace falta una transacción real:
  // en el peor caso, un request concurrente sobre la MISMA persona pisa
  // al otro, nunca deja filas de otra persona a medio escribir.
  const { error: deleteError } = await supabaseAdmin
    .from("staff_company_access")
    .delete()
    .eq("staff_id", staffId);

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo actualizar el acceso: ${deleteError.message}`,
      },
      { status: 500 }
    );
  }

  if (companyIds.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("staff_company_access")
      .insert(companyIds.map((companyId) => ({ staff_id: staffId, company_id: companyId })));

    if (insertError) {
      return NextResponse.json(
        {
          success: false,
          error: `No se pudo guardar el acceso: ${insertError.message}`,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, company_ids: companyIds });
}
