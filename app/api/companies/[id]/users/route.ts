import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import {
  isValidProfileRole,
  shouldGrantApprovalOnSupervisorAssignment,
  type ProfileRole,
} from "@/lib/users/workflow";
import { sendEmail } from "@/lib/notifications/email";
import { buildWelcomeEmail } from "@/lib/notifications/welcome-email";

type RouteParams = { params: Promise<{ id: string }> };

const AUTH_PROVIDERS = ["local", "google", "microsoft"] as const;
type AuthProvider = (typeof AUTH_PROVIDERS)[number];

function isValidAuthProvider(value: unknown): value is AuthProvider {
  return (
    typeof value === "string" &&
    (AUTH_PROVIDERS as readonly string[]).includes(value)
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_SELECT =
  "id, email, full_name, role, is_active, supervisor_id, auth_provider, is_company_admin, can_submit_reports, can_approve_reports, can_manage_users, can_view_reports, can_manage_finance, must_reset_password, created_at";

// Caso testigo 2026-09-16: el alta "local" mandaba la contraseña inicial
// por mail (inviteUserByEmail), pero eso depende de que Supabase Auth
// logre entregar ese mail — probado en vivo, cayó a spam con el mailer
// por default y en otro caso ni siquiera llegó. En vez de depender de eso
// para el acceso inicial, se genera acá una contraseña temporal al azar,
// se le crea la cuenta directo con esa contraseña, y queda marcada con
// must_reset_password para que rendi-platform la obligue a cambiarla en
// el primer login. La contraseña se devuelve UNA SOLA VEZ en la respuesta
// de este POST para que quien hizo el alta se la pase a la persona por
// el canal que prefiera (no por mail, para no depender otra vez de la
// entrega) — no se guarda en ningún lado en texto plano.
function generateTemporaryPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(16);
  let password = "";
  for (const byte of bytes) {
    password += chars[byte % chars.length];
  }
  return password;
}

type SupervisorInfo = {
  id: string;
  role: ProfileRole;
  can_approve_reports: boolean | null;
  can_manage_finance: boolean | null;
};

// Caso testigo 2026-09-15: alguien probó "Ingresar con Google/Microsoft"
// contra rendi-platform ANTES de que existiera su perfil. Supabase Auth ya
// le creó la identidad en auth.users en ese primer intento (el rechazo que
// vio es solo del lado de la app, al no encontrar profiles) — así que
// admin.createUser() para esa misma persona falla con "email_exists" en vez
// de duplicar nada. Esta función busca esa identidad ya existente por email
// para poder colgarle el perfil en vez de fallar. La Admin API no tiene un
// "getUserByEmail" en esta versión de @supabase/supabase-js, así que hay
// que paginar listUsers() — el tope de 5000 usuarios es un colchón amplio
// para el tamaño actual; si en algún momento se vuelve un cuello de
// botella real, conviene revisar si la API ya suma un filtro por email.
async function findAuthUserByEmail(
  client: SupabaseClient,
  email: string
): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 25; page++) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error || !data) return null;

    const match = data.users.find(
      (user) => (user.email || "").toLowerCase() === target
    );
    if (match) return { id: match.id };

    if (data.users.length < perPage) break;
  }

  return null;
}

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

  const envResult = resolveEnvironmentClient(company.environment);
  if ("response" in envResult) return envResult.response;
  const environmentClient = envResult.client;

  const { data, error } = await environmentClient
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("company_id", company.remote_company_id)
    .order("full_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: `Error cargando usuarios: ${error.message}` },
      { status: 500 }
    );
  }

  // El centro de costo por defecto vive en una tabla aparte
  // (user_cost_centers, ya usada por rendi-platform para clasificar
  // gastos), no en profiles — se junta acá en memoria.
  const { data: defaultAssignments, error: assignmentsError } =
    await environmentClient
      .from("user_cost_centers")
      .select("user_id, cost_center_id")
      .eq("company_id", company.remote_company_id)
      .eq("is_default", true)
      .eq("is_active", true);

  if (assignmentsError) {
    return NextResponse.json(
      {
        success: false,
        error: `Error cargando centros de costo asignados: ${assignmentsError.message}`,
      },
      { status: 500 }
    );
  }

  const defaultCostCenterByUser = new Map<string, string>(
    (defaultAssignments || []).map((row) => [row.user_id, row.cost_center_id])
  );

  const users = (data || []).map((user) => ({
    ...user,
    default_cost_center_id: defaultCostCenterByUser.get(user.id) || null,
  }));

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

  // Alta de la identidad en Supabase Auth del entorno del cliente. Con
  // "local" se manda una invitación real por mail (Supabase arma el link
  // para que la persona ponga su contraseña). Con Google/Microsoft se
  // pre-crea la cuenta con el email confirmado para poder linkear el
  // perfil ya mismo — el primer login real con esa cuenta de Google
  // (Sign in with Google contra dev.rendixapp.com) ya se probó de punta a
  // punta con un alta real y linkeó correctamente contra este mismo
  // auth.users.id, sin duplicar identidad.
  //
  // Si esa persona ya había probado loguearse ANTES de tener perfil (le
  // aparece "no tenés acceso" en rendi-platform), Supabase ya le creó la
  // identidad de Auth en ese primer intento y createUser() acá abajo falla
  // con "email_exists" — el bloque de abajo detecta ese caso y reusa esa
  // identidad en vez de fallar el alta.
  let authUserId: string;
  let reusedExistingAuthIdentity = false;
  let temporaryPassword: string | null = null;

  if (authProvider === "local") {
    temporaryPassword = generateTemporaryPassword();

    const { data: createData, error: createError } =
      await environmentClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });

    if (createError || !createData.user) {
      return NextResponse.json(
        {
          success: false,
          error: `No se pudo crear el usuario: ${
            createError?.message || "error desconocido"
          }`,
        },
        { status: 500 }
      );
    }

    authUserId = createData.user.id;
  } else {
    const { data: createData, error: createError } =
      await environmentClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });

    if (createError || !createData.user) {
      // "email_exists": lo más probable es que la persona ya haya
      // intentado loguearse con Google/Microsoft antes de tener perfil.
      // En ese caso no hay que fallar el alta: hay que reusar esa
      // identidad de Auth y colgarle el perfil, no crear una cuenta
      // nueva (ver comentario de findAuthUserByEmail).
      const emailAlreadyRegistered =
        createError?.code === "email_exists" ||
        /already.*registered|user_already_exists/i.test(
          createError?.message || ""
        );

      if (!emailAlreadyRegistered) {
        return NextResponse.json(
          {
            success: false,
            error: `No se pudo crear el usuario: ${
              createError?.message || "error desconocido"
            }`,
          },
          { status: 500 }
        );
      }

      const existingAuthUser = await findAuthUserByEmail(
        environmentClient,
        email
      );

      if (!existingAuthUser) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Ese email ya está registrado en el sistema de autenticación (probablemente porque la persona ya intentó ingresar antes), pero no se pudo encontrar la cuenta para vincularla. Contactá a un administrador.",
          },
          { status: 500 }
        );
      }

      // Si ya hay un perfil colgado de esa identidad (en esta empresa o
      // en otra), no lo pisamos: eso hay que resolverlo a mano desde
      // Editar, no como un alta nueva.
      const { data: existingProfile, error: existingProfileError } =
        await environmentClient
          .from("profiles")
          .select("id, company_id, is_active")
          .eq("id", existingAuthUser.id)
          .maybeSingle();

      if (existingProfileError) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Ese email ya está registrado en el sistema de autenticación, pero no se pudo verificar si ya tiene un perfil asociado. Contactá a un administrador.",
          },
          { status: 500 }
        );
      }

      if (existingProfile) {
        return NextResponse.json(
          {
            success: false,
            error:
              existingProfile.company_id === company.remote_company_id
                ? "Esa persona ya tiene un perfil en esta empresa — buscala en la lista en vez de crearla de nuevo."
                : "Esa persona ya tiene un perfil en otra empresa registrada en Rendix. Si hay que moverla a esta empresa, avisame para resolverlo a mano.",
          },
          { status: 409 }
        );
      }

      authUserId = existingAuthUser.id;
      reusedExistingAuthIdentity = true;
    } else {
      authUserId = createData.user.id;
    }
  }

  const { data: newProfile, error: profileError } = await environmentClient
    .from("profiles")
    .insert({
      id: authUserId,
      company_id: company.remote_company_id,
      email,
      full_name: fullName,
      role,
      auth_provider: authProvider,
      supervisor_id: supervisorId,
      is_active: true,
      must_reset_password: authProvider === "local",
      is_company_admin: body.is_company_admin === true,
      can_submit_reports: body.can_submit_reports !== false,
      can_approve_reports: body.can_approve_reports === true,
      can_manage_users: body.can_manage_users === true,
      can_view_reports: body.can_view_reports === true,
      can_manage_finance: body.can_manage_finance === true,
    })
    .select(PROFILE_SELECT)
    .single();

  if (profileError || !newProfile) {
    // La cuenta de Auth YA se creó en el entorno del cliente pero no se
    // pudo guardar el perfil — queda una cuenta "huérfana" (sin fila en
    // profiles) que un administrador va a tener que revisar a mano en el
    // proyecto de Supabase de ese entorno.
    return NextResponse.json(
      {
        success: false,
        error: `Se creó la cuenta de acceso pero no se pudo guardar el perfil: ${
          profileError?.message || "error desconocido"
        }. Contactá a un administrador.`,
      },
      { status: 500 }
    );
  }

  const notes: string[] = [];

  if (temporaryPassword) {
    notes.push(
      `Contraseña temporal para ${email}: ${temporaryPassword} — pasásela por un canal que no sea email (no se mandó ningún mail con esto) y avisale que se la va a pedir cambiar apenas entre. No se vuelve a mostrar.`
    );
  }

  if (reusedExistingAuthIdentity) {
    notes.push(
      "Esta persona ya había intentado ingresar antes de tener perfil — se vinculó el perfil nuevo a esa cuenta existente, no se creó una cuenta duplicada."
    );
  }

  if (supervisor && shouldGrantApprovalOnSupervisorAssignment(supervisor)) {
    const { error: grantError } = await environmentClient
      .from("profiles")
      .update({
        can_approve_reports: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", supervisor.id)
      .eq("company_id", company.remote_company_id);

    if (grantError) {
      console.error(
        "No se pudo otorgar el acceso de aprobación en cascada:",
        grantError
      );
    } else {
      notes.push("También se le otorgó acceso de aprobación al supervisor asignado.");
    }
  }

  if (defaultCostCenterId) {
    const { error: costCenterAssignError } = await environmentClient
      .from("user_cost_centers")
      .insert({
        company_id: company.remote_company_id,
        user_id: authUserId,
        email,
        cost_center_id: defaultCostCenterId,
        is_default: true,
        is_active: true,
      });

    if (costCenterAssignError) {
      console.error(
        "No se pudo asignar el centro de costo por defecto:",
        costCenterAssignError
      );
      notes.push(
        "El usuario se creó pero no se pudo asignar el centro de costo por defecto — reintentá desde Editar."
      );
    }
  }

  // Punto 1 de la ronda de mejoras post primer alta real: a diferencia de
  // "local" (inviteUserByEmail manda su propio correo), admin.createUser()
  // no le avisa nada a la persona — sin esto, el alta quedaba silenciosa y
  // había que comunicarle a mano cómo entrar. No es bloqueante: si el
  // envío falla (o esta backend no tiene Resend configurado todavía), el
  // usuario ya quedó creado igual, solo se agrega un aviso para avisarle
  // manualmente.
  if (authProvider !== "local") {
    const welcomeEmail = buildWelcomeEmail({
      email,
      fullName,
      companyName: company.name,
      provider: authProvider,
    });

    const emailResult = await sendEmail({
      to: [email],
      subject: welcomeEmail.subject,
      text: welcomeEmail.text,
      html: welcomeEmail.html,
      idempotencyKey: `welcome-email:${authUserId}`,
    });

    if (emailResult.status === "failed") {
      notes.push(
        "El usuario se creó pero no se pudo enviar el correo de bienvenida — avisale manualmente cómo ingresar."
      );
    } else if (emailResult.status === "skipped") {
      notes.push(
        "El usuario se creó pero el envío de correos no está configurado en esta backend (RESEND_API_KEY/EMAIL_FROM) — avisale manualmente cómo ingresar."
      );
    }
  }

  return NextResponse.json({
    success: true,
    user: { ...newProfile, default_cost_center_id: defaultCostCenterId },
    message: notes.length > 0 ? notes.join(" ") : null,
  });
}
