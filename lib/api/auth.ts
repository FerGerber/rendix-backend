import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Guarda server-side de esta backend, análoga a requireActiveProfile en
// rendi-platform: hoy la única verificación de staff_users era client-side
// (app/dashboard/page.tsx), lo cual sirve para la UI pero no protege
// ninguna ruta /api. Toda ruta que lea o escriba datos privilegiados (por
// ejemplo, usando las service role keys de los entornos cliente) tiene que
// pasar primero por acá.
export type AuthenticatedStaff = {
  id: string;
  email: string;
  full_name: string | null;
};

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

  const { data: staffData, error: staffError } = await supabaseAdmin
    .from("staff_users")
    .select("id, email, full_name, is_active")
    .eq("id", userData.user.id)
    .single();

  if (staffError || !staffData || !staffData.is_active) {
    return {
      response: NextResponse.json(
        { success: false, error: "Tu cuenta no está habilitada en staff_users." },
        { status: 403 }
      ),
    };
  }

  return {
    staff: {
      id: staffData.id,
      email: staffData.email,
      full_name: staffData.full_name,
    },
  };
}
