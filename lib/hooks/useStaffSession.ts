"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export type StaffProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
};

type StaffSessionState = {
  loading: boolean;
  accessDenied: boolean;
  staff: StaffProfile | null;
};

// Hook compartido por todas las pantallas del dashboard: redirige a /login
// si no hay sesión, y chequea contra staff_users si la cuenta está
// habilitada. Es el mismo chequeo client-side que ya hacía
// app/dashboard/page.tsx, extraído acá para no repetirlo en cada pantalla
// nueva (empresas, usuarios, cuentas contables, etc). La protección real
// de datos sigue pasando por requireActiveStaff del lado del servidor
// (lib/api/auth.ts) — esto es solo para no mostrar la pantalla a quien no
// corresponde.
export function useStaffSession(): StaffSessionState {
  const [state, setState] = useState<StaffSessionState>({
    loading: true,
    accessDenied: false,
    staff: null,
  });

  useEffect(() => {
    let cancelled = false;

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

      if (cancelled) return;

      if (error || !staffData || !staffData.is_active) {
        setState({ loading: false, accessDenied: true, staff: null });
        return;
      }

      setState({ loading: false, accessDenied: false, staff: staffData });
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
