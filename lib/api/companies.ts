import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getEnvironmentServiceClient,
  EnvironmentNotConfiguredError,
} from "@/lib/supabase/environments-server";
import type { RendixClientEnvironment } from "@/lib/environments";

export type RegisteredCompany = {
  id: string;
  environment: RendixClientEnvironment;
  remote_company_id: string;
  name: string;
};

// Resuelve una empresa por su id de REGISTRO interno (client_companies.id,
// el que usan las URLs de esta backend) al entorno + id real que necesita
// cualquier ruta que tenga que leer o escribir en el proyecto de Supabase
// del cliente.
export async function getRegisteredCompany(
  id: string
): Promise<RegisteredCompany | null> {
  const { data, error } = await supabaseAdmin
    .from("client_companies")
    .select("id, environment, remote_company_id, name")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as RegisteredCompany;
}

// Envuelve getEnvironmentServiceClient con la respuesta 400 estándar de
// esta backend cuando el entorno todavía no tiene credenciales — para no
// repetir el mismo try/catch en cada ruta que necesita escribir en el
// entorno de un cliente.
export function resolveEnvironmentClient(
  environment: RendixClientEnvironment
): { client: SupabaseClient } | { response: NextResponse } {
  try {
    return { client: getEnvironmentServiceClient(environment) };
  } catch (error) {
    if (error instanceof EnvironmentNotConfiguredError) {
      return {
        response: NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
        ),
      };
    }
    throw error;
  }
}
