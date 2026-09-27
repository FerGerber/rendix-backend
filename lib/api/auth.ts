import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Guarda server-side de esta backend, análoga a requireActiveProfile en
// rendi-platform: hoy la única verificación de staff_users era client-side
// (app/dashboard/page.tsx), lo cual sirve para la UI pero no protege
// ninguna ruta /api. Toda ruta que lea o escriba datos privilegiados (por
// ejemplo, usando las service role keys de los entornos cliente) tiene que
// pasar primero por acá.
export type AuthenticatedStaff = {
  // staff_id: primary key propia de staff_users, estable desde el
  // momento de la invitación (aunque todavía no se haya logueado nadie).
  staff_id: string;
  // id: el id de auth.users — null hasta el primer login de esa persona.
  // Acá nunca llega null: si no hay id todavía, requireActiveStaff lo
  // completa (linkea) en el momento, ver más abajo.
  id: string;
  email: string;
  full_name: string | null;
  can_manage_staff: boolean;
};

type StaffRow = {
  staff_id: string;
  id: string | null;
  email: string;
  full_name: string | null;
  is_active: boolean;
  can_manage_staff: boolean;
};

const STAFF_COLUMNS =
  "staff_id, id, email, full_name, is_active, can_manage_staff";

export async function requireActiveStaff(
  request: Request
): Promise<{ staff: AuthenticatedStaff } | { response: NextResponse }> {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return {
      response: NextResponse.json(
        { success: false, error: "Autenticación requerida." },
        { status: 401 }
      ),
    };
  }

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(token);

  if (userError || !userData.user) {
    return {
      response: NextResponse.json(
        { success: false, error: "La sesión no es válida o expiró." },
        { status: 401 }
      ),
    };
  }

  const authUserId = userData.user.id;
  const authUserEmail = userData.user.email?.trim().toLowerCase() || "";

  const { data: staffData } = await supabaseAdmin
    .from("staff_users")
    .select(STAFF_COLUMNS)
    .eq("id", authUserId)
    .maybeSingle();

  let resolvedStaff = staffData as StaffRow | null;

  // Si no hay fila ya linkeada a este id, puede ser el primer login de
  // alguien invitado por mail (fila pendiente, id todavía null). Se busca
  // por mail y, si corresponde, se completa el id acá mismo — así queda
  // linkeada para siempre y las próximas veces entra directo por el path
  // de arriba. El filtro is("id", null) en el update evita una carrera si
  // dos requests llegan a la vez.
  if (!resolvedStaff && authUserEmail) {
    const { data: pendingData } = await supabaseAdmin
      .from("staff_users")
      .select(STAFF_COLUMNS)
      .is("id", null)
      .eq("email", authUserEmail)
      .maybeSingle();
    const pending = pendingData as StaffRow | null;

    if (pending && pending.is_active) {
      const googleFullName =
        (userData.user.user_metadata?.full_name as string | undefined) ||
        (userData.user.user_metadata?.name as string | undefined) ||
        null;

      const { data: linkedData } = await supabaseAdmin
        .from("staff_users")
        .update({
          id: authUserId,
          full_name: pending.full_name || googleFullName,
        })
        .eq("staff_id", pending.staff_id)
        .is("id", null)
        .select(STAFF_COLUMNS)
        .maybeSingle();

      resolvedStaff = (linkedData as StaffRow | null) || null;
    }
  }

  if (!resolvedStaff || !resolvedStaff.is_active) {
    return {
      response: NextResponse.json(
        { success: false, error: "Tu cuenta no está habilitada en staff_users." },
        { status: 403 }
      ),
    };
  }

  return {
    staff: {
      staff_id: resolvedStaff.staff_id,
      id: authUserId,
      email: resolvedStaff.email,
      full_name: resolvedStaff.full_name,
      can_manage_staff: resolvedStaff.can_manage_staff,
    },
  };
}

// Guarda adicional para las rutas de gestión de equipo (invitar,
// activar/desactivar): además de estar habilitado en staff_users, hace
// falta el flag can_manage_staff. Separado de requireActiveStaff para no
// exigir este permiso en el resto de las rutas (Empresas, Soporte, etc.)
// que cualquier staff activo ya puede usar hoy.
export async function requireStaffManager(
  request: Request
): Promise<{ staff: AuthenticatedStaff } | { response: NextResponse }> {
  const authorization = await requireActiveStaff(request);
  if ("response" in authorization) return authorization;

  if (!authorization.staff.can_manage_staff) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: "No tenés permiso para gestionar el equipo.",
        },
        { status: 403 }
      ),
    };
  }

  return authorization;
}
