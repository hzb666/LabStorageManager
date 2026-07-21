import type { ProcedureInventorySearchResponse } from '@/api/client'

const STORAGE_KEY_PREFIX = 'procedure-inventory-search:'
const STORAGE_TTL_MS = 10 * 60 * 1000
let fallbackIdCounter = 0

interface StoredProcedureInventorySearchResult {
  version: 1
  userId: number
  expiresAt: number
  result: ProcedureInventorySearchResponse
}

function createStorageId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  fallbackIdCounter += 1
  return `${Date.now()}-${fallbackIdCounter}`
}

function getStorage(): Storage | null {
  if (globalThis.window === undefined) {
    return null
  }
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseStoredResult(raw: string): StoredProcedureInventorySearchResult | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value)
      || value.version !== 1
      || typeof value.userId !== 'number'
      || typeof value.expiresAt !== 'number'
      || !isRecord(value.result)
    ) {
      return null
    }
    return value as unknown as StoredProcedureInventorySearchResult
  } catch {
    return null
  }
}

function removeStoredResult(storage: Storage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Session storage is an optional handoff cache.
  }
}

export function saveProcedureInventorySearchResult(
  result: ProcedureInventorySearchResponse,
  userId: number,
): string | null {
  const id = createStorageId()
  const storage = getStorage()
  if (!storage) {
    return null
  }
  const value: StoredProcedureInventorySearchResult = {
    version: 1,
    userId,
    expiresAt: Date.now() + STORAGE_TTL_MS,
    result,
  }
  try {
    storage.setItem(`${STORAGE_KEY_PREFIX}${id}`, JSON.stringify(value))
    return id
  } catch {
    return null
  }
}

export function getProcedureInventorySearchResult(
  id: string | null,
  userId: number | null,
): ProcedureInventorySearchResponse | null {
  if (!id || userId === null) {
    return null
  }
  const storage = getStorage()
  const key = `${STORAGE_KEY_PREFIX}${id}`
  let raw: string | null = null
  try {
    raw = storage?.getItem(key) ?? null
  } catch {
    return null
  }
  if (!raw) {
    return null
  }
  const value = parseStoredResult(raw)
  if (!value || value.userId !== userId || value.expiresAt <= Date.now()) {
    if (storage) {
      removeStoredResult(storage, key)
    }
    return null
  }
  return value.result
}

export function clearProcedureInventorySearchResults(): void {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        storage.removeItem(key)
      }
    }
  } catch {
    // Logout must still finish when browser storage is unavailable.
  }
}
