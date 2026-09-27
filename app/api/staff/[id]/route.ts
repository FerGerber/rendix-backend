import { NextResponse } from "next/server";
import { requireStaffManager } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// La cuenta del dueño de la aplicación: nadie —ni siquiera otra persona
// con can_manage_staff, y ni siquiera el propio Fernando— puede
// desactivarla, sacarle el permiso de gestión, ni eliminarla. Sin esto,
// cualquier otro manager podría dejarlo afuera de su propia backend. Es
// una protección aparte del chequeo de "no podés tocarte a vos mismo" de
// más abajo: esa es para cualquiera, esta es específica de esta cuenta,
// la toque quien la toque.
const PROTECTED_OWNER_EMAIL = "fernando.gerber1@gmail.com";

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

  const { data: target, error: targetError } = await supabaseAdmin
    .from("staff_users")
    .select("staff_id, email")
    .eq("staff_id", staffId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json(
      { success: false, error: "No se encontró a esa persona." },
      { status: 404 }
    );
  }

  const isSelf = target.staff_id === authorization.staff.staff_id;
  const isProtectedOwner =
    target.email.toLowerCase() === PROTECTED_OWNER_EMAIL;

  // Nadie puede desactivarse ni sacarse a sí mismo el permiso de gestión
  // desde acá — evita que el equipo se quede sin nadie que pueda
  // revertirlo. Y nadie puede hacerle esto a la cuenta del dueño de la
  // aplicación, la toque quien la toque (ver PROTECTED_OWNER_EMAIL).
  if (isSelf || isProtectedOwner) {
    if (updates.is_active === false) {
      return NextResponse.json(
        {
          success: false,
          error: isSelf
            ? "No podés desactivar tu propia cuenta."
            : "Esta cuenta no se puede desactivar.",
        },
        { status: 400 }
      );
    }
    if (updates.can_manage_staff === false) {
      return NextResponse.json(
        {
          success: false,
          error: isSelf
            ? "No podés sacarte tu propio permiso de gestión."
            : "No se le puede sacar el permiso de gestión a esta cuenta.",
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

// Elimina de verdad la fila (no es lo mismo que desactivar). Nadie puede
// eliminarse a sí mismo — ver el mismo motivo que en PATCH. Si esa
// persona ya creó empresas o mandó mensajes de soporte, esas filas siguen
// apuntando a su staff_users.id (client_companies.created_by,
// support_ticket_messages.sender_staff_id) y Postgres rechaza el borrado
// para no perder esa trazabilidad — en ese caso se le sugiere desactivar
// en vez de eliminar.
export async function DELETE(request: Request, { params }: RouteParams) {
  const authorization = await requireStaffManager(request);
  if ("response" in authorization) return authorization.response;

  const { id: staffId } = await params;

  const { data: target, error: targetError } = await supabaseAdmin
    .from("staff_users")
    .select("staff_id, email")
    .eq("staff_id", staffId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json(
      { success: false, error: "No se encontró a esa persona." },
      { status: 404 }
    );
  }

  if (target.staff_id === authorization.staff.staff_id) {
    return NextResponse.json(
      { success: false, error: "No podés eliminar tu propia cuenta." },
      { status: 400 }
    );
  }

  if (target.email.toLowerCase() === PROTECTED_OWNER_EMAIL) {
    return NextResponse.json(
      { success: false, error: "Esta cuenta no se puede eliminar." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("staff_users")
    .delete()
    .eq("staff_id", staffId);

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede eliminar: esta persona tiene empresas o mensajes de soporte asociados (se perdería esa trazabilidad). Desactivala en su lugar.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: `No se pudo eliminar: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
