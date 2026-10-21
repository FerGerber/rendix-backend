import ExcelJS from "exceljs";
import type { ParsedRow } from "@/lib/catalogs/parseSpreadsheet";
import {
  MAX_BULK_ROWS,
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
} from "@/lib/users/bulkUpload";

// Arma el libro de Excel de la carga masiva de usuarios: la plantilla
// vacía y, con `rows`, el reporte de filas que no se pudieron crear (las
// mismas columnas de la plantilla + una columna "observaciones" al final,
// para corregir y volver a subir el mismo archivo).

export type CostCenterOption = {
  numero_centro_costo: string;
  nombre_centro_costo: string;
};

export type ReportRow = { data: ParsedRow; observations: string };

const OBSERVATIONS_COLUMN = "observaciones";

const HELP: Record<string, string> = {
  email: "Email de la persona. Es con el que va a ingresar (Google o Microsoft).",
  nombre_completo: "Nombre y apellido.",
  rol: "Colaborador, Recursos Humanos o Finanzas (los mismos nombres que en el desplegable de Usuarios).",
  metodo_acceso:
    "google, microsoft o local. Con local, la persona recibe por email un enlace para crear su propia contraseña (este email se envía siempre).",
  numero_centro_costo:
    "Número del centro de costos por defecto (ver hoja 'Centros de costo'). Si queda vacío, el usuario se crea sin centro.",
  nombre_centro_costo:
    "Nombre del centro de costos. Se usa para verificar que coincida con el número; si no hay número, se busca por nombre.",
  supervisor_email:
    "Email del supervisor. Puede ser una persona que ya existe en la empresa o una que viene en este mismo archivo.",
  supervisor_nombre:
    "Nombre del supervisor (solo para control; la búsqueda es por email).",
  es_admin_empresa: "si / no. Vacío = no.",
  puede_enviar_rendiciones: "si / no. Vacío = si.",
  puede_aprobar_rendiciones:
    "si / no. Vacío = no. Quien figure como supervisor de alguien recibe acceso de aprobación automáticamente.",
  puede_gestionar_usuarios: "si / no. Vacío = no.",
  puede_ver_reportes: "si / no. Vacío = no.",
  acceso_finanzas_delegado: "si / no. Vacío = no.",
};

export function buildUsersWorkbook(args: {
  costCenters: CostCenterOption[];
  rows?: ReportRow[];
}): ExcelJS.Workbook {
  const { costCenters, rows } = args;
  const isReport = Boolean(rows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Usuarios");

  const columns: string[] = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
  const allColumns = isReport ? [...columns, OBSERVATIONS_COLUMN] : columns;

  sheet.columns = allColumns.map((column) => ({
    header: column,
    key: column,
    width:
      column === OBSERVATIONS_COLUMN ? 70 : Math.max(18, column.length + 4),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  allColumns.forEach((column, index) => {
    const required = (REQUIRED_COLUMNS as readonly string[]).includes(column);
    headerRow.getCell(index + 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb:
          column === OBSERVATIONS_COLUMN
            ? "FFDC2626"
            : required
              ? "FF2563EB"
              : "FF64748B",
      },
    };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const listValidation = (formula: string) => ({
    type: "list" as const,
    allowBlank: true,
    formulae: [formula],
  });
  const roleColumn = columns.indexOf("rol") + 1;
  const providerColumn = columns.indexOf("metodo_acceso") + 1;
  const yesNoColumns = [
    "es_admin_empresa",
    "puede_enviar_rendiciones",
    "puede_aprobar_rendiciones",
    "puede_gestionar_usuarios",
    "puede_ver_reportes",
    "acceso_finanzas_delegado",
  ].map((name) => columns.indexOf(name) + 1);

  const lastValidatedRow = Math.max(501, (rows?.length ?? 0) + 1);
  for (let rowNumber = 2; rowNumber <= lastValidatedRow; rowNumber++) {
    sheet.getCell(rowNumber, roleColumn).dataValidation = listValidation(
      '"Colaborador,Recursos Humanos,Finanzas"'
    );
    sheet.getCell(rowNumber, providerColumn).dataValidation = listValidation(
      '"google,microsoft,local"'
    );
    for (const column of yesNoColumns) {
      sheet.getCell(rowNumber, column).dataValidation =
        listValidation('"si,no"');
    }
  }

  // Texto, para que Excel no convierta emails en links ni números de
  // centro de costos en números.
  sheet.getColumn(columns.indexOf("email") + 1).numFmt = "@";
  sheet.getColumn(columns.indexOf("numero_centro_costo") + 1).numFmt = "@";
  sheet.getColumn(columns.indexOf("supervisor_email") + 1).numFmt = "@";

  (rows || []).forEach((row, index) => {
    const excelRow = sheet.getRow(index + 2);
    columns.forEach((column, columnIndex) => {
      excelRow.getCell(columnIndex + 1).value = row.data[column] || null;
    });
    const observationsCell = excelRow.getCell(columns.length + 1);
    observationsCell.value = row.observations;
    observationsCell.font = { color: { argb: "FFB91C1C" } };
    observationsCell.alignment = { wrapText: true, vertical: "top" };
  });

  const instructions = workbook.addWorksheet("Instrucciones");
  instructions.columns = [
    { header: "Columna", key: "column", width: 30 },
    { header: "Obligatoria", key: "required", width: 14 },
    { header: "Qué va", key: "help", width: 90 },
  ];
  instructions.getRow(1).font = { bold: true };
  for (const column of columns) {
    instructions.addRow({
      column,
      required: (REQUIRED_COLUMNS as readonly string[]).includes(column)
        ? "Sí"
        : "No",
      help: HELP[column] || "",
    });
  }
  if (isReport) {
    instructions.addRow({
      column: OBSERVATIONS_COLUMN,
      required: "—",
      help: "Por qué no se creó cada fila. Se ignora al volver a subir el archivo: corregí las columnas de la izquierda y subilo de nuevo.",
    });
  }
  instructions.addRow({});
  instructions.addRow({
    column: `Máximo ${MAX_BULK_ROWS} filas por archivo. No cambies los nombres de las columnas de la hoja 'Usuarios'.`,
  });

  const catalog = workbook.addWorksheet("Centros de costo");
  catalog.columns = [
    { header: "numero_centro_costo", key: "numero", width: 24 },
    { header: "nombre_centro_costo", key: "nombre", width: 50 },
  ];
  catalog.getRow(1).font = { bold: true };
  for (const costCenter of costCenters) {
    catalog.addRow({
      numero: costCenter.numero_centro_costo,
      nombre: costCenter.nombre_centro_costo,
    });
  }

  return workbook;
}
