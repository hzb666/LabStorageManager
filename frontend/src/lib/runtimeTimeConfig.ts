export interface RuntimeTimeConfig {
  displayUtcOffset: string
  displayTimeZone: string
}

const RUNTIME_TIME_CONFIG_STORAGE_KEY = 'runtime-time-config'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeRuntimeTimeConfig(value: unknown): RuntimeTimeConfig | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const config = value as {
    displayUtcOffset?: unknown
    displayTimeZone?: unknown
  }

  if (!isNonEmptyString(config.displayUtcOffset) || !isNonEmptyString(config.displayTimeZone)) {
    return null
  }

  return {
    displayUtcOffset: config.displayUtcOffset.trim(),
    displayTimeZone: config.displayTimeZone.trim(),
  }
}

export function readRuntimeTimeConfig(): RuntimeTimeConfig | null {
  try {
    const raw = globalThis.localStorage.getItem(RUNTIME_TIME_CONFIG_STORAGE_KEY)
    if (!raw) {
      return null
    }
    return normalizeRuntimeTimeConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

export function persistRuntimeTimeConfig(config: RuntimeTimeConfig | null): void {
  try {
    if (!config) {
      globalThis.localStorage.removeItem(RUNTIME_TIME_CONFIG_STORAGE_KEY)
      return
    }
    globalThis.localStorage.setItem(RUNTIME_TIME_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 忽略存储异常
  }
}

export function getStoredDisplayUtcOffset(): string | null {
  return readRuntimeTimeConfig()?.displayUtcOffset ?? null
}
