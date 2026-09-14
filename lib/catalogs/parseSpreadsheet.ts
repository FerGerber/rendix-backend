import ExcelJS from "exceljs";
import { Readable } from "stream";

export type ParsedRow = Record<string, string>;

// Extrae el valor de una celda de ExcelJS como texto plano, manejando los
// formatos especiales que puede devolver (texto enriquecido, fórmulas,
// fechas, booleanos) además de strings y números simples.
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("result" in value) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    return "";
  }

  return String(value).trim();
}

// Lee un archivo CSV o Excel (.xlsx) subido desde el navegador y lo
// convierte en filas de texto, con los encabezados de columna
// normalizados (minúsculas, espacios reemplazados por "_") para tolerar
// variaciones como "Numero_Cuenta" o " numero_cuenta ".
export async function parseSpreadsheetFile(file: File): Promise<ParsedRow[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".xls")) {
    throw new Error(
      "El formato .xls (Excel antiguo) no está soportado. Guardá el archivo como .xlsx o .csv y volvé a subirlo."
    );
  }

  const workbook = new ExcelJS.Workbook();
  let worksheet: ExcelJS.Worksheet | undefined;

  if (name.endsWith(".csv")) {
    worksheet = await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    worksheet = workbook.worksheets[0];
  }

  if (!worksheet) return [];

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value).toLowerCase().replace(/\s+/g, "_");
  });

  const rows: ParsedRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // encabezado

    const normalizedRow: ParsedRow = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;
      const strValue = cellToString(cell.value);
      if (strValue) hasValue = true;
      normalizedRow[key] = strValue;
    });

    if (hasValue) rows.push(normalizedRow);
  });

  return rows;
}

const TRUE_VALUES = new Set(["true", "1", "si", "sí", "x", "yes"]);

// Interpreta valores típicos de una celda "es default" cargada a mano en
// Excel/Sheets: TRUE, 1, si/sí, x. Cualquier otra cosa (vacío, "no",
// "false") se toma como falso.
export function parseBooleanCell(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}
