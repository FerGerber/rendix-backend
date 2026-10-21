import { NextResponse } from "next/server";
import {
  requireActiveStaff,
  canAccessCompany,
  companyAccessDeniedResponse,
} from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import { ensureCurrentMonthSnapshot } from "@/lib/api/companyStats";
import {
  isValidProfileRole,
  type ProfileRole,
} from "@/lib/users/workflow";
import {
  EMAIL_PATTERN,
  PROFILE_SELECT,
  UUID_PATTERN,
  buildCreateUserNotes,
  createCompanyUser,
  isValidAuthProvider,
  type SupervisorInfo,
} from "@/lib/users/createCompanyUser";

type RouteParams = { params: Promise<{ id: string }> };

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

  if (!canAccessCompany(auth.staff, company.id)) {
    return companyAccessDeniedResponse();
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  // PostgREST devuelve como máximo 1.000 filas por consulta: se pagina
  // por tandas para que empresas grandes no queden con la lista cortada.
  const PAGE = 1000;
  type ProfileRow = { id: string; is_active: boolean } & Record<string, unknown>;
  const data: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await environmentClient
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("company_id", company.remote_company_id)
      .order("full_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json(
        { success: false, error: `Error cargando usuarios: ${error.message}` },
        { status: 500 }
      );
    }
    data.push(...((page || []) as unknown as ProfileRow[]));
    if (!page || page.length < PAGE) break;
  }

  // El centro de costo por defecto vive en una tabla aparte
  // (user_cost_centers, ya usada por rendi-platform para clasificar
  // gastos), no en profiles — se junta acá en memoria.
  const defaultAssignments: { user_id: string; cost_center_id: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: assignmentsError } = await environmentClient
      .from("user_cost_centers")
      .select("user_id, cost_center_id")
      .eq("company_id", company.remote_company_id)
      .eq("is_default", true)
      .eq("is_active", true)
      .order("user_id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (assignmentsError) {
      return NextResponse.json(
        {
          success: false,
          error: `Error cargando centros de costo asignados: ${assignmentsError.message}`,
        },
        { status: 500 }
      );
    }
    defaultAssignments.push(...(page || []));
    if (!page || page.length < PAGE) break;
  }

  const defaultCostCenterByUser = new Map<string, string>(
    defaultAssignments.map((row) => [row.user_id, row.cost_center_id])
  );

  const users = data.map((user) => ({
    ...user,
    default_cost_center_id:
      defaultCostCenterByUser.get(user.id) || null,
  }));

  // Fire-and-forget: de paso que se carga la lista de usuarios (algo que
  // ya pasa cada vez que alguien abre la ficha de la empresa), se deja
  // guardada la foto mensual de referencia para facturación si todavía no
  // hay una del mes en curso (ver lib/api/companyStats.ts). Si falla, no
  // afecta la respuesta — solo queda logueado.
  void ensureCurrentMonthSnapshot(company.id, {
    users_total: users.length,
    users_active: users.filter((user) => user.is_active).length,
  });

  return NextResponse.json({ success: true, users });
}

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

  if (!canAccessCompany(auth.staff, company.id)) {
    return companyAccessDeniedResponse();
  }

  let body: {
    email?: unknown;
    full_name?: unknown;
    role?: unknown;
    auth_provider?: unknown;
    supervisor_id?: unknown;
    default_cost_center_id?: unknown;
    is_company_admin?: unknown;
    can_submit_reports?: unknown;
    can_approve_reports?: unknown;
    can_manage_users?: unknown;
    can_view_reports?: unknown;
    can_manage_finance?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { success: false, error: "El email no es válido." },
      { status: 400 }
    );
  }

  // Punto 2 de la ronda de mejoras post primer alta real: sin esto, un
  // usuario Google/Microsoft se creaba sin full_name porque todavía no
  // existe ningún login real de esa persona del que "traerlo" — recién se
  // completa (si acaso) el día que la persona inicia sesión por primera
  // vez, y para entonces ya se mostró "Cargando perfil" en el Sidebar y
  // faltó el nombre en cualquier listado. Exigirlo acá, en el alta, es más
  // simple y confiable que intentar auto-completarlo después.
  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : "";

  if (!fullName) {
    return NextResponse.json(
      { success: false, error: "El nombre y apellido es obligatorio." },
      { status: 400 }
    );
  }

  if (!isValidProfileRole(body.role)) {
    return NextResponse.json(
      { success: false, error: "El rol indicado no es válido." },
      { status: 400 }
    );
  }
  const role: ProfileRole = body.role;

  if (!isValidAuthProvider(body.auth_provider)) {
    return NextResponse.json(
      {
        success: false,
        error: "El método de acceso indicado no es válido.",
      },
      { status: 400 }
    );
  }
  const authProvider = body.auth_provider;

  let supervisorId: string | null = null;
  if (body.supervisor_id !== undefined && body.supervisor_id !== null) {
    if (
      typeof body.supervisor_id !== "string" ||
      !UUID_PATTERN.test(body.supervisor_id)
    ) {
      return NextResponse.json(
        { success: false, error: "El supervisor seleccionado no es válido." },
        { status: 400 }
      );
    }
    supervisorId = body.supervisor_id;
  }

  let defaultCostCenterId: string | null = null;
  if (
    body.default_cost_center_id !== undefined &&
    body.default_cost_center_id !== null
  ) {
    if (
      typeof body.default_cost_center_id !== "string" ||
      !UUID_PATTERN.test(body.default_cost_center_id)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El centro de costo seleccionado no es válido.",
        },
        { status: 400 }
      );
    }
    defaultCostCenterId = body.default_cost_center_id;
  }

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  // Se valida el supervisor ANTES de crear nada en Auth: si esto falla,
  // no queremos haber creado ya una cuenta de Auth para el nuevo usuario.
  let supervisor: SupervisorInfo | null = null;

  if (supervisorId) {
    const { data: supervisorRow, error: supervisorError } =
      await environmentClient
        .from("profiles")
        .select("id, role, can_approve_reports, can_manage_finance")
        .eq("id", supervisorId)
        .eq("company_id", company.remote_company_id)
        .eq("is_active", true)
        .maybeSingle();

    if (supervisorError) {
      return NextResponse.json(
        {
          success: false,
          error: "No se pudo validar el supervisor seleccionado.",
        },
        { status: 500 }
      );
    }

    if (!supervisorRow) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El supervisor seleccionado no existe, no está activo o pertenece a otra empresa.",
        },
        { status: 400 }
      );
    }

    supervisor = supervisorRow as SupervisorInfo;
  }

  // Mismo criterio: se valida el centro de costo ANTES de tocar Auth.
  if (defaultCostCenterId) {
    const { data: costCenterRow, error: costCenterError } =
      await environmentClient
        .from("cost_centers")
        .select("id")
        .eq("id", defaultCostCenterId)
        .eq("company_id", company.remote_company_id)
        .eq("is_active", true)
        .maybeSingle();

    if (costCenterError) {
      return NextResponse.json(
        {
          success: false,
          error: "No se pudo validar el centro de costo seleccionado.",
        },
        { status: 500 }
      );
    }
    if (!costCenterRow) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El centro de costo seleccionado no existe, no está activo o pertenece a otra empresa.",
        },
        { status: 400 }
      );
    }
  }

  const result = await createCompanyUser({
    client: environmentClient,
    company,
    email,
    fullName,
    role,
    authProvider,
    supervisor,
    defaultCostCenterId,
    flags: {
      is_company_admin: body.is_company_admin === true,
      can_submit_reports: body.can_submit_reports !== false,
      can_approve_reports: body.can_approve_reports === true,
      can_manage_users: body.can_manage_users === true,
      can_view_reports: body.can_view_reports === true,
      can_manage_finance: body.can_manage_finance === true,
    },
    sendWelcomeEmail: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  const notes = buildCreateUserNotes(result, { email, authProvider });

  return NextResponse.json({
    success: true,
    user: { ...result.profile, default_cost_center_id: defaultCostCenterId },
    message: notes.length > 0 ? notes.join(" ") : null,
  });
}
