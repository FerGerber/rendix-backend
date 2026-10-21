import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requireActiveStaff,
  canAccessCompany,
  companyAccessDeniedResponse,
} from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import { parseSpreadsheetFileWithRows } from "@/lib/catalogs/parseSpreadsheet";
import {
  MAX_BULK_ROWS,
  importBulkRows,
  validateBulkRows,
} from "@/lib/users/bulkUpload";
import { buildUsersWorkbook } from "@/lib/users/bulkTemplate";

// Cada tanda de importación crea pocos usuarios, pero el servidor vuelve
// a leer la empresa completa en cada una — dejamos margen de tiempo.
export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_BATCH = 25;

async function resolveContext(request: Request, params: RouteParams["params"]) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return { response: auth.response };

  const { id } = await params;
  const company = await getRegisteredCompany(id);
  if (!company) {
    return {
      response: NextResponse.json(
        { success: false, error: "No se encontró la empresa." },
        { status: 404 }
      ),
    };
  }

  if (!canAccessCompany(auth.staff, company.id)) {
    return { response: companyAccessDeniedResponse() };
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return { response: envResult.response };

  return { company, client: envResult.client };
}

// Plantilla descargable: hoja "Usuarios" (la que se lee al subir), hoja
// "Instrucciones" y hoja "Centros de costo" con el catálogo vigente de
// la empresa para copiar/pegar los números.
async function loadCostCenters(
  client: SupabaseClient,
  remoteCompanyId: string
) {
  const { data, error } = await client
    .from("cost_centers")
    .select("numero_centro_costo, nombre_centro_costo, is_active")
    .eq("company_id", remoteCompanyId)
    .eq("is_active", true)
    .order("numero_centro_costo", { ascending: true })
    .limit(5000);

  return { costCenters: data || [], error };
}

function xlsxResponse(buffer: ArrayBuffer, filename: string) {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request, { params }: RouteParams) {
  const context = await resolveContext(request, params);
  if ("response" in context) return context.response;
  const { company, client } = context;

  const { costCenters, error } = await loadCostCenters(
    client,
    company.remote_company_id
  );

  if (error) {
    return NextResponse.json(
      { success: false, error: `No se pudo leer el catálogo: ${error.message}` },
      { status: 500 }
    );
  }

  const workbook = buildUsersWorkbook({ costCenters });
  const buffer = await workbook.xlsx.writeBuffer();
  return xlsxResponse(buffer as ArrayBuffer, "plantilla_usuarios.xlsx");
}

// mode=validate: lee el archivo y devuelve el resumen fila por fila SIN
// crear nada. mode=import: vuelve a validar (nunca confía en lo que
// mandó el navegador) y crea SOLO las filas indicadas en `rows` — el
// navegador manda tandas chicas, en el orden que devolvió validate, para
// no depender de que una sola llamada alcance a crear todo.
export async function POST(request: Request, { params }: RouteParams) {
  const context = await resolveContext(request, params);
  if ("response" in context) return context.response;
  const { company, client } = context;

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
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: "El archivo es demasiado grande (máximo 5 MB)." },
      { status: 400 }
    );
  }

  const mode = formData.get("mode");
  if (mode !== "validate" && mode !== "import" && mode !== "report") {
    return NextResponse.json(
      { success: false, error: "Modo de carga inválido." },
      { status: 400 }
    );
  }

  let sourceRows: Awaited<ReturnType<typeof parseSpreadsheetFileWithRows>>;
  try {
    sourceRows = await parseSpreadsheetFileWithRows(file);
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

  if (sourceRows.length === 0) {
    return NextResponse.json(
      { success: false, error: "El archivo no tiene filas para procesar." },
      { status: 400 }
    );
  }
  if (sourceRows.length > MAX_BULK_ROWS) {
    return NextResponse.json(
      {
        success: false,
        error: `El archivo tiene ${sourceRows.length} filas; el máximo es ${MAX_BULK_ROWS}. Dividilo en varios archivos.`,
      },
      { status: 400 }
    );
  }

  // mode=report: devuelve un Excel con las filas indicadas (las que no se
  // pudieron crear) y una columna "observaciones" con el motivo de cada
  // una, para corregirlas y volver a subir el mismo archivo.
  if (mode === "report") {
    let observations: Record<string, string>;
    try {
      const parsed = JSON.parse(String(formData.get("observations") || "{}"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid");
      }
      observations = parsed as Record<string, string>;
    } catch {
      return NextResponse.json(
        { success: false, error: "Las observaciones enviadas no son válidas." },
        { status: 400 }
      );
    }

    const reportRows = sourceRows
      .filter((row) => String(row.rowNumber) in observations)
      .map((row) => ({
        data: row.data,
        observations: String(observations[String(row.rowNumber)] || ""),
      }));

    if (reportRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No hay filas para incluir en el reporte." },
        { status: 400 }
      );
    }

    const { costCenters } = await loadCostCenters(
      client,
      company.remote_company_id
    );
    const workbook = buildUsersWorkbook({ costCenters, rows: reportRows });
    const buffer = await workbook.xlsx.writeBuffer();
    return xlsxResponse(buffer as ArrayBuffer, "usuarios_no_creados.xlsx");
  }

  let validation: Awaited<ReturnType<typeof validateBulkRows>>;
  try {
    validation = await validateBulkRows({
      client,
      company,
      rows: sourceRows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "No se pudo validar el archivo.",
      },
      { status: 500 }
    );
  }

  if (validation.missingColumns.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Faltan columnas obligatorias en la primera hoja: ${validation.missingColumns.join(", ")}. Descargá la plantilla para ver el formato.`,
      },
      { status: 400 }
    );
  }

  if (mode === "validate") {
    const rows = validation.rows.map((row) => ({
      row_number: row.rowNumber,
      email: row.email,
      full_name: row.fullName,
      role: row.role,
      auth_provider: row.authProvider,
      cost_center: row.costCenterLabel,
      supervisor: row.supervisorLabel,
      status:
        row.errors.length > 0
          ? "error"
          : row.warnings.length > 0
            ? "warning"
            : "ok",
      errors: row.errors,
      warnings: row.warnings,
    }));

    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        valid: rows.filter((row) => row.status !== "error").length,
        with_warnings: rows.filter((row) => row.status === "warning").length,
        with_errors: rows.filter((row) => row.status === "error").length,
      },
      rows,
      creation_order: validation.creationOrder,
      unknown_columns: validation.unknownColumns,
    });
  }

  // mode === "import"
  let rowNumbers: number[];
  try {
    const parsed = JSON.parse(String(formData.get("rows") || "[]"));
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => !Number.isInteger(value))
    ) {
      throw new Error("invalid");
    }
    rowNumbers = parsed as number[];
  } catch {
    return NextResponse.json(
      { success: false, error: "La lista de filas a crear no es válida." },
      { status: 400 }
    );
  }

  if (rowNumbers.length === 0 || rowNumbers.length > MAX_IMPORT_BATCH) {
    return NextResponse.json(
      {
        success: false,
        error: `Cada tanda debe tener entre 1 y ${MAX_IMPORT_BATCH} filas.`,
      },
      { status: 400 }
    );
  }

  const results = await importBulkRows({
    client,
    company,
    rows: validation.rows,
    rowNumbers,
    sendWelcomeEmail: formData.get("send_welcome_email") === "true",
  });

  return NextResponse.json({ success: true, results });
}
