import "server-only";

import type { RendixClientEnvironment } from "@/lib/environments";

// Mismo problema que resolvimos para las credenciales de Supabase en
// lib/supabase/environments-server.ts: esta backend atiende a los 4
// entornos cliente (Producción, Presales, Testing, Desarrollo) desde un
// único deployment, así que una sola variable global (RENDIX_APP_URL) no
// alcanza — un mail generado al dar de alta un usuario de Producción
// terminaba linkeando al sitio de desarrollo porque esa variable global
// nunca se cargó y el código caía al default "dev". Acá cada entorno
// resuelve su propia URL pública, overrideable por variable de entorno
// (RENDIX_{ENTORNO}_APP_URL) sin tocar código si algún dominio cambia.
const DEFAULT_APP_URL: Record<RendixClientEnvironment, string> = {
  production: "https://www.rendixapp.com",
  presales: "https://dev.rendixapp.com",
  testing: "https://dev.rendixapp.com",
  development: "https://dev.rendixapp.com",
};

const ENV_VAR_PREFIX: Record<RendixClientEnvironment, string> = {
  production: "RENDIX_PRODUCTION",
  presales: "RENDIX_PRESALES",
  testing: "RENDIX_TESTING",
  development: "RENDIX_DEVELOPMENT",
};

export function getAppUrl(environment: RendixClientEnvironment): string {
  const prefix = ENV_VAR_PREFIX[environment];
  const override = process.env[`${prefix}_APP_URL`]?.trim();
  return (override || DEFAULT_APP_URL[environment]).replace(/\/$/, "");
}
