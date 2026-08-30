"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  RENDIX_CLIENT_ENVIRONMENT_LABELS,
} from "../../lib/environments";

type StaffProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [staff, setStaff] = useState<StaffProfile | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        window.location.href = "/login";
        return;
      }

      const { data: staffData, error } = await supabase
        .from("staff_users")
        .select("id, email, full_name, is_active")
        .eq("id", authData.user.id)
        .single();

      if (error || !staffData || !staffData.is_active) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setStaff(staffData);
      setLoading(false);
    };

    load();
  }, []);

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
          <h2 className="text-lg font-bold">Entornos de Rendix</h2>
          <p className="mt-2 text-sm text-slate-500">
            Alta de empresas y usuarios — próximo paso a construir acá.
          </p>

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
