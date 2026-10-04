import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    // Qué entorno es este build, para etiquetar los errores en Sentry.
    // Fuera de Vercel (tu compu) queda "local" y Sentry se apaga.
    NEXT_PUBLIC_SENTRY_ENV: process.env.VERCEL ? "production" : "local",
  },
};

// Sin SENTRY_AUTH_TOKEN no se suben los source maps (los errores se ven con
// el código minificado). Es un paso opcional posterior.
export default withSentryConfig(nextConfig, {
  org: "fer-gerber-org",
  project: "rendix-backend",
  silent: true,
  telemetry: false,
});
