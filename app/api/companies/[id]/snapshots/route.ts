import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany } from "@/lib/api/companies";
import { getRecentSnapshots } from "@/lib/api/companyStats";

type RouteParams = { params: Promise<{ id: string }> };

// Historial de fotos mensuales de usuarios de una empresa (ver
// company_user_snapshots) — referencia de a qué rango de precio
// correspondió facturarle en cada mes, sin depender de mirar el conteo en
// vivo justo el día de facturar.
export async function GET(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  const snapshots = await getRecentSnapshots(id);

  return NextResponse.json({ success: true, snapshots });
}
