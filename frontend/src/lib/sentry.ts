import * as Sentry from '@sentry/react'

import { getBackendOrigin } from '@/lib/apiConfig'

const DEFAULT_TRACES_SAMPLE_RATE = 0.05
const DEFAULT_REPLAYS_SESSION_SAMPLE_RATE = 0
const DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE = 0

function parseSampleRate(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(Math.max(parsed, 0), 1)
}

function getOptionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function initSentry(): void {
  const dsn = getOptionalEnv(import.meta.env.VITE_SENTRY_DSN)
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: getOptionalEnv(import.meta.env.VITE_SENTRY_ENVIRONMENT) ?? import.meta.env.MODE,
    release: getOptionalEnv(import.meta.env.VITE_SENTRY_RELEASE),
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      DEFAULT_TRACES_SAMPLE_RATE,
    ),
    replaysSessionSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
      DEFAULT_REPLAYS_SESSION_SAMPLE_RATE,
    ),
    replaysOnErrorSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
      DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
    ),
    tracePropagationTargets: [
      /^\//,
      getBackendOrigin(),
    ],
  })
}
