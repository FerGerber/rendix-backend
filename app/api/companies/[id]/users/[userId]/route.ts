import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { getRegisteredCompany, resolveEnvironmentClient } from "@/lib/api/companies";
import {
  isValidProfileRole,
  shouldGrantApprovalOnSupervisorAssignment,
  shouldRevokeApprovalOnSupervisorRemoval,
  type ProfileRole,
} from "@/lib/users/workflow";

type RouteParams = { params: Promise<{ id: string; userId: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_SELECT =
  "id, email, full_name, role, is_active, supervisor_id, auth_provider, is_company_admin, can_submit_reports, can_approve_reports, can_manage_users, can_view_reports, can_manage_finance, created_at";

type TargetProfile = {
  id: string;
  role: ProfileRole;
  supervisor_id: string | null;
  is_active: boolean;
  can_manage_finance: boolean | null;
  can_approve_reports: boolean | null;
  company_id: string;
};

type SupervisorInfo = {
  id: string;
  role: ProfileRole;
  can_approve_reports: boolean | null;
  can_manage_finance: boolean | null;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id, userId } = await params;
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

  const { data: existing, error: existingError } = await environmentClient
    .from("profiles")
    .select(
      "id, role, supervisor_id, is_active, can_manage_finance, can_approve_reports, company_id"
    )
    .eq("id", userId)
    .eq("company_id", company.remote_company_id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json(
      { success: false, error: "No se encontró el usuario en esa empresa." },
      { status: 404 }
    );
  }
  const target = existing as TargetProfile;

  let body: {
    full_name?: unknown;
    role?: unknown;
    supervisor_id?: unknown;
    default_cost_center_id?: unknown;
    is_active?: unknown;
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

  const updates: Record<string, unknown> = {};

  if (typeof body.full_name === "string" || body.full_name === null) {
    updates.full_name =
      typeof body.full_name === "string" && body.full_name.trim()
        ? body.full_name.trim()
        : null;
  }

  if (body.role !== undefined) {
    if (!isValidProfileRole(body.role)) {
      return NextResponse.json(
        { success: false, error: "El rol indicado no es válido." },
        { status: 400 }
      );
    }
    updates.role = body.role;
  }

  let supervisorChanged = false;
  let newSupervisor: SupervisorInfo | null = null;

  if (body.supervisor_id !== undefined) {
    if (body.supervisor_id === null) {
      updates.supervisor_id = null;
      supervisorChanged = target.supervisor_id !== null;
    } else {
      if (
        typeof body.supervisor_id !== "string" ||
        !UUID_PATTERN.test(body.supervisor_id)
      ) {
        return NextResponse.json(
          { success: false, error: "El supervisor seleccionado no es válido." },
          { status: 400 }
        );
      }
      if (body.supervisor_id === target.id) {
        return NextResponse.json(
          {
            success: false,
            error: "Un perfil no puede ser supervisor de sí mismo.",
          },
          { status: 400 }
        );
      }

      const { data: supervisorRow, error: supervisorError } =
        await environmentClient
          .from("profiles")
          .select("id, role, can_approve_reports, can_manage_finance")
          .eq("id", body.supervisor_id)
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

      newSupervisor = supervisorRow as SupervisorInfo;
      updates.supervisor_id = body.supervisor_id;
      supervisorChanged = body.supervisor_id !== target.supervisor_id;
    }
  }

  // El centro de costo por defecto vive en user_cost_centers, no en
  // profiles — undefined = no tocar, null = quitar la asignación actual,
  // string = validar y asignar ese centro de costo como nuevo default.
  let defaultCostCenterChanged = false;
  let newDefaultCostCenterId: string | null = null;

  if (body.default_cost_center_id !== undefined) {
    defaultCostCenterChanged = true;

    if (body.default_cost_center_id !== null) {
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

      const { data: costCenterRow, error: costCenterError } =
        await environmentClient
          .from("cost_centers")
          .select("id")
          .eq("id", body.default_cost_center_id)
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

      newDefaultCostCenterId = body.default_cost_center_id;
    }
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { success: false, error: "El estado del perfil no es válido." },
        { status: 400 }
      );
    }
    updates.is_active = body.is_active;
  }

  if (typeof body.is_company_admin === "boolean") {
    updates.is_company_admin = body.is_company_admin;
  }
  if (typeof body.can_submit_reports === "boolean") {
    updates.can_submit_reports = body.can_submit_reports;
  }
  if (typeof body.can_approve_reports === "boolean") {
    updates.can_approve_reports = body.can_approve_reports;
  }
  if (typeof body.can_manage_users === "boolean") {
    updates.can_manage_users = body.can_manage_users;
  }
  if (typeof body.can_view_reports === "boolean") {
    updates.can_view_reports = body.can_view_reports;
  }
  if (typeof body.can_manage_finance === "boolean") {
    updates.can_manage_finance = body.can_manage_finance;
  }

  if (Object.keys(updates).length === 0 && !defaultCostCenterChanged) {
    return NextResponse.json(
      { success: false, error: "No hay cambios para guardar." },
      { status: 400 }
    );
  }

  // No dejamos que se desactive, o se le quite el acceso de Finanzas, al
  // único perfil con ese acceso en la empresa — si eso pasara, el cliente
  // quedaría sin nadie que pueda volver a entrar a Usuarios (ni acá ni en
  // rendi-platform) para revertirlo.
  const targetHasFinanceAccess =
    target.role === "finance" || target.can_manage_finance === true;
  const willDeactivateFinance =
    updates.is_active === false && targetHasFinanceAccess;
  const targetRoleBecomesNonFinance =
    updates.role !== undefined && updates.role !== "finance";
  const willLoseFinanceViaDelegationRemoval =
    updates.can_manage_finance === false &&
    target.can_manage_finance === true &&
    target.role !== "finance" &&
    updates.role === undefined;

  if (
    willDeactivateFinance ||
    (targetHasFinanceAccess && targetRoleBecomesNonFinance) ||
    willLoseFinanceViaDelegationRemoval
  ) {
    const { count, error: financeCountError } = await environmentClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.remote_company_id)
      .eq("is_active", true)
      .neq("id", target.id)
      .or("role.eq.finance,can_manage_finance.eq.true");

    if (financeCountError) {
      return NextResponse.json(
        {
          success: false,
          error: "No se pudo verificar el acceso de Finanzas restante.",
        },
        { status: 500 }
      );
    }

    if (!count) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No podés dejar a la empresa sin ningún perfil con acceso de Finanzas.",
        },
        { status: 409 }
      );
    }
  }

  // Igual que en rendi-platform: bajar a alguien del rol Finanzas también
  // le retira el acceso delegado, para no dejar a alguien con
  // can_manage_finance colgado de un rol que ya no tiene.
  if (targetRoleBecomesNonFinance && target.can_manage_finance === true) {
    updates.can_manage_finance = false;
  }

  updates.updated_at = new Date().toISOString();

  const { data: updatedProfile, error: updateError } = await environmentClient
    .from("profiles")
    .update(updates)
    .eq("id", target.id)
    .eq("company_id", company.remote_company_id)
    .select(PROFILE_SELECT)
    .single();

  if (updateError || !updatedProfile) {
    return NextResponse.json(
      { success: false, error: "No se pudo actualizar el perfil." },
      { status: 500 }
    );
  }

  const notes: string[] = [];

  if (supervisorChanged && newSupervisor) {
    if (shouldGrantApprovalOnSupervisorAssignment(newSupervisor)) {
      const { error: grantError } = await environmentClient
        .from("profiles")
        .update({
          can_approve_reports: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", newSupervisor.id)
        .eq("company_id", company.remote_company_id);

      if (grantError) {
        console.error(
          "No se pudo otorgar el acceso de aprobación en cascada:",
          grantError
        );
      } else {
        notes.push("Se le otorgó acceso de aprobación al nuevo supervisor.");
      }
    }
  }

  if (supervisorChanged && target.supervisor_id) {
    const { count: stillSupervisesCount, error: stillSupervisesError } =
      await environmentClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("supervisor_id", target.supervisor_id)
        .eq("company_id", company.remote_company_id)
        .eq("is_active", true)
        .neq("id", target.id);

    if (stillSupervisesError) {
      console.error(
        "No se pudo verificar si el ex supervisor sigue supervisando a alguien más:",
        stillSupervisesError
      );
    } else {
      const { data: formerSupervisor, error: formerSupervisorError } =
        await environmentClient
          .from("profiles")
          .select("id, role, can_approve_reports, can_manage_finance")
          .eq("id", target.supervisor_id)
          .eq("company_id", company.remote_company_id)
          .maybeSingle();

      if (formerSupervisorError) {
        console.error(
          "No se pudo cargar el ex supervisor para evaluar la revocación:",
          formerSupervisorError
        );
      } else if (
        formerSupervisor &&
        shouldRevokeApprovalOnSupervisorRemoval(
          formerSupervisor,
          (stillSupervisesCount || 0) > 0
        )
      ) {
        const { error: revokeError } = await environmentClient
          .from("profiles")
          .update({
            can_approve_reports: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", formerSupervisor.id)
          .eq("company_id", company.remote_company_id);

        if (revokeError) {
          console.error(
            "No se pudo revocar el acceso de aprobación en cascada:",
            revokeError
          );
        } else {
          notes.push(
            "Se le retiró el acceso de aprobación al ex supervisor, que ya no supervisa a nadie más."
          );
        }
      }
    }
  }

  if (defaultCostCenterChanged) {
    // Se retira cualquier asignación default vigente (nunca se hace
    // hard-delete acá tampoco) y, si corresponde, se crea la nueva. Se
    // separa en dos pasos para no chocar con el índice único que impide
    // más de un default activo por usuario en user_cost_centers.
    const { error: clearError } = await environmentClient
      .from("user_cost_centers")
      .update({
        is_default: false,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", company.remote_company_id)
      .eq("user_id", target.id)
      .eq("is_default", true);

    if (clearError) {
      console.error(
        "No se pudo limpiar el centro de costo por defecto anterior:",
        clearError
      );
      notes.push(
        "No se pudo actualizar el centro de costo por defecto — reintentá."
      );
    } else if (newDefaultCostCenterId) {
      const { error: assignError } = await environmentClient
        .from("user_cost_centers")
        .insert({
          company_id: company.remote_company_id,
          user_id: target.id,
          email: (updatedProfile as { email?: string }).email,
          cost_center_id: newDefaultCostCenterId,
          is_default: true,
          is_active: true,
        });

      if (assignError) {
        console.error(
          "No se pudo asignar el nuevo centro de costo por defecto:",
          assignError
        );
        notes.push(
          "No se pudo asignar el nuevo centro de costo por defecto — reintentá desde Editar."
        );
      }
    }
  }

  return NextResponse.json({
    success: true,
    user: {
      ...updatedProfile,
      ...(defaultCostCenterChanged
        ? { default_cost_center_id: newDefaultCostCenterId }
        : {}),
    },
    message: notes.length > 0 ? notes.join(" ") : null,
  });
}
