import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import { parseSpreadsheetFile } from "@/lib/catalogs/parseSpreadsheet";

type RouteParams = { params: Promise<{ id: string }> };

type ValidatedRow = {
  numero_centro_costo: string;
  nombre_centro_costo: string;
};

// Mismo criterio que la carga de cuentas contables: actualiza por
// numero_centro_costo, agrega los nuevos, y deja intactos los que no
// aparecen en el archivo.
export async function POST(request: Request, { params }: RouteParams) {
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "No se pudo leer el archivo enviado." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: "Falta el archivo a subir." },
      { status: 400 }
    );
  }

  let rows: Awaited<ReturnType<typeof parseSpreadsheetFile>>;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo leer el archivo: ${
          error instanceof Error ? error.message : "formato no reconocido"
        }`,
      },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: "El archivo no tiene filas para procesar." },
      { status: 400 }
    );
  }

  const validated: ValidatedRow[] = [];
  const errors: string[] = [];
  const seenNumbers = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const numero = row.numero_centro_costo || "";
    const nombre = row.nombre_centro_costo || "";

    if (!numero) {
      errors.push(`Fila ${rowNumber}: falta numero_centro_costo.`);
      return;
    }
    if (!nombre) {
      errors.push(`Fila ${rowNumber}: falta nombre_centro_costo.`);
      return;
    }
    if (seenNumbers.has(numero)) {
      errors.push(
        `Fila ${rowNumber}: numero_centro_costo "${numero}" está repetido en el archivo.`
      );
      return;
    }
    seenNumbers.add(numero);

    validated.push({
      numero_centro_costo: numero,
      nombre_centro_costo: nombre,
    });
  });

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: "El archivo tiene problemas, no se aplicó ningún cambio.",
        details: errors.slice(0, 30),
      },
      { status: 400 }
    );
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  const { data: existingRows, error: existingError } = await environmentClient
    .from("cost_centers")
    .select("id, numero_centro_costo")
    .eq("company_id", company.remote_company_id);

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo leer el catálogo actual: ${existingError.message}`,
      },
      { status: 500 }
    );
  }

  const existingByNumber = new Map(
    (existingRows || []).map((row) => [row.numero_centro_costo, row.id])
  );

  let updated = 0;
  let created = 0;
  const failures: string[] = [];

  for (const row of validated) {
    const existingId = existingByNumber.get(row.numero_centro_costo);

    if (existingId) {
      const { error } = await environmentClient
        .from("cost_centers")
        .update({
          nombre_centro_costo: row.nombre_centro_costo,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingId);

      if (error) {
        failures.push(`${row.numero_centro_costo}: ${error.message}`);
      } else {
        updated += 1;
      }
    } else {
      const { error } = await environmentClient.from("cost_centers").insert({
        company_id: company.remote_company_id,
        numero_centro_costo: row.numero_centro_costo,
        nombre_centro_costo: row.nombre_centro_costo,
        is_active: true,
      });

      if (error) {
        failures.push(`${row.numero_centro_costo}: ${error.message}`);
      } else {
        created += 1;
      }
    }
  }

  return NextResponse.json({
    success: failures.length === 0,
    updated,
    created,
    failures,
    message: `${updated} centro(s) de costo actualizados, ${created} nuevo(s) creados.`,
  });
}
