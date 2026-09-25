"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";

type CompanyStatsRow = {
  id: string;
  name: string;
  environment: string;
  environment_label: string;
  is_active: boolean;
  users_total: number | null;
  users_active: number | null;
  environment_configured: boolean;
};

type DashboardStats = {
  companies: { total: number; active: number; inactive: number };
  users: { total: number; active: number };
  companies_detail: CompanyStatsRow[];
  environments_pending: boolean;
};

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { loading, accessDenied, staff } = useStaffSession();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    if (loading || accessDenied) return;

    let cancelled = false;

    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError("");
      try {
        const response = await authenticatedFetch("/api/dashboard/stats");
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "No se pudieron cargar las estadísticas."
          );
        }
        if (!cancelled) setStats(result);
      } catch (error) {
        if (!cancelled) {
          setStatsError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las estadísticas."
          );
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [loading, accessDenied]);

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
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
          Backend interna
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          Hola, {staff?.full_name || staff?.email}
        </h1>

        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Empresas</h2>
              <p className="mt-1 text-sm text-slate-500">
                Alta y gestión de empresas cliente, por entorno.
              </p>
            </div>
            <Link
              href="/companies"
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Ir a Empresas
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Soporte</h2>
              <p className="mt-1 text-sm text-slate-500">
                Tickets de todas las empresas, bandeja única por última
                actividad.
              </p>
            </div>
            <Link
              href="/support"
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Ir a Soporte
            </Link>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold">Facturación — referencia</h2>
            <p className="text-xs text-slate-400">
              Cantidad de empresas y usuarios, para ubicar a cada empresa en
              su rango de precio.
            </p>
          </div>

          {statsLoading ? (
            <p className="mt-4 text-sm text-slate-500">
              Cargando estadísticas...
            </p>
          ) : statsError ? (
            <p className="mt-4 text-sm font-medium text-red-600">
              {statsError}
            </p>
          ) : stats ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Empresas totales" value={stats.companies.total} />
                <StatTile label="Empresas activas" value={stats.companies.active} />
                <StatTile label="Usuarios totales" value={stats.users.total} />
                <StatTile label="Usuarios activos" value={stats.users.active} />
              </div>

              {stats.environments_pending && (
                <p className="mt-3 text-xs text-slate-400">
                  Algunas empresas viven en entornos que todavía no tienen
                  credenciales cargadas en esta backend — sus usuarios no
                  están incluidos en los totales de arriba (se muestran como
                  &quot;no disponible&quot; en la tabla).
                </p>
              )}

              <div className="mt-6 rounded-2xl bg-white shadow-sm">
                {stats.companies_detail.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500">
                    Todavía no hay empresas cargadas.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stats.companies_detail.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-4"
                      >
                        <div>
                          <Link
                            href={`/companies/${row.id}`}
                            className="font-semibold text-slate-900 hover:underline"
                          >
                            {row.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.environment_label}
                            {!row.is_active ? " · Inactiva" : ""}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          {row.environment_configured ? (
                            <>
                              <p className="font-semibold text-slate-900">
                                {row.users_total} usuario
                                {row.users_total === 1 ? "" : "s"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {row.users_active} activo
                                {row.users_active === 1 ? "" : "s"}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">
                              No disponible
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
