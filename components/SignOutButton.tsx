"use client";

import { supabase } from "@/lib/supabase/client";

// Cierra la sesión de Google (Supabase Auth vive del lado del cliente,
// no hace falta avisarle a ningún endpoint) y vuelve a /login.
export default function SignOutButton() {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="shrink-0 rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-100"
    >
      Cerrar sesión
    </button>
  );
}
