// Reglas de negocio portadas TAL CUAL desde rendi-platform
// (lib/users/workflow.ts, pantalla Usuarios de Finanzas) para que el alta
// y edición de usuarios que hace esta backend ya quede coherente desde el
// primer momento — si asignás un Supervisor acá, esa persona ya sale con
// acceso de aprobación, igual que si lo hicieras después desde adentro de
// rendi-platform. La gestión fina del día a día (edición ocasional,
// reasignaciones) la sigue haciendo Finanzas desde su propia pantalla
// Usuarios — esta backend solo necesita que la configuración inicial no
// quede "rota" hasta que alguien la corrija ahí.
//
// A propósito, NO se porta la escritura a profile_management_audit: esa
// tabla exige que changed_by sea un profiles.id válido de la MISMA
// empresa, y el staff de Rendix no tiene (ni debe tener) un perfil ahí.
// Si más adelante hace falta trazabilidad de lo que hace el staff, tiene
// más sentido una tabla de auditoría propia en el proyecto de esta
// backend (con staff_id) que forzar algo en el esquema del cliente.
export const PROFILE_ROLES = ["employee", "hr", "finance"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export function isValidProfileRole(value: unknown): value is ProfileRole {
  return (
    typeof value === "string" &&
    (PROFILE_ROLES as readonly string[]).includes(value)
  );
}

export type SupervisorAccessProfile = {
  role: ProfileRole;
  can_approve_reports?: boolean | null;
  can_manage_finance?: boolean | null;
};

// Un perfil con rol RRHH/Finanzas, o con la delegación can_manage_finance,
// ya tiene acceso de aprobación por otra vía — no depende de ser
// supervisor de nadie.
export function hasApprovalAccessThroughRoleOrDelegation(
  profile: SupervisorAccessProfile
): boolean {
  return (
    profile.role === "hr" ||
    profile.role === "finance" ||
    profile.can_manage_finance === true
  );
}

export function shouldGrantApprovalOnSupervisorAssignment(
  newSupervisor: SupervisorAccessProfile
): boolean {
  return (
    !hasApprovalAccessThroughRoleOrDelegation(newSupervisor) &&
    newSupervisor.can_approve_reports !== true
  );
}

export function shouldRevokeApprovalOnSupervisorRemoval(
  formerSupervisor: SupervisorAccessProfile,
  stillSupervisesSomeoneElse: boolean
): boolean {
  return (
    !stillSupervisesSomeoneElse &&
    !hasApprovalAccessThroughRoleOrDelegation(formerSupervisor) &&
    formerSupervisor.can_approve_reports === true
  );
}
