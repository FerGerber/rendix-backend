import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

// Errores que ocurren en el navegador de quien usa el panel.
Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
