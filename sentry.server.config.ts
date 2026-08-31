import * as Sentry from "@sentry/nextjs"
import { maskSentryEvent } from "@/lib/sentryMask"
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  beforeSend: maskSentryEvent,
})
