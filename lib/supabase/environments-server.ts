import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RendixClientEnvironment } from "@/lib/environments";

// Devuelve un cliente de Supabase con la service role key del entorno
// CLIENTE elegido (production/presales/testing/development), para que las
// rutas /api de esta backend puedan dar de alta o editar empresas/usuarios
// ahí. Server-only: nunca importar desde código que corra en el browser.
const ENV_VAR_PREFIX: Record<RendixClientEnvironment, string> = {
  production: "RENDIX_PRODUCTION",
  presales: "RENDIX_PRESALES",
  testing: "RENDIX_TESTING",
  development: "RENDIX_DEVELOPMENT",
};

// Se tira este error específico (en vez de dejar que createClient falle
// con un mensaje críptico de URL inválida) cuando un entorno todavía no
// tiene sus variables RENDIX_{ENTORNO}_SUPABASE_URL /
// ..._SERVICE_ROLE_KEY cargadas en .env.local — hoy eso pasa con los 3
// entornos que todavía no existen (production/presales/testing).
export class EnvironmentNotConfiguredError extends Error {
  constructor(environment: RendixClientEnvironment) {
    super(
      `El entorno "${environment}" todavía no tiene credenciales configuradas en esta backend.`
    );
    this.name = "EnvironmentNotConfiguredError";
  }
}

export function getEnvironmentServiceClient(
  environment: RendixClientEnvironment
): SupabaseClient {
  const prefix = ENV_VAR_PREFIX[environment];
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const serviceRoleKey = process.env[`${prefix}_SERVICE_ROLE_KEY`];

  if (!url || !serviceRoleKey) {
    throw new EnvironmentNotConfiguredError(environment);
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
