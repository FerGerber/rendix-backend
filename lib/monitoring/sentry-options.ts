import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// El DSN de Sentry NO es un secreto: está pensado para ir en el código que
// baja al navegador (solo permite enviar eventos, no leerlos).
const SENTRY_DSN =
  "https://2b0a4af268abe20b04a771e877097e5e@o4512195634855936.ingest.de.sentry.io/4512195653861456";

// NEXT_PUBLIC_SENTRY_ENV lo define next.config.ts en el build: "production"
// cuando corre en Vercel y "local" en tu compu (Sentry apagado, para que
// probar o compilar en tu máquina no ensucie el panel con errores falsos).
// Ojo: este backend atiende a los 4 entornos cliente desde un único
// deployment, así que "production" acá significa "el backend desplegado",
// no que el error sea de un cliente de producción.
const SENTRY_ENV = process.env.NEXT_PUBLIC_SENTRY_ENV ?? "local";

// Por las dudas, ninguna URL que viaje a Sentry lleva query string ni
// #hash (pueden contener tokens de sesión o de recuperación).
function stripSensitiveUrl(url: string) {
  return url.split("#")[0].split("?")[0];
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) {
    event.request.url = stripSensitiveUrl(event.request.url);
  }
  if (event.request) {
    delete event.request.query_string;
  }
  return event;
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") {
        data[key] = stripSensitiveUrl(data[key] as string);
      }
    }
  }
  return breadcrumb;
}

export const sentryOptions = {
  dsn: SENTRY_DSN,
  environment: SENTRY_ENV,
  enabled: SENTRY_ENV === "production",
  // Solo errores: sin trazas de performance ni grabación de sesiones.
  tracesSampleRate: 0,
  sendDefaultPii: false,
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
  ],
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};
