import { NextResponse } from "next/server";

// Autenticación servicio-a-servicio para los endpoints públicos que llama
// rendi-platform (nunca el browser directo) para crear/leer tickets de
// soporte propios. Un secreto compartido simple alcanza acá: es tráfico
// entre dos apps que controlamos nosotros, no un cliente externo — mismo
// nivel de confianza que ya existe entre esta backend y los Supabase de
// cada entorno cliente (credenciales de servicio, nunca expuestas al
// browser). El secreto se configura como SUPPORT_SERVICE_SECRET, con el
// mismo valor en las variables de entorno de rendix-backend y de
// rendi-platform.
export function requireSupportServiceSecret(
  request: Request
): { response: NextResponse } | null {
  const provided = request.headers.get("x-rendix-support-secret");
  const expected = process.env.SUPPORT_SERVICE_SECRET?.trim();

  if (!expected) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error:
            "SUPPORT_SERVICE_SECRET no está configurado en esta backend.",
        },
        { status: 500 }
      ),
    };
  }

  if (!provided || provided !== expected) {
    return {
      response: NextResponse.json(
        { success: false, error: "Autenticación de servicio inválida." },
        { status: 401 }
      ),
    };
  }

  return null;
}
