const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim()
  if (configured) {
    return configured
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:8000/api'
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:8000/api'
  }

  return LOCAL_HOSTNAMES.has(window.location.hostname)
    ? 'http://localhost:8000/api'
    : '/api'
}

export function getBackendOrigin(): string {
  const apiBaseUrl = getApiBaseUrl()

  if (isAbsoluteUrl(apiBaseUrl)) {
    return new URL(apiBaseUrl).origin
  }

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return 'http://localhost:8000'
}

export function buildBackendUrl(path: string): string {
  if (!path) return ''
  if (isAbsoluteUrl(path)) return path

  return `${getBackendOrigin()}${path}`
}
