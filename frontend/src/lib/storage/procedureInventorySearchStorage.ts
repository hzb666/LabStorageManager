import type { ProcedureInventorySearchResponse } from '@/api/client'

const STORAGE_KEY_PREFIX = 'procedure-inventory-search:'
let fallbackIdCounter = 0

function createStorageId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  fallbackIdCounter += 1
  return `${Date.now()}-${fallbackIdCounter}`
}

function getStorage(): Storage | null {
  return globalThis.window === undefined ? null : globalThis.sessionStorage
}

export function saveProcedureInventorySearchResult(
  result: ProcedureInventorySearchResponse,
): string {
  const id = createStorageId()
  getStorage()?.setItem(`${STORAGE_KEY_PREFIX}${id}`, JSON.stringify(result))
  return id
}

export function getProcedureInventorySearchResult(
  id: string | null,
): ProcedureInventorySearchResponse | null {
  if (!id) {
    return null
  }
  const raw = getStorage()?.getItem(`${STORAGE_KEY_PREFIX}${id}`)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as ProcedureInventorySearchResponse
  } catch {
    return null
  }
}
