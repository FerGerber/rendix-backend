import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

Sentry.init(sentryOptions);
