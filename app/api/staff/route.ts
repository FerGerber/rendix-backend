import { NextResponse } from "next/server";
import { requireActiveStaff, requireStaffManager } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Mismo patrón de validación que ya usa esta backend para invitar
// usuarios de una empresa cliente (ver app/api/companies/[id]/users/route.ts).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lista el equipo (staff_users) — cualquier staff activo puede verla,
// aunque solo quien tenga can_manage_staff puede invitar o
// activar/desactivar (ver requireStaffManager y el PATCH en [id]/route.ts).
export async function GET(request: Request) {
  const authorization = await requireActiveStaff(request);
  if ("response" in authorization) return authorization.response;

  const { data, error } = await supabaseAdmin
    .from("staff_users")
    .select(
      "staff_id, id, email, full_name, is_active, can_manage_staff, invited_at, created_at"
    )
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: `No se pudo cargar el equipo: ${error.message}` },
      { status: 500 }
    );
  }

  const staffRows = data || [];

  // Se junta acá el acceso por empresa de cada fila (una sola consulta
  // para todo el equipo, no una por persona) para que la pantalla de
  // Equipo pueda mostrar y editar las asignaciones sin otro round-trip.
  const { data: accessRows, error: accessError } = await supabaseAdmin
    .from("staff_company_access")
    .select("staff_id, company_id");

  if (accessError) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo cargar el acceso por empresa: ${accessError.message}`,
      },
      { status: 500 }
    );
  }

  const accessByStaffId = new Map<string, string[]>();
  for (const row of accessRows || []) {
    const list = accessByStaffId.get(row.staff_id) || [];
    list.push(row.company_id);
    accessByStaffId.set(row.staff_id, list);
  }

  const staff = staffRows.map((row) => ({
    ...row,
    company_access: accessByStaffId.get(row.staff_id) || [],
  }));

  return NextResponse.json({ success: true, staff });
}

// Invita a alguien nuevo por mail. Todavía no existe su cuenta de Auth
// (recién se crea la primera vez que se loguea con Google), así que acá
// solo se guarda una fila "pendiente" (id null) — requireActiveStaff la
// linkea sola en ese primer login. Si el mail ya estaba cargado (activo o
// desactivado antes), se reactiva esa misma fila en vez de duplicarla.
export async function POST(request: Request) {
  const authorization = await requireStaffManager(request);
  if ("response" in authorization) return authorization.response;

  let body: { email?: unknown; full_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName =
    typeof body.full_name === "string" && body.full_name.trim()
      ? body.full_name.trim()
      : null;

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { success: false, error: "Ingresá un mail válido." },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("staff_users")
    .select("staff_id, is_active")
    .eq("email", email)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo verificar el mail: ${existingError.message}`,
      },
      { status: 500 }
    );
  }

  if (existing?.is_active) {
    return NextResponse.json(
      { success: false, error: "Ese mail ya está activo en el equipo." },
      { status: 409 }
    );
  }

  const invite = {
    email,
    full_name: fullName,
    is_active: true,
    can_manage_staff: false,
    invited_by: authorization.staff.id,
    invited_at: new Date().toISOString(),
  };

  const { data: staffRow, error } = existing
    ? await supabaseAdmin
        .from("staff_users")
        .update(invite)
        .eq("staff_id", existing.staff_id)
        .select(
          "staff_id, id, email, full_name, is_active, can_manage_staff"
        )
        .single()
    : await supabaseAdmin
        .from("staff_users")
        .insert(invite)
        .select(
          "staff_id, id, email, full_name, is_active, can_manage_staff"
        )
        .single();

  if (error || !staffRow) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo invitar a la persona: ${
          error?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, staff: staffRow });
}
