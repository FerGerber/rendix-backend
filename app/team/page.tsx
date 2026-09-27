"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";

type StaffRow = {
  staff_id: string;
  id: string | null;
  email: string;
  full_name: string | null;
  is_active: boolean;
  can_manage_staff: boolean;
  invited_at: string | null;
  created_at: string;
};

export default function TeamPage() {
  const { loading, accessDenied, staff } = useStaffSession();

  const [team, setTeam] = useState<StaffRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState("");
  const teamLoadedOnceRef = useRef(false);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  const loadTeam = async () => {
    if (!teamLoadedOnceRef.current) {
      setTeamLoading(true);
    }
    setTeamError("");
    try {
      const response = await authenticatedFetch("/api/staff");
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo cargar el equipo.");
      }
      setTeam(result.staff);
      teamLoadedOnceRef.current = true;
    } catch (error) {
      setTeamError(
        error instanceof Error ? error.message : "No se pudo cargar el equipo."
      );
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied) {
      loadTeam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied]);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const response = await authenticatedFetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo invitar a la persona.");
      }
      setEmail("");
      setFullName("");
      setShowForm(false);
      await loadTeam();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No se pudo invitar a la persona."
      );
    } finally {
      setSaving(false);
    }
  };

  const updateMember = async (
    member: StaffRow,
    updates: { is_active?: boolean; can_manage_staff?: boolean }
  ) => {
    setUpdatingId(member.staff_id);
    setRowError("");
    try {
      const response = await authenticatedFetch(`/api/staff/${member.staff_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo actualizar.");
      }
      await loadTeam();
    } catch (error) {
      setRowError(
        error instanceof Error ? error.message : "No se pudo actualizar."
      );
    } finally {
      setUpdatingId(null);
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

  const canManage = Boolean(staff?.can_manage_staff);

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver
        </Link>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
              Backend interna
            </p>
            <h1 className="mt-1 text-3xl font-bold">Equipo</h1>
            <p className="mt-1 text-sm text-slate-500">
              Quién tiene acceso a esta backend interna.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              {showForm ? "Cancelar" : "+ Invitar a alguien"}
            </button>
          )}
        </div>

        {showForm && canManage && (
          <form
            onSubmit={handleInvite}
            className="mt-6 rounded-2xl bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-bold">Invitar a alguien</h2>
            <p className="mt-1 text-sm text-slate-500">
              Se guarda el mail ya mismo. La persona queda habilitada la
              primera vez que entra con Google usando ese mismo mail — no
              hace falta que tenga cuenta todavía.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Mail *</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Nombre (opcional)
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            {formError && (
              <p className="mt-4 text-sm font-medium text-red-600">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Invitando..." : "Invitar"}
            </button>
          </form>
        )}

        <div className="mt-6 rounded-2xl bg-white shadow-sm">
          {teamLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando equipo...</p>
          ) : teamError ? (
            <p className="p-6 text-sm font-medium text-red-600">{teamError}</p>
          ) : team.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Todavía no hay nadie cargado.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {team.map((member) => {
                const isSelf = member.staff_id === staff?.staff_id;
                const isPending = !member.id;
                return (
                  <div
                    key={member.staff_id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {member.full_name || member.email}
                        {isSelf ? " (vos)" : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {member.email}
                        {isPending ? " · Invitación pendiente" : ""}
                        {member.can_manage_staff ? " · Gestiona el equipo" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          member.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {member.is_active ? "Activo" : "Inactivo"}
                      </span>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            disabled={
                              updatingId === member.staff_id ||
                              (isSelf && member.is_active)
                            }
                            onClick={() =>
                              updateMember(member, {
                                is_active: !member.is_active,
                              })
                            }
                            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            {member.is_active ? "Desactivar" : "Activar"}
                          </button>
                          <button
                            type="button"
                            disabled={
                              updatingId === member.staff_id ||
                              (isSelf && member.can_manage_staff)
                            }
                            onClick={() =>
                              updateMember(member, {
                                can_manage_staff: !member.can_manage_staff,
                              })
                            }
                            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            {member.can_manage_staff
                              ? "Sacar gestión"
                              : "Dar gestión"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {rowError && (
          <p className="mt-3 text-sm font-medium text-red-600">{rowError}</p>
        )}

        {staff && (
          <p className="mt-6 text-xs text-slate-400">
            Conectado como {staff.email}
          </p>
        )}
      </div>
    </main>
  );
}
