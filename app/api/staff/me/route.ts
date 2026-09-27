import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";

// Devuelve el perfil de staff de la sesión actual. Reemplaza el query
// directo que hacía useStaffSession contra staff_users con el cliente
// anon (RLS solo dejaba leer la propia fila YA linkeada) — pasar por acá
// permite que, en el primer login de alguien invitado por mail, quede
// linkeado (ver requireActiveStaff) sin que la persona vea "acceso
// denegado" antes de que eso pase.
export async function GET(request: Request) {
  const authorization = await requireActiveStaff(request);
  if ("response" in authorization) return authorization.response;

  return NextResponse.json({ success: true, staff: authorization.staff });
}
