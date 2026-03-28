import type { QueryClient } from '@tanstack/react-query'

import { buildBackendUrl } from '@/lib/apiConfig'
import {
  AUTH_NOTICE_KEY,
  CACHE_VERSION_RESET_NOTICE,
  CACHE_VERSION_STORAGE_KEY,
} from '@/lib/constants'
import { disconnectAllSSEConnections } from '@/lib/sseRuntime'
import { useSSEStore } from '@/store/sseStore'

type RuntimeCacheVersionResponse = {
  cache_version?: unknown
}

type CacheVersionBootstrapResult = {
  redirected: boolean
}

const CACHE_VERSION_FETCH_TIMEOUT_MS = 500

function readStoredCacheVersion(): string | null {
  try {
    const stored = globalThis.localStorage.getItem(CACHE_VERSION_STORAGE_KEY)?.trim()
    return stored || null
  } catch {
    return null
  }
}

function persistCacheVersion(version: string): void {
  try {
    globalThis.localStorage.setItem(CACHE_VERSION_STORAGE_KEY, version)
  } catch {
    // ignore storage errors
  }
}

function persistInvalidationNotice(): void {
  try {
    globalThis.sessionStorage.setItem(AUTH_NOTICE_KEY, CACHE_VERSION_RESET_NOTICE)
  } catch {
    // ignore storage errors
  }
}

async function fetchRuntimeCacheVersion(): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException('Cache version probe timed out', 'TimeoutError'))
  }, CACHE_VERSION_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(buildBackendUrl('/api/runtime/cache-version'), {
      cache: 'no-store',
      credentials: 'include',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch runtime cache version: ${response.status}`)
    }

    const data = (await response.json()) as RuntimeCacheVersionResponse
    const cacheVersion =
      typeof data.cache_version === 'string'
        ? data.cache_version.trim()
        : ''

    return cacheVersion || null
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function clearCacheStorage(): Promise<void> {
  if (!('caches' in globalThis)) {
    return
  }

  const cacheKeys = await globalThis.caches.keys()
  await Promise.allSettled(cacheKeys.map((key) => globalThis.caches.delete(key)))
}

async function clearIndexedDb(): Promise<void> {
  if (!('indexedDB' in globalThis) || typeof globalThis.indexedDB.databases !== 'function') {
    return
  }

  const databases = await globalThis.indexedDB.databases()
  const deleteJobs = databases
    .map((database) => database.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => new Promise<void>((resolve) => {
      const request = globalThis.indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    }))

  await Promise.allSettled(deleteJobs)
}

async function hasPersistentClientState(): Promise<boolean> {
  try {
    if (globalThis.localStorage.length > 0 || globalThis.sessionStorage.length > 0) {
      return true
    }
  } catch {
    return true
  }

  if ('caches' in globalThis) {
    const cacheKeys = await globalThis.caches.keys()
    if (cacheKeys.length > 0) {
      return true
    }
  }

  if ('indexedDB' in globalThis && typeof globalThis.indexedDB.databases === 'function') {
    const databases = await globalThis.indexedDB.databases()
    if (databases.some((database) => Boolean(database.name))) {
      return true
    }
  }

  return false
}

async function requestBackendLogout(): Promise<void> {
  try {
    await fetch(buildBackendUrl('/api/users/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch {
    // ignore network errors; backend startup reset already invalidates old sessions
  }
}

async function clearClientState(queryClient: QueryClient): Promise<void> {
  disconnectAllSSEConnections()
  useSSEStore.getState().reset()
  queryClient.clear()
  await requestBackendLogout()

  try {
    globalThis.localStorage.clear()
  } catch {
    // ignore storage errors
  }

  try {
    globalThis.sessionStorage.clear()
  } catch {
    // ignore storage errors
  }

  await Promise.allSettled([
    clearCacheStorage(),
    clearIndexedDb(),
  ])
}

export async function bootstrapCacheVersion(queryClient: QueryClient): Promise<CacheVersionBootstrapResult> {
  let currentCacheVersion: string | null = null

  try {
    currentCacheVersion = await fetchRuntimeCacheVersion()
  } catch (error) {
    console.error('Cache version bootstrap failed:', error)
    return { redirected: false }
  }

  if (!currentCacheVersion) {
    return { redirected: false }
  }

  const storedCacheVersion = readStoredCacheVersion()
  if (storedCacheVersion === currentCacheVersion) {
    persistCacheVersion(currentCacheVersion)
    return { redirected: false }
  }

  const hasStoredState = storedCacheVersion !== null || await hasPersistentClientState()
  if (!hasStoredState) {
    persistCacheVersion(currentCacheVersion)
    return { redirected: false }
  }

  await clearClientState(queryClient)
  persistCacheVersion(currentCacheVersion)
  persistInvalidationNotice()

  if (globalThis.location.pathname !== '/login') {
    globalThis.location.replace('/login')
    return { redirected: true }
  }

  return { redirected: false }
}
