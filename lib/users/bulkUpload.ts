import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegisteredCompany } from "@/lib/api/companies";
import type { ParsedRow } from "@/lib/catalogs/parseSpreadsheet";
import { isValidProfileRole, type ProfileRole } from "@/lib/users/workflow";
import {
  EMAIL_PATTERN,
  buildCreateUserNotes,
  createCompanyUser,
  isValidAuthProvider,
  type AuthProvider,
  type NewUserFlags,
  type SupervisorInfo,
} from "@/lib/users/createCompanyUser";

// Carga masiva de usuarios por Excel/CSV. Este módulo concentra la
// interpretación de las columnas, la validación completa (sin escribir
// nada) y la creación por tandas; la ruta HTTP solo orquesta.

export const MAX_BULK_ROWS = 500;

// Encabezados ya normalizados (minúsculas, sin tildes, espacios -> "_"),
// que es como los deja parseSpreadsheetFile.
export const REQUIRED_COLUMNS = [
  "email",
  "nombre_completo",
  "rol",
  "metodo_acceso",
] as const;

export const OPTIONAL_COLUMNS = [
  "numero_centro_costo",
  "nombre_centro_costo",
  "supervisor_email",
  "supervisor_nombre",
  "es_admin_empresa",
  "puede_enviar_rendiciones",
  "puede_aprobar_rendiciones",
  "puede_gestionar_usuarios",
  "puede_ver_reportes",
  "acceso_finanzas_delegado",
] as const;

// "observaciones" es la columna que agrega el reporte de filas no creadas;
// se acepta y se ignora para poder volver a subir ese mismo archivo.
const KNOWN_COLUMNS = new Set<string>([
  ...REQUIRED_COLUMNS,
  ...OPTIONAL_COLUMNS,
  "observaciones",
]);

const FLAG_COLUMNS: {
  column: string;
  key: keyof NewUserFlags;
  defaultValue: boolean;
}[] = [
  { column: "es_admin_empresa", key: "is_company_admin", defaultValue: false },
  { column: "puede_enviar_rendiciones", key: "can_submit_reports", defaultValue: true },
  { column: "puede_aprobar_rendiciones", key: "can_approve_reports", defaultValue: false },
  { column: "puede_gestionar_usuarios", key: "can_manage_users", defaultValue: false },
  { column: "puede_ver_reportes", key: "can_view_reports", defaultValue: false },
  { column: "acceso_finanzas_delegado", key: "can_manage_finance", defaultValue: false },
];

const TRUE_VALUES = new Set(["true", "1", "si", "yes", "x", "s", "y"]);
const FALSE_VALUES = new Set(["false", "0", "no", "n"]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Si alguien escribe un marcador en vez de dejar la celda vacía (por
// ejemplo "(vacío)" o "-"), se toma como vacía en las columnas opcionales.
const EMPTY_PLACEHOLDERS = new Set([
  "(vacio)",
  "vacio",
  "-",
  "--",
  "n/a",
  "na",
  "(ninguno)",
  "ninguno",
  "sin supervisor",
]);

function optionalCell(value: string | undefined): string {
  const trimmed = (value || "").trim();
  return EMPTY_PLACEHOLDERS.has(normalizeText(trimmed)) ? "" : trimmed;
}

const ROLE_ALIASES: Record<string, ProfileRole> = {
  employee: "employee",
  empleado: "employee",
  empleada: "employee",
  colaborador: "employee",
  hr: "hr",
  rrhh: "hr",
  "recursos humanos": "hr",
  finance: "finance",
  finanzas: "finance",
};

export type BulkRow = {
  rowNumber: number;
  email: string;
  fullName: string;
  role: ProfileRole | null;
  authProvider: AuthProvider | null;
  costCenterNumber: string;
  costCenterName: string;
  supervisorEmail: string;
  supervisorName: string;
  flags: NewUserFlags;
  costCenterId: string | null;
  costCenterLabel: string | null;
  supervisorLabel: string | null;
  supervisorSource: "existing" | "file" | null;
  errors: string[];
  warnings: string[];
};

export type SpreadsheetRow = { rowNumber: number; data: ParsedRow };

export type BulkValidationResult = {
  rows: BulkRow[];
  // Números de fila en el orden en que hay que crearlos: los supervisores
  // que vienen en el mismo archivo van antes que su gente a cargo.
  creationOrder: number[];
  unknownColumns: string[];
  missingColumns: string[];
};

type ExistingProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
};

type CostCenterRow = {
  id: string;
  numero_centro_costo: string;
  nombre_centro_costo: string;
  is_active: boolean;
};

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

function parseFlag(
  raw: string,
  defaultValue: boolean
): { value: boolean; invalid: boolean } {
  const normalized = normalizeText(raw);
  if (!normalized) return { value: defaultValue, invalid: false };
  if (TRUE_VALUES.has(normalized)) return { value: true, invalid: false };
  if (FALSE_VALUES.has(normalized)) return { value: false, invalid: false };
  return { value: defaultValue, invalid: true };
}

export async function validateBulkRows(args: {
  client: SupabaseClient;
  company: RegisteredCompany;
  rows: SpreadsheetRow[];
}): Promise<BulkValidationResult> {
  const { client, company, rows: sourceRows } = args;

  const seenColumns = new Set<string>();
  for (const row of sourceRows) {
    for (const key of Object.keys(row.data)) seenColumns.add(key);
  }
  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !seenColumns.has(column)
  );
  const unknownColumns = [...seenColumns].filter(
    (column) => !KNOWN_COLUMNS.has(column)
  );

  if (missingColumns.length > 0) {
    return { rows: [], creationOrder: [], unknownColumns, missingColumns };
  }

  const [existingProfiles, costCenters] = await Promise.all([
    fetchAllPages<ExistingProfile>((from, to) =>
      client
        .from("profiles")
        .select("id, email, full_name, is_active")
        .eq("company_id", company.remote_company_id)
        .order("id")
        .range(from, to)
    ),
    fetchAllPages<CostCenterRow>((from, to) =>
      client
        .from("cost_centers")
        .select("id, numero_centro_costo, nombre_centro_costo, is_active")
        .eq("company_id", company.remote_company_id)
        .order("id")
        .range(from, to)
    ),
  ]);

  const existingByEmail = new Map<string, ExistingProfile>();
  for (const profile of existingProfiles) {
    existingByEmail.set(profile.email.trim().toLowerCase(), profile);
  }

  const costCenterByNumber = new Map<string, CostCenterRow>();
  const costCentersByName = new Map<string, CostCenterRow[]>();
  for (const costCenter of costCenters) {
    costCenterByNumber.set(costCenter.numero_centro_costo.trim(), costCenter);
    const key = normalizeText(costCenter.nombre_centro_costo);
    costCentersByName.set(key, [
      ...(costCentersByName.get(key) || []),
      costCenter,
    ]);
  }

  // Interpretación fila por fila.
  const rows: BulkRow[] = sourceRows.map(({ rowNumber, data }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const email = (data.email || "").trim().toLowerCase();
    const fullName = (data.nombre_completo || "").trim();

    if (!email) errors.push("Falta email.");
    else if (!EMAIL_PATTERN.test(email)) {
      errors.push(`El email "${email}" no es válido.`);
    }

    if (!fullName) errors.push("Falta nombre_completo.");

    let role: ProfileRole | null = null;
    const rawRole = normalizeText(data.rol || "");
    if (!rawRole) {
      errors.push("Falta rol (Colaborador, Recursos Humanos o Finanzas).");
    } else {
      const mapped = ROLE_ALIASES[rawRole];
      if (mapped && isValidProfileRole(mapped)) role = mapped;
      else {
        errors.push(
          `El rol "${data.rol}" no es válido. Usá Colaborador, Recursos Humanos o Finanzas.`
        );
      }
    }

    let authProvider: AuthProvider | null = null;
    const rawProvider = normalizeText(data.metodo_acceso || "");
    if (!rawProvider) {
      errors.push("Falta metodo_acceso (google, microsoft o local).");
    } else if (isValidAuthProvider(rawProvider)) {
      authProvider = rawProvider;
    } else {
      errors.push(
        `El metodo_acceso "${data.metodo_acceso}" no es válido. Usá google, microsoft o local.`
      );
    }

    const flags = {} as NewUserFlags;
    for (const flag of FLAG_COLUMNS) {
      const parsed = parseFlag(data[flag.column] || "", flag.defaultValue);
      flags[flag.key] = parsed.value;
      if (parsed.invalid) {
        errors.push(
          `${flag.column}: "${data[flag.column]}" no es válido. Usá si o no (o dejalo vacío).`
        );
      }
    }

    return {
      rowNumber,
      email,
      fullName,
      role,
      authProvider,
      costCenterNumber: optionalCell(data.numero_centro_costo),
      costCenterName: optionalCell(data.nombre_centro_costo),
      supervisorEmail: optionalCell(data.supervisor_email).toLowerCase(),
      supervisorName: optionalCell(data.supervisor_nombre),
      flags,
      costCenterId: null,
      costCenterLabel: null,
      supervisorLabel: null,
      supervisorSource: null,
      errors,
      warnings,
    };
  });

  // Emails repetidos dentro del archivo / ya existentes.
  const firstRowByEmail = new Map<string, BulkRow>();
  for (const row of rows) {
    if (!row.email) continue;

    const previous = firstRowByEmail.get(row.email);
    if (previous) {
      row.errors.push(
        `El email está repetido: ya aparece en la fila ${previous.rowNumber}.`
      );
    } else {
      firstRowByEmail.set(row.email, row);
    }

    const existing = existingByEmail.get(row.email);
    if (existing) {
      row.errors.push("Esta persona ya tiene un perfil en esta empresa.");
    }
  }

  // Emails que ya tienen perfil en OTRA empresa del mismo entorno.
  const emailsToCheck = [...firstRowByEmail.keys()].filter(
    (email) => !existingByEmail.has(email)
  );
  for (let i = 0; i < emailsToCheck.length; i += 100) {
    const chunk = emailsToCheck.slice(i, i + 100);
    const { data: otherProfiles, error } = await client
      .from("profiles")
      .select("email")
      .in("email", chunk)
      .neq("company_id", company.remote_company_id);

    if (error) {
      throw new Error(`No se pudo verificar emails existentes: ${error.message}`);
    }
    const takenElsewhere = new Set(
      (otherProfiles || []).map((profile) =>
        String(profile.email).trim().toLowerCase()
      )
    );
    for (const email of chunk) {
      if (takenElsewhere.has(email)) {
        const row = firstRowByEmail.get(email);
        row?.errors.push(
          "Esa persona ya tiene un perfil en otra empresa registrada en Rendix."
        );
      }
    }
  }

  // Centro de costos.
  for (const row of rows) {
    if (!row.costCenterNumber && !row.costCenterName) {
      row.warnings.push("Sin centro de costos: se crea sin centro asignado.");
      continue;
    }

    let match: CostCenterRow | undefined;

    if (row.costCenterNumber) {
      match = costCenterByNumber.get(row.costCenterNumber);
      if (!match) {
        row.errors.push(
          `El centro de costos número "${row.costCenterNumber}" no existe en la empresa.`
        );
        continue;
      }
      if (
        row.costCenterName &&
        normalizeText(row.costCenterName) !==
          normalizeText(match.nombre_centro_costo)
      ) {
        row.errors.push(
          `El nombre del centro de costos no coincide: el número ${row.costCenterNumber} es "${match.nombre_centro_costo}", y el archivo dice "${row.costCenterName}".`
        );
        continue;
      }
    } else {
      const candidates =
        costCentersByName.get(normalizeText(row.costCenterName)) || [];
      if (candidates.length === 0) {
        row.errors.push(
          `El centro de costos "${row.costCenterName}" no existe en la empresa.`
        );
        continue;
      }
      if (candidates.length > 1) {
        row.errors.push(
          `Hay más de un centro de costos llamado "${row.costCenterName}": indicá numero_centro_costo.`
        );
        continue;
      }
      match = candidates[0];
      row.warnings.push(
        `Centro de costos asignado por nombre (número ${match.numero_centro_costo}).`
      );
    }

    if (!match.is_active) {
      row.errors.push(
        `El centro de costos ${match.numero_centro_costo} (${match.nombre_centro_costo}) está inactivo.`
      );
      continue;
    }

    row.costCenterId = match.id;
    row.costCenterLabel = `${match.numero_centro_costo} - ${match.nombre_centro_costo}`;
  }

  // Supervisor.
  for (const row of rows) {
    if (!row.supervisorEmail) {
      if (row.supervisorName) {
        row.errors.push(
          "Indicaste supervisor_nombre pero falta supervisor_email."
        );
      }
      continue;
    }

    if (!EMAIL_PATTERN.test(row.supervisorEmail)) {
      row.errors.push(
        `El supervisor_email "${row.supervisorEmail}" no es válido.`
      );
      continue;
    }

    if (row.supervisorEmail === row.email) {
      row.errors.push("Una persona no puede ser su propio supervisor.");
      continue;
    }

    const existing = existingByEmail.get(row.supervisorEmail);
    if (existing) {
      if (!existing.is_active) {
        row.errors.push(
          `El supervisor ${row.supervisorEmail} existe pero está inactivo.`
        );
        continue;
      }
      row.supervisorSource = "existing";
      row.supervisorLabel = existing.full_name || row.supervisorEmail;
      if (
        row.supervisorName &&
        existing.full_name &&
        normalizeText(row.supervisorName) !== normalizeText(existing.full_name)
      ) {
        row.warnings.push(
          `El nombre del supervisor no coincide con el registrado ("${existing.full_name}"); se usa el supervisor por su email.`
        );
      }
      continue;
    }

    const inFile = firstRowByEmail.get(row.supervisorEmail);
    if (inFile) {
      row.supervisorSource = "file";
      row.supervisorLabel = `${inFile.fullName || row.supervisorEmail} (fila ${inFile.rowNumber})`;
      if (
        row.supervisorName &&
        inFile.fullName &&
        normalizeText(row.supervisorName) !== normalizeText(inFile.fullName)
      ) {
        row.warnings.push(
          `El nombre del supervisor no coincide con el de la fila ${inFile.rowNumber} ("${inFile.fullName}"); se usa el supervisor por su email.`
        );
      }
      continue;
    }

    row.errors.push(
      `El supervisor ${row.supervisorEmail} no existe en la empresa ni en el archivo.`
    );
  }

  // Un supervisor que viene en el mismo archivo pero tiene errores no se
  // va a crear: sus dependientes tampoco pueden crearse.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.errors.length > 0 || row.supervisorSource !== "file") continue;
      const supervisorRow = firstRowByEmail.get(row.supervisorEmail);
      if (!supervisorRow || supervisorRow.errors.length > 0) {
        row.errors.push(
          `Su supervisor (fila ${supervisorRow?.rowNumber ?? "?"}) tiene errores y no se va a crear.`
        );
        changed = true;
      }
    }
  }

  // Orden de creación: supervisores del archivo antes que su gente.
  const validRows = rows.filter((row) => row.errors.length === 0);
  const orderedRowNumbers: number[] = [];
  const created = new Set<number>();
  let progressed = true;
  while (progressed && orderedRowNumbers.length < validRows.length) {
    progressed = false;
    for (const row of validRows) {
      if (created.has(row.rowNumber)) continue;
      if (row.supervisorSource === "file") {
        const supervisorRow = firstRowByEmail.get(row.supervisorEmail);
        if (!supervisorRow || !created.has(supervisorRow.rowNumber)) continue;
      }
      created.add(row.rowNumber);
      orderedRowNumbers.push(row.rowNumber);
      progressed = true;
    }
  }

  for (const row of validRows) {
    if (!created.has(row.rowNumber)) {
      row.errors.push(
        "Los supervisores del archivo se refieren entre sí en círculo (por ejemplo A supervisa a B y B a A)."
      );
    }
  }

  return {
    rows,
    creationOrder: orderedRowNumbers,
    unknownColumns,
    missingColumns,
  };
}

export type ImportRowResult = {
  rowNumber: number;
  email: string;
  authProvider: AuthProvider | null;
  status: "created" | "error";
  message: string;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const EMAIL_SEND_SPACING_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Crea las filas indicadas (una tanda), en el orden recibido. Cada fila
// queda aislada de las demás: si una falla, el resto sigue.
export async function importBulkRows(args: {
  client: SupabaseClient;
  company: RegisteredCompany;
  rows: BulkRow[];
  rowNumbers: number[];
  sendWelcomeEmail: boolean;
}): Promise<ImportRowResult[]> {
  const { client, company, rows, rowNumbers, sendWelcomeEmail } = args;
  const byNumber = new Map(rows.map((row) => [row.rowNumber, row]));
  const results: ImportRowResult[] = [];
  let sentEmails = 0;

  for (const rowNumber of rowNumbers) {
    const row = byNumber.get(rowNumber);

    if (!row) {
      results.push({
        rowNumber,
        email: "",
        authProvider: null,
        status: "error",
        message: "La fila no existe en el archivo.",
      });
      continue;
    }

    const base = {
      rowNumber,
      email: row.email,
      authProvider: row.authProvider,
    };

    if (row.errors.length > 0 || !row.role || !row.authProvider) {
      results.push({
        ...base,
        status: "error",
        message: row.errors.join(" ") || "La fila tiene errores.",
      });
      continue;
    }

    // El supervisor se vuelve a buscar en la base al momento de crear: si
    // viene en el mismo archivo, ya fue creado en una tanda (o fila)
    // anterior.
    let supervisor: SupervisorInfo | null = null;
    if (row.supervisorEmail) {
      const { data: supervisorRow, error: supervisorError } = await client
        .from("profiles")
        .select("id, role, can_approve_reports, can_manage_finance")
        .eq("company_id", company.remote_company_id)
        .eq("is_active", true)
        .ilike("email", escapeLike(row.supervisorEmail))
        .maybeSingle();

      if (supervisorError || !supervisorRow) {
        results.push({
          ...base,
          status: "error",
          message: `No se pudo encontrar al supervisor ${row.supervisorEmail} (activo, en esta empresa). No se creó el usuario.`,
        });
        continue;
      }
      supervisor = supervisorRow as SupervisorInfo;
    }

    // Los usuarios "local" reciben siempre el email con el link para crear
    // su contraseña; a los demás se les manda solo si se pidió.
    const willSendEmail = sendWelcomeEmail || row.authProvider === "local";

    if (willSendEmail && sentEmails > 0) {
      // Resend limita el ritmo de envío (por defecto, 2 por segundo).
      await sleep(EMAIL_SEND_SPACING_MS);
    }

    const result = await createCompanyUser({
      client,
      company,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      authProvider: row.authProvider,
      supervisor,
      defaultCostCenterId: row.costCenterId,
      flags: row.flags,
      sendWelcomeEmail,
      localPasswordMode: "setup_link",
    });

    if (!result.ok) {
      results.push({ ...base, status: "error", message: result.error });
      continue;
    }

    if (result.emailStatus !== "not_requested") sentEmails += 1;

    const notes = buildCreateUserNotes(
      result,
      { email: row.email, authProvider: row.authProvider },
      { includePassword: false }
    );

    results.push({
      ...base,
      status: "created",
      message: notes.join(" "),
    });
  }

  return results;
}
