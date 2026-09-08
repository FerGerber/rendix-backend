"use client";

import Link from "next/link";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  RENDIX_CLIENT_ENVIRONMENT_LABELS,
} from "@/lib/environments";

export default function DashboardPage() {
  const { loading, accessDenied, staff } = useStaffSession();

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

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {RENDIX_CLIENT_ENVIRONMENTS.map((env) => (
              <div
                key={env}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm"
              >
                {RENDIX_CLIENT_ENVIRONMENT_LABELS[env]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
