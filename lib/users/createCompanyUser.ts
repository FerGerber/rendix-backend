import "server-only";

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegisteredCompany } from "@/lib/api/companies";
import {
  shouldGrantApprovalOnSupervisorAssignment,
  type ProfileRole,
} from "@/lib/users/workflow";
import { sendEmail } from "@/lib/notifications/email";
import { buildWelcomeEmail } from "@/lib/notifications/welcome-email";
import { getAppUrl } from "@/lib/notifications/app-url";

// Lógica de alta de un usuario en una empresa, compartida entre el alta
// individual (POST /api/companies/[id]/users) y la carga masiva por Excel
// (POST /api/companies/[id]/users/upload). Vive en un solo lugar para que
// las dos vías creen exactamente lo mismo: identidad en Auth, perfil,
// acceso de aprobación en cascada al supervisor, centro de costo por
// defecto y correo de bienvenida.

export const AUTH_PROVIDERS = ["local", "google", "microsoft"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function isValidAuthProvider(value: unknown): value is AuthProvider {
  return (
    typeof value === "string" &&
    (AUTH_PROVIDERS as readonly string[]).includes(value)
  );
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROFILE_SELECT =
  "id, email, full_name, role, is_active, supervisor_id, auth_provider, is_company_admin, can_submit_reports, can_approve_reports, can_manage_users, can_view_reports, can_manage_finance, must_reset_password, created_at";

// Caso testigo 2026-09-16: el alta "local" mandaba la contraseña inicial
// por mail (inviteUserByEmail), pero eso depende de que Supabase Auth
// logre entregar ese mail — probado en vivo, cayó a spam con el mailer
// por default y en otro caso ni siquiera llegó. En vez de depender de eso
// para el acceso inicial, se genera acá una contraseña temporal al azar,
// se le crea la cuenta directo con esa contraseña, y queda marcada con
// must_reset_password para que rendi-platform la obligue a cambiarla en
// el primer login. La contraseña se devuelve UNA SOLA VEZ en la respuesta
// para que quien hizo el alta se la pase a la persona por el canal que
// prefiera (no por mail, para no depender otra vez de la entrega) — no se
// guarda en ningún lado en texto plano.
export function generateTemporaryPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(16);
  let password = "";
  for (const byte of bytes) {
    password += chars[byte % chars.length];
  }
  return password;
}

export type SupervisorInfo = {
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
export async function findAuthUserByEmail(
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

export type NewUserFlags = {
  is_company_admin: boolean;
  can_submit_reports: boolean;
  can_approve_reports: boolean;
  can_manage_users: boolean;
  can_view_reports: boolean;
  can_manage_finance: boolean;
};

export type CreateCompanyUserParams = {
  client: SupabaseClient;
  company: RegisteredCompany;
  email: string;
  fullName: string;
  role: ProfileRole;
  authProvider: AuthProvider;
  // Ya validado por quien llama (misma empresa y activo) ANTES de llamar
  // acá, para no crear una cuenta de Auth que después haya que descartar.
  supervisor: SupervisorInfo | null;
  // Idem: ya validado (misma empresa y activo).
  defaultCostCenterId: string | null;
  flags: NewUserFlags;
  sendWelcomeEmail: boolean;
  // Cómo se le da la clave a un usuario "local":
  //  - "temporary" (alta individual): contraseña temporal generada acá y
  //    devuelta una sola vez a quien hace el alta.
  //  - "setup_link" (carga masiva): la cuenta se crea SIN contraseña y se
  //    manda por email un link para que la persona cree la suya. Nadie
  //    ve ni maneja claves. El email se manda siempre en este modo, porque
  //    es el único canal por el que llega el link.
  localPasswordMode?: "temporary" | "setup_link";
};

export type CreateCompanyUserResult =
  | {
      ok: true;
      profile: Record<string, unknown>;
      temporaryPassword: string | null;
      passwordSetup: "temporary" | "link";
      reusedExistingAuthIdentity: boolean;
      supervisorApprovalGranted: boolean;
      costCenterAssignFailed: boolean;
      emailStatus: "sent" | "failed" | "skipped" | "not_requested";
    }
  | { ok: false; status: number; error: string };

function failure(status: number, error: string): CreateCompanyUserResult {
  return { ok: false, status, error };
}

// Alta de la identidad en Supabase Auth del entorno del cliente. Con
// "local" se crea la cuenta con una contraseña temporal generada acá
// mismo (ver generateTemporaryPassword) en vez de depender del mail de
// invitación de Supabase Auth. Con Google/Microsoft se pre-crea la
// cuenta con el email confirmado para poder linkear el perfil ya mismo.
// Si esa persona ya había probado loguearse ANTES de tener perfil,
// Supabase ya le creó la identidad y createUser() falla con
// "email_exists": en ese caso se reusa esa identidad en vez de fallar.
export async function createCompanyUser(
  params: CreateCompanyUserParams
): Promise<CreateCompanyUserResult> {
  const {
    client,
    company,
    email,
    fullName,
    role,
    authProvider,
    supervisor,
    defaultCostCenterId,
    flags,
    sendWelcomeEmail,
    localPasswordMode = "temporary",
  } = params;
  const useSetupLink = authProvider === "local" && localPasswordMode === "setup_link";

  let authUserId: string;
  let reusedExistingAuthIdentity = false;
  let temporaryPassword: string | null = null;

  if (authProvider === "local") {
    temporaryPassword = useSetupLink ? null : generateTemporaryPassword();

    const { data: createData, error: createError } =
      await client.auth.admin.createUser({
        email,
        ...(temporaryPassword ? { password: temporaryPassword } : {}),
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });

    if (createError || !createData.user) {
      return failure(
        500,
        `No se pudo crear el usuario: ${
          createError?.message || "error desconocido"
        }`
      );
    }

    authUserId = createData.user.id;
  } else {
    const { data: createData, error: createError } =
      await client.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });

    if (createError || !createData.user) {
      const emailAlreadyRegistered =
        createError?.code === "email_exists" ||
        /already.*registered|user_already_exists/i.test(
          createError?.message || ""
        );

      if (!emailAlreadyRegistered) {
        return failure(
          500,
          `No se pudo crear el usuario: ${
            createError?.message || "error desconocido"
          }`
        );
      }

      const existingAuthUser = await findAuthUserByEmail(client, email);

      if (!existingAuthUser) {
        return failure(
          500,
          "Ese email ya está registrado en el sistema de autenticación (probablemente porque la persona ya intentó ingresar antes), pero no se pudo encontrar la cuenta para vincularla. Contactá a un administrador."
        );
      }

      // Si ya hay un perfil colgado de esa identidad (en esta empresa o
      // en otra), no lo pisamos: eso hay que resolverlo a mano desde
      // Editar, no como un alta nueva.
      const { data: existingProfile, error: existingProfileError } =
        await client
          .from("profiles")
          .select("id, company_id, is_active")
          .eq("id", existingAuthUser.id)
          .maybeSingle();

      if (existingProfileError) {
        return failure(
          500,
          "Ese email ya está registrado en el sistema de autenticación, pero no se pudo verificar si ya tiene un perfil asociado. Contactá a un administrador."
        );
      }

      if (existingProfile) {
        return failure(
          409,
          existingProfile.company_id === company.remote_company_id
            ? "Esa persona ya tiene un perfil en esta empresa — buscala en la lista en vez de crearla de nuevo."
            : "Esa persona ya tiene un perfil en otra empresa registrada en Rendix. Si hay que moverla a esta empresa, avisame para resolverlo a mano."
        );
      }

      authUserId = existingAuthUser.id;
      reusedExistingAuthIdentity = true;
    } else {
      authUserId = createData.user.id;
    }
  }

  const { data: newProfile, error: profileError } = await client
    .from("profiles")
    .insert({
      id: authUserId,
      company_id: company.remote_company_id,
      email,
      full_name: fullName,
      role,
      auth_provider: authProvider,
      supervisor_id: supervisor?.id ?? null,
      is_active: true,
      must_reset_password: authProvider === "local",
      is_company_admin: flags.is_company_admin,
      can_submit_reports: flags.can_submit_reports,
      can_approve_reports: flags.can_approve_reports,
      can_manage_users: flags.can_manage_users,
      can_view_reports: flags.can_view_reports,
      can_manage_finance: flags.can_manage_finance,
    })
    .select(PROFILE_SELECT)
    .single();

  if (profileError || !newProfile) {
    // La cuenta de Auth YA se creó en el entorno del cliente pero no se
    // pudo guardar el perfil — queda una cuenta "huérfana" (sin fila en
    // profiles) que un administrador va a tener que revisar a mano en el
    // proyecto de Supabase de ese entorno.
    return failure(
      500,
      `Se creó la cuenta de acceso pero no se pudo guardar el perfil: ${
        profileError?.message || "error desconocido"
      }. Contactá a un administrador.`
    );
  }

  let supervisorApprovalGranted = false;
  if (supervisor && shouldGrantApprovalOnSupervisorAssignment(supervisor)) {
    const { error: grantError } = await client
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
      supervisorApprovalGranted = true;
    }
  }

  let costCenterAssignFailed = false;
  if (defaultCostCenterId) {
    const { error: costCenterAssignError } = await client
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
      costCenterAssignFailed = true;
    }
  }

  // admin.createUser() no le avisa nada a la persona por sí solo — sin
  // esto, el alta queda silenciosa. Vale para Google/Microsoft y para
  // "local": en "local" el correo NO lleva la contraseña temporal (esa se
  // pasa por otro canal), es solo un aviso de que la cuenta está lista. No
  // es bloqueante: si el envío falla (o no hay Resend configurado), el
  // usuario ya quedó creado igual.
  let emailStatus: "sent" | "failed" | "skipped" | "not_requested" =
    "not_requested";

  if (sendWelcomeEmail || useSetupLink) {
    let setupUrl: string | undefined;
    let setupLinkFailed = false;

    if (useSetupLink) {
      // El link apunta a la propia plataforma (/reset-password) con el
      // token en la URL, y recién se canjea cuando la persona envía su
      // contraseña nueva: así un antivirus o filtro de correo que "abre"
      // los links para revisarlos no consume el token antes que ella.
      const { data: linkData, error: linkError } =
        await client.auth.admin.generateLink({ type: "recovery", email });
      const hashedToken = linkData?.properties?.hashed_token;

      if (linkError || !hashedToken) {
        console.error("No se pudo generar el link de contraseña:", linkError);
        setupLinkFailed = true;
      } else {
        setupUrl = `${getAppUrl(company.environment)}/reset-password?token_hash=${encodeURIComponent(
          hashedToken
        )}&type=recovery`;
      }
    }

    if (setupLinkFailed) {
      emailStatus = "failed";
    } else {
      const welcomeEmail = buildWelcomeEmail({
        email,
        fullName,
        companyName: company.name,
        provider: authProvider,
        environment: company.environment,
        setupUrl,
      });

      const emailResult = await sendEmail({
        to: [email],
        subject: welcomeEmail.subject,
        text: welcomeEmail.text,
        html: welcomeEmail.html,
        idempotencyKey: `welcome-email:${authUserId}`,
      });
      emailStatus = emailResult.status;
    }
  }

  return {
    ok: true,
    profile: newProfile as unknown as Record<string, unknown>,
    temporaryPassword,
    passwordSetup: useSetupLink ? "link" : "temporary",
    reusedExistingAuthIdentity,
    supervisorApprovalGranted,
    costCenterAssignFailed,
    emailStatus,
  };
}

// Arma los avisos que se muestran a quien hizo el alta, en el mismo orden
// y con el mismo texto que tenía el alta individual antes de extraer esta
// lógica. `includePassword` permite a la carga masiva dejar la contraseña
// fuera del texto (va en su propia columna del archivo de resultados).
export function buildCreateUserNotes(
  result: Extract<CreateCompanyUserResult, { ok: true }>,
  context: { email: string; authProvider: AuthProvider },
  options: { includePassword?: boolean } = {}
): string[] {
  const { includePassword = true } = options;
  const notes: string[] = [];

  if (result.temporaryPassword && includePassword) {
    notes.push(
      `Contraseña temporal para ${context.email}: ${result.temporaryPassword} — pasásela por un canal que no sea email (el mail que se manda solo avisa que la cuenta está lista, no lleva la contraseña) y avisale que se la va a pedir cambiar apenas entre. No se vuelve a mostrar.`
    );
  }

  if (result.reusedExistingAuthIdentity) {
    notes.push(
      "Esta persona ya había intentado ingresar antes de tener perfil — se vinculó el perfil nuevo a esa cuenta existente, no se creó una cuenta duplicada."
    );
  }

  if (result.supervisorApprovalGranted) {
    notes.push("También se le otorgó acceso de aprobación al supervisor asignado.");
  }

  if (result.costCenterAssignFailed) {
    notes.push(
      "El usuario se creó pero no se pudo asignar el centro de costo por defecto — reintentá desde Editar."
    );
  }

  if (result.passwordSetup === "link") {
    if (result.emailStatus === "sent") {
      notes.push("Se envió el email con el link para que cree su contraseña.");
    } else {
      notes.push(
        "El usuario se creó pero no se pudo enviar el email con el link para crear su contraseña — pedile que ingrese a Rendix y use \"Olvidé mi contraseña\" con su email."
      );
    }
  } else if (result.emailStatus === "failed") {
    notes.push(
      context.authProvider === "local"
        ? "El usuario se creó pero no se pudo enviar el correo de aviso — igual avisale por otro canal, junto con la contraseña temporal."
        : "El usuario se creó pero no se pudo enviar el correo de bienvenida — avisale manualmente cómo ingresar."
    );
  } else if (result.emailStatus === "skipped") {
    notes.push(
      "El usuario se creó pero el envío de correos no está configurado en esta backend (RESEND_API_KEY/EMAIL_FROM) — avisale manualmente cómo ingresar."
    );
  }

  return notes;
}
