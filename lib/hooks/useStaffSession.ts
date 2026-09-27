"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { authenticatedFetch } from "@/lib/api/client";

export type StaffProfile = {
  staff_id: string;
  id: string;
  email: string;
  full_name: string | null;
  can_manage_staff: boolean;
};

type StaffSessionState = {
  loading: boolean;
  accessDenied: boolean;
  staff: StaffProfile | null;
};

// Hook compartido por todas las pantallas del dashboard: redirige a /login
// si no hay sesión, y chequea si la cuenta está habilitada. Antes hacía
// esto último con un query directo a staff_users desde el cliente (RLS
// solo dejaba leer la propia fila YA linkeada por id) — eso funcionaba
// para el staff de siempre, pero nunca iba a poder linkear una fila
// pendiente (invitada por mail, con id todavía null: RLS exige
// auth.uid() = id). Se pasó a pedirle esto a /api/staff/me, que corre del
// lado del servidor con requireActiveStaff y sí puede linkear esa fila en
// el momento. La protección real de datos sigue pasando por
// requireActiveStaff en cada ruta (lib/api/auth.ts) — esto es solo para no
// mostrar la pantalla a quien no corresponde.
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

      try {
        const response = await authenticatedFetch("/api/staff/me");
        const result = await response.json();

        if (cancelled) return;

        if (!response.ok || !result.success) {
          setState({ loading: false, accessDenied: true, staff: null });
          return;
        }

        setState({ loading: false, accessDenied: false, staff: result.staff });
      } catch {
        if (!cancelled) {
          setState({ loading: false, accessDenied: true, staff: null });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
