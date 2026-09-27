import { NextResponse } from "next/server";
import { requireStaffManager } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// El "id" de esta ruta es staff_id (la primary key propia de staff_users),
// no el id de auth.users — así funciona también para una fila todavía
// pendiente (invitada por mail, sin login todavía). Ver la migración
// 20260927000000_staff_invites.sql.
export async function PATCH(request: Request, { params }: RouteParams) {
  const authorization = await requireStaffManager(request);
  if ("response" in authorization) return authorization.response;

  const { id: staffId } = await params;

  let body: { is_active?: unknown; can_manage_staff?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const updates: Record<string, boolean> = {};
  if (typeof body.is_active === "boolean") {
    updates.is_active = body.is_active;
  }
  if (typeof body.can_manage_staff === "boolean") {
    updates.can_manage_staff = body.can_manage_staff;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, error: "No hay cambios para guardar." },
      { status: 400 }
    );
  }

  // Nadie puede desactivarse ni sacarse a sí mismo el permiso de gestión
  // desde acá — evita que el equipo se quede sin nadie que pueda
  // revertirlo. (Otro manager sí puede hacerle esto a esta cuenta.)
  if (staffId === authorization.staff.staff_id) {
    if (updates.is_active === false) {
      return NextResponse.json(
        { success: false, error: "No podés desactivar tu propia cuenta." },
        { status: 400 }
      );
    }
    if (updates.can_manage_staff === false) {
      return NextResponse.json(
        {
          success: false,
          error: "No podés sacarte tu propio permiso de gestión.",
        },
        { status: 400 }
      );
    }
  }

  const { data: updatedRow, error } = await supabaseAdmin
    .from("staff_users")
    .update(updates)
    .eq("staff_id", staffId)
    .select(
      "staff_id, id, email, full_name, is_active, can_manage_staff, invited_at, created_at"
    )
    .single();

  if (error || !updatedRow) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo actualizar: ${error?.message || "error desconocido"}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, staff: updatedRow });
}
