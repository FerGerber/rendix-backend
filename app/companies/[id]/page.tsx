"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";
import { RENDIX_CLIENT_ENVIRONMENT_LABELS } from "@/lib/environments";

type ProfileRole = "employee" | "hr" | "finance";
type AuthProviderValue = "local" | "google" | "microsoft";

type Company = {
  id: string;
  environment: keyof typeof RENDIX_CLIENT_ENVIRONMENT_LABELS;
  name: string;
  tax_id: string | null;
  base_currency: string;
  is_active: boolean;
};

type ManagedUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: ProfileRole;
  is_active: boolean;
  supervisor_id: string | null;
  default_cost_center_id: string | null;
  auth_provider: AuthProviderValue;
  is_company_admin: boolean;
  can_submit_reports: boolean;
  can_approve_reports: boolean;
  can_manage_users: boolean;
  can_view_reports: boolean;
  can_manage_finance: boolean;
};

type CostCenterOption = {
  id: string;
  numero_centro_costo: string;
  nombre_centro_costo: string;
  is_active: boolean;
};

const ROLE_LABELS: Record<ProfileRole, string> = {
  employee: "Colaborador",
  hr: "RRHH",
  finance: "Finanzas",
};

const AUTH_PROVIDER_LABELS: Record<AuthProviderValue, string> = {
  local: "Email y contraseña",
  google: "Google",
  microsoft: "Microsoft",
};

type UserFormState = {
  email: string;
  fullName: string;
  role: ProfileRole;
  authProvider: AuthProviderValue;
  supervisorId: string;
  defaultCostCenterId: string;
  isActive: boolean;
  isCompanyAdmin: boolean;
  canSubmitReports: boolean;
  canApproveReports: boolean;
  canManageUsers: boolean;
  canViewReports: boolean;
  canManageFinance: boolean;
};

const EMPTY_FORM: UserFormState = {
  email: "",
  fullName: "",
  role: "employee",
  authProvider: "local",
  supervisorId: "",
  defaultCostCenterId: "",
  isActive: true,
  isCompanyAdmin: false,
  canSubmitReports: true,
  canApproveReports: false,
  canManageUsers: false,
  canViewReports: false,
  canManageFinance: false,
};

function formFromUser(user: ManagedUser): UserFormState {
  return {
    email: user.email,
    fullName: user.full_name || "",
    role: user.role,
    authProvider: user.auth_provider,
    supervisorId: user.supervisor_id || "",
    defaultCostCenterId: user.default_cost_center_id || "",
    isActive: user.is_active,
    isCompanyAdmin: user.is_company_admin,
    canSubmitReports: user.can_submit_reports,
    canApproveReports: user.can_approve_reports,
    canManageUsers: user.can_manage_users,
    canViewReports: user.can_view_reports,
    canManageFinance: user.can_manage_finance,
  };
}

function PermissionCheckboxes({
  form,
  onChange,
}: {
  form: UserFormState;
  onChange: (patch: Partial<UserFormState>) => void;
}) {
  const items: { key: keyof UserFormState; label: string }[] = [
    { key: "isCompanyAdmin", label: "Administrador de la empresa" },
    { key: "canSubmitReports", label: "Puede enviar rendiciones" },
    { key: "canApproveReports", label: "Puede aprobar rendiciones" },
    { key: "canManageUsers", label: "Puede gestionar usuarios" },
    { key: "canViewReports", label: "Puede ver reportes / analytics" },
    { key: "canManageFinance", label: "Acceso delegado de Finanzas" },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <label
          key={item.key}
          className="flex items-center gap-2 text-sm text-slate-700"
        >
          <input
            type="checkbox"
            checked={Boolean(form[item.key])}
            onChange={(event) => onChange({ [item.key]: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const companyId = params.id as string;

  const { loading, accessDenied, staff } = useStaffSession();

  const [company, setCompany] = useState<Company | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companyError, setCompanyError] = useState("");

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  // Después de la primera carga, un refresh (tras crear/editar/activar)
  // no debe volver a mostrar "Cargando usuarios..." tapando la lista
  // entera — eso es lo que hacía que la pantalla "parpadeara" con cada
  // guardado. Con esto, la lista vieja queda visible hasta que llega la
  // nueva.
  const usersLoadedOnceRef = useRef(false);

  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const loadCompany = async () => {
    setCompanyLoading(true);
    setCompanyError("");
    try {
      const response = await authenticatedFetch(`/api/companies/${companyId}`);
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo cargar la empresa.");
      }
      setCompany(result.company);
    } catch (error) {
      setCompanyError(
        error instanceof Error ? error.message : "No se pudo cargar la empresa."
      );
    } finally {
      setCompanyLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!usersLoadedOnceRef.current) {
      setUsersLoading(true);
    }
    setUsersError("");
    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudieron cargar los usuarios.");
      }
      setUsers(result.users);
      usersLoadedOnceRef.current = true;
    } catch (error) {
      setUsersError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los usuarios."
      );
    } finally {
      setUsersLoading(false);
    }
  };

  const loadCostCenters = async () => {
    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/cost-centers`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "No se pudieron cargar los centros de costo."
        );
      }
      setCostCenters(result.costCenters);
    } catch (error) {
      // No es bloqueante para la pantalla de usuarios: si falla, el
      // select de centro de costo queda vacío y se puede reintentar
      // recargando la página.
      console.error("No se pudieron cargar los centros de costo:", error);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied && companyId) {
      loadCompany();
      loadUsers();
      loadCostCenters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied, companyId]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!createForm.fullName.trim()) {
      setCreateError("El nombre y apellido es obligatorio.");
      return;
    }

    setCreating(true);
    setCreateError("");
    setCreateMessage("");

    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: createForm.email,
            full_name: createForm.fullName.trim(),
            role: createForm.role,
            auth_provider: createForm.authProvider,
            supervisor_id: createForm.supervisorId || null,
            default_cost_center_id: createForm.defaultCostCenterId || null,
            is_company_admin: createForm.isCompanyAdmin,
            can_submit_reports: createForm.canSubmitReports,
            can_approve_reports: createForm.canApproveReports,
            can_manage_users: createForm.canManageUsers,
            can_view_reports: createForm.canViewReports,
            can_manage_finance: createForm.canManageFinance,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo invitar al usuario.");
      }
      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
      if (result.message) setCreateMessage(result.message);
      await loadUsers();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "No se pudo invitar al usuario."
      );
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (user: ManagedUser) => {
    setEditingId(user.id);
    setEditForm(formFromUser(user));
    setEditError("");
  };

  const handleSaveEdit = async (userId: string) => {
    setSavingEdit(true);
    setEditError("");

    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users/${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: editForm.fullName || null,
            role: editForm.role,
            supervisor_id: editForm.supervisorId || null,
            default_cost_center_id: editForm.defaultCostCenterId || null,
            is_active: editForm.isActive,
            is_company_admin: editForm.isCompanyAdmin,
            can_submit_reports: editForm.canSubmitReports,
            can_approve_reports: editForm.canApproveReports,
            can_manage_users: editForm.canManageUsers,
            can_view_reports: editForm.canViewReports,
            can_manage_finance: editForm.canManageFinance,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo guardar el usuario.");
      }
      setEditingId(null);
      await loadUsers();
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "No se pudo guardar el usuario."
      );
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 text-slate-500">
        Cargando...
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 px-6 text-slate-900">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Acceso no habilitado</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Tu cuenta de Google inició sesión correctamente, pero no está
            habilitada en <code>staff_users</code>. Pedile a un administrador
            que te dé de alta.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/companies"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Empresas
        </Link>

        {companyLoading ? (
          <p className="mt-4 text-sm text-slate-500">Cargando empresa...</p>
        ) : companyError ? (
          <p className="mt-4 text-sm font-medium text-red-600">{companyError}</p>
        ) : company ? (
          <div className="mt-3">
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
              {RENDIX_CLIENT_ENVIRONMENT_LABELS[company.environment]}
            </p>
            <h1 className="mt-1 text-3xl font-bold">{company.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {company.tax_id ? `${company.tax_id} · ` : ""}
              {company.base_currency}
              {!company.is_active ? " · Inactiva" : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/companies/${companyId}/accounting-accounts`}
                className="rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
              >
                Cuentas contables
              </Link>
              <Link
                href={`/companies/${companyId}/cost-centers`}
                className="rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
              >
                Centros de costo
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">Usuarios</h2>
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {showCreate ? "Cancelar" : "+ Invitar usuario"}
          </button>
        </div>

        {createMessage && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {createMessage}
          </p>
        )}

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mt-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <h3 className="text-base font-bold">Invitar usuario</h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Email *</span>
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      email: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Nombre y apellido *
                </span>
                <input
                  type="text"
                  required
                  value={createForm.fullName}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      fullName: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Rol</span>
                <select
                  value={createForm.role}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      role: event.target.value as ProfileRole,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {(Object.keys(ROLE_LABELS) as ProfileRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Método de acceso
                </span>
                <select
                  value={createForm.authProvider}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      authProvider: event.target.value as AuthProviderValue,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {(Object.keys(AUTH_PROVIDER_LABELS) as AuthProviderValue[]).map(
                    (providerKey) => (
                      <option key={providerKey} value={providerKey}>
                        {AUTH_PROVIDER_LABELS[providerKey]}
                      </option>
                    )
                  )}
                </select>
                {createForm.authProvider !== "local" && (
                  <span className="mt-1 block text-xs text-amber-600">
                    Con Google/Microsoft, confirmá que el primer inicio de
                    sesión de esta persona funcione antes de darla por
                    definitiva.
                  </span>
                )}
              </label>

              <label className="block text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Supervisor</span>
                <select
                  value={createForm.supervisorId}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      supervisorId: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin supervisor</option>
                  {users
                    .filter((user) => user.is_active)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name || user.email}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">
                  Centro de costo por defecto
                </span>
                <select
                  value={createForm.defaultCostCenterId}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      defaultCostCenterId: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin centro de costo</option>
                  {costCenters
                    .filter((costCenter) => costCenter.is_active)
                    .map((costCenter) => (
                      <option key={costCenter.id} value={costCenter.id}>
                        {costCenter.numero_centro_costo} —{" "}
                        {costCenter.nombre_centro_costo}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <PermissionCheckboxes
                form={createForm}
                onChange={(patch) =>
                  setCreateForm((form) => ({ ...form, ...patch }))
                }
              />
            </div>

            {createError && (
              <p className="mt-4 text-sm font-medium text-red-600">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={creating}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Invitando..." : "Invitar usuario"}
            </button>
          </form>
        )}

        <div className="mt-4 rounded-2xl bg-white shadow-sm">
          {usersLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando usuarios...</p>
          ) : usersError ? (
            <p className="p-6 text-sm font-medium text-red-600">{usersError}</p>
          ) : users.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Todavía no hay usuarios en esta empresa.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {users.map((user) => (
                <div key={user.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {user.full_name || user.email}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {user.email} · {ROLE_LABELS[user.role]} ·{" "}
                        {AUTH_PROVIDER_LABELS[user.auth_provider]}
                        {(() => {
                          const costCenter = costCenters.find(
                            (candidate) =>
                              candidate.id === user.default_cost_center_id
                          );
                          return costCenter
                            ? ` · CC ${costCenter.numero_centro_costo}`
                            : "";
                        })()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          user.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {user.is_active ? "Activo" : "Inactivo"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          editingId === user.id
                            ? setEditingId(null)
                            : startEdit(user)
                        }
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        {editingId === user.id ? "Cerrar" : "Editar"}
                      </button>
                    </div>
                  </div>

                  {editingId === user.id && (
                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">
                            Nombre completo
                          </span>
                          <input
                            type="text"
                            value={editForm.fullName}
                            onChange={(event) =>
                              setEditForm((form) => ({
                                ...form,
                                fullName: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">Rol</span>
                          <select
                            value={editForm.role}
                            onChange={(event) =>
                              setEditForm((form) => ({
                                ...form,
                                role: event.target.value as ProfileRole,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            {(Object.keys(ROLE_LABELS) as ProfileRole[]).map(
                              (role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              )
                            )}
                          </select>
                        </label>

                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">
                            Supervisor
                          </span>
                          <select
                            value={editForm.supervisorId}
                            onChange={(event) =>
                              setEditForm((form) => ({
                                ...form,
                                supervisorId: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">Sin supervisor</option>
                            {users
                              .filter(
                                (candidate) =>
                                  candidate.is_active &&
                                  candidate.id !== user.id
                              )
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.full_name || candidate.email}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">
                            Centro de costo por defecto
                          </span>
                          <select
                            value={editForm.defaultCostCenterId}
                            onChange={(event) =>
                              setEditForm((form) => ({
                                ...form,
                                defaultCostCenterId: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">Sin centro de costo</option>
                            {costCenters
                              .filter((costCenter) => costCenter.is_active)
                              .map((costCenter) => (
                                <option key={costCenter.id} value={costCenter.id}>
                                  {costCenter.numero_centro_costo} —{" "}
                                  {costCenter.nombre_centro_costo}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={editForm.isActive}
                            onChange={(event) =>
                              setEditForm((form) => ({
                                ...form,
                                isActive: event.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Usuario activo
                        </label>
                      </div>

                      <div className="mt-4">
                        <PermissionCheckboxes
                          form={editForm}
                          onChange={(patch) =>
                            setEditForm((form) => ({ ...form, ...patch }))
                          }
                        />
                      </div>

                      {editError && (
                        <p className="mt-4 text-sm font-medium text-red-600">
                          {editError}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => handleSaveEdit(user.id)}
                        disabled={savingEdit}
                        className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingEdit ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {staff && (
          <p className="mt-6 text-xs text-slate-400">
            Conectado como {staff.email}
          </p>
        )}
      </div>
    </main>
  );
}
