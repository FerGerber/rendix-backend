"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";

// Esta backend es SOLO para el equipo de Rendix (no para clientes ni
// empleados de clientes). El login es únicamente con Google, restringido al
// dominio de Workspace de Rendix vía el parámetro "hd" — eso mejora la
// experiencia (Google ni siquiera muestra cuentas de otro dominio en el
// selector), pero NO alcanza como control de seguridad real: alguien podría
// manipular la URL y saltearlo. El control real pasa por la tabla
// staff_users, que se chequea recién al entrar al dashboard (ver
// app/dashboard/page.tsx) — el mismo patrón "autenticación + autorización
// separadas" que ya usa Rendix con la tabla profiles.
const STAFF_GOOGLE_WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_STAFF_GOOGLE_WORKSPACE_DOMAIN;

function getOAuthErrorMessage(description: string | null) {
  const text = (description || "").toLowerCase();
  if (text.includes("access_denied") || text.includes("cancel")) {
    return "Se canceló el inicio de sesión.";
  }
  return "No se pudo iniciar sesión con esa cuenta.";
}

export default function LoginPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );
    const errorCode = searchParams.get("error") || hashParams.get("error");
    const errorDescription =
      searchParams.get("error_description") ||
      hashParams.get("error_description");

    if (errorCode) {
      setError(getOAuthErrorMessage(errorDescription));
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.location.href = `${window.location.origin}/dashboard`;
      }
    });
  }, []);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login`,
        // "hd" (hosted domain) le pide a Google que solo ofrezca cuentas de
        // ese dominio de Workspace. Es solo UX — la autorización real se
        // valida server-side contra staff_users después del login.
        queryParams: STAFF_GOOGLE_WORKSPACE_DOMAIN
          ? { hd: STAFF_GOOGLE_WORKSPACE_DOMAIN }
          : undefined,
      },
    });
  };

  return (
    <main className="flex h-dvh items-center justify-center bg-slate-50 px-6 text-slate-900">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
          Backend interna
        </p>

        <h1 className="mt-3 text-2xl font-bold">Rendix — Equipo</h1>

        <p className="mt-3 text-sm leading-6 text-slate-500">
          Acceso exclusivo para el equipo de Rendix. Si sos usuario de una
          empresa cliente, esta no es tu pantalla de acceso.
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A9.001 9.001 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
            />
          </svg>
          Ingresar con Google
        </button>

        {error && (
          <p className="mt-4 text-sm font-medium text-red-600">{error}</p>
        )}
      </div>
    </main>
  );
}
