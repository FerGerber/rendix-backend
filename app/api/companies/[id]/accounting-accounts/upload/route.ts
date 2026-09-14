import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import { parseSpreadsheetFile, parseBooleanCell } from "@/lib/catalogs/parseSpreadsheet";

type RouteParams = { params: Promise<{ id: string }> };

type ValidatedRow = {
  numero_cuenta: string;
  denominacion: string;
  tipo_cuenta: string | null;
  criterio_asociacion: string | null;
  is_default: boolean;
};

// Carga masiva del catálogo de cuentas contables de una empresa, por CSV
// o Excel. Comportamiento acordado con el cliente: actualiza las filas
// que coinciden por numero_cuenta, agrega las que son nuevas, y deja
// INTACTAS las que ya existían en la base pero no aparecen en este
// archivo (nunca se desactiva nada de forma implícita por no estar en el
// archivo). Todo el archivo se valida ANTES de escribir nada — si una
// sola fila tiene un problema, no se aplica ningún cambio.
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
  let defaultCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 por índice base 0, +1 por la fila de encabezados
    const numeroCuenta = row.numero_cuenta || "";
    const denominacion = row.denominacion || "";

    if (!numeroCuenta) {
      errors.push(`Fila ${rowNumber}: falta numero_cuenta.`);
      return;
    }
    if (!denominacion) {
      errors.push(`Fila ${rowNumber}: falta denominacion.`);
      return;
    }
    if (seenNumbers.has(numeroCuenta)) {
      errors.push(
        `Fila ${rowNumber}: numero_cuenta "${numeroCuenta}" está repetido en el archivo.`
      );
      return;
    }
    seenNumbers.add(numeroCuenta);

    const isDefault = parseBooleanCell(row.is_default);
    if (isDefault) defaultCount += 1;

    validated.push({
      numero_cuenta: numeroCuenta,
      denominacion,
      tipo_cuenta: row.tipo_cuenta || null,
      criterio_asociacion: row.criterio_asociacion || null,
      is_default: isDefault,
    });
  });

  if (defaultCount > 1) {
    errors.push(
      `El archivo marca ${defaultCount} cuentas como is_default — tiene que haber como máximo una.`
    );
  }

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
    .from("accounting_accounts")
    .select("id, numero_cuenta")
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
    (existingRows || []).map((row) => [row.numero_cuenta, row.id])
  );

  let updated = 0;
  let created = 0;
  const failures: string[] = [];

  for (const row of validated) {
    const existingId = existingByNumber.get(row.numero_cuenta);

    if (existingId) {
      // No se toca is_active al actualizar: si alguien desactivó esta
      // cuenta a propósito, un re-upload del catálogo no la reactiva
      // silenciosamente.
      const { error } = await environmentClient
        .from("accounting_accounts")
        .update({
          denominacion: row.denominacion,
          tipo_cuenta: row.tipo_cuenta,
          criterio_asociacion: row.criterio_asociacion,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingId);

      if (error) {
        failures.push(`${row.numero_cuenta}: ${error.message}`);
      } else {
        updated += 1;
      }
    } else {
      const { error } = await environmentClient
        .from("accounting_accounts")
        .insert({
          company_id: company.remote_company_id,
          numero_cuenta: row.numero_cuenta,
          denominacion: row.denominacion,
          tipo_cuenta: row.tipo_cuenta,
          criterio_asociacion: row.criterio_asociacion,
          is_active: true,
        });

      if (error) {
        failures.push(`${row.numero_cuenta}: ${error.message}`);
      } else {
        created += 1;
      }
    }
  }

  // No hay ninguna restricción en la base que garantice una sola cuenta
  // por defecto por empresa — es una regla de negocio que solo vive acá y
  // en el motor de clasificación automática de rendi-platform. Si el
  // archivo marcó una nueva cuenta por defecto, hay que desmarcar
  // explícitamente a todas las demás (estén o no en este archivo).
  let defaultNote: string | null = null;
  const winningDefault = validated.find((row) => row.is_default);

  if (winningDefault) {
    const { error: clearError } = await environmentClient
      .from("accounting_accounts")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("company_id", company.remote_company_id)
      .neq("numero_cuenta", winningDefault.numero_cuenta);

    const { error: setError } = await environmentClient
      .from("accounting_accounts")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("company_id", company.remote_company_id)
      .eq("numero_cuenta", winningDefault.numero_cuenta);

    if (clearError || setError) {
      console.error(
        "No se pudo aplicar el cambio de cuenta por defecto:",
        clearError || setError
      );
      defaultNote =
        "Ojo: hubo un problema aplicando la cuenta por defecto, revisala a mano.";
    } else {
      defaultNote = `"${winningDefault.numero_cuenta}" quedó como la cuenta contable por defecto.`;
    }
  }

  return NextResponse.json({
    success: failures.length === 0,
    updated,
    created,
    failures,
    message: [
      `${updated} cuenta(s) actualizadas, ${created} nueva(s) creadas.`,
      defaultNote,
    ]
      .filter(Boolean)
      .join(" "),
  });
}
