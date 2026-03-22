const TABLE_UI_STORAGE_KEY = 'table-ui-state'
const TABLE_UI_STORAGE_LOCK_KEY = `${TABLE_UI_STORAGE_KEY}:lock`
const TABLE_UI_STORAGE_LOCK_TIMEOUT_MS = 120
const TABLE_UI_STORAGE_LOCK_TTL_MS = 300

type ExpandStatus = 'expanded' | 'collapsed'
type TableUIState = {
  expandAll?: ExpandStatus
  fuzzySearch?: boolean
}
type TableUIStateMap = Record<string, TableUIState>
type TableUIStorage = {
  version: number
  tables: TableUIStateMap
}
type StorageLock = {
  token: string
  expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseTableUIStorage(raw: string | null): TableUIStorage {
  if (!raw) return { version: 0, tables: {} }

  try {
    const parsed = JSON.parse(raw)
    if (isRecord(parsed) && typeof parsed.version === 'number' && isRecord(parsed.tables)) {
      return {
        version: parsed.version,
        tables: parsed.tables as TableUIStateMap,
      }
    }

    if (isRecord(parsed)) {
      // backward compatibility: old format is a plain state map object
      return {
        version: 0,
        tables: parsed as TableUIStateMap,
      }
    }
  } catch {
    // ignore localStorage/JSON errors
  }

  return { version: 0, tables: {} }
}

function readTableUIStorage(): TableUIStorage {
  try {
    return parseTableUIStorage(localStorage.getItem(TABLE_UI_STORAGE_KEY))
  } catch {
    return { version: 0, tables: {} }
  }
}

function parseStorageLock(raw: string | null): StorageLock | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (isRecord(parsed) && typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number') {
      return { token: parsed.token, expiresAt: parsed.expiresAt }
    }
  } catch {
    // ignore lock parse errors
  }
  return null
}

function acquireStorageLock(): string | null {
  if (globalThis.window === undefined) return null

  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const deadline = Date.now() + TABLE_UI_STORAGE_LOCK_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const currentLock = parseStorageLock(localStorage.getItem(TABLE_UI_STORAGE_LOCK_KEY))
      const now = Date.now()
      if (!currentLock || currentLock.expiresAt <= now) {
        localStorage.setItem(
          TABLE_UI_STORAGE_LOCK_KEY,
          JSON.stringify({
            token,
            expiresAt: now + TABLE_UI_STORAGE_LOCK_TTL_MS,
          })
        )
        const confirmedLock = parseStorageLock(localStorage.getItem(TABLE_UI_STORAGE_LOCK_KEY))
        if (confirmedLock?.token === token) {
          return token
        }
      }
    } catch {
      return null
    }
  }

  return null
}

function releaseStorageLock(token: string | null): void {
  if (!token || globalThis.window === undefined) return

  try {
    const currentLock = parseStorageLock(localStorage.getItem(TABLE_UI_STORAGE_LOCK_KEY))
    if (currentLock?.token === token) {
      localStorage.removeItem(TABLE_UI_STORAGE_LOCK_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

function normalizeExpandValue(value: unknown): boolean | undefined {
  if (value === 'expanded' || value === true || value === 'true') return true
  if (value === 'collapsed' || value === false || value === 'false') return false
  return undefined
}

function normalizeBooleanValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function parseTableState(raw: unknown): TableUIState {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const state = raw as Record<string, unknown>
    const normalizedExpand = normalizeExpandValue(state.expandAll)
    const normalizedFuzzy = normalizeBooleanValue(state.fuzzySearch)
    return {
      expandAll: normalizedExpand === undefined ? undefined : (normalizedExpand ? 'expanded' : 'collapsed'),
      fuzzySearch: normalizedFuzzy,
    }
  }
  return {}
}

function writeTableState(tableKey: string, updater: (current: TableUIState) => TableUIState): void {
  const lockToken = acquireStorageLock()
  try {
    const storage = readTableUIStorage()
    const current = parseTableState(storage.tables[tableKey])
    const next = updater(current)
    const nextStorage: TableUIStorage = {
      version: storage.version + 1,
      tables: {
        ...storage.tables,
        [tableKey]: next,
      },
    }
    localStorage.setItem(TABLE_UI_STORAGE_KEY, JSON.stringify(nextStorage))
  } finally {
    releaseStorageLock(lockToken)
  }
}

export function getExpandAllState(
  tableKey: string,
  defaultValue = false
): boolean {
  if (globalThis.window === undefined) return defaultValue

  try {
    const stateMap = readTableUIStorage().tables
    const current = parseTableState(stateMap[tableKey])
    const mapValue = normalizeExpandValue(current.expandAll)
    if (mapValue !== undefined) return mapValue
  } catch {
    // ignore localStorage errors
  }

  return defaultValue
}

export function setExpandAllState(tableKey: string, isExpanded: boolean): void {
  if (globalThis.window === undefined) return

  try {
    writeTableState(tableKey, (current) => ({
      ...current,
      expandAll: isExpanded ? 'expanded' : 'collapsed',
    }))
  } catch {
    // ignore localStorage errors
  }
}

export function getFuzzySearchState(tableKey: string, defaultValue = false): boolean {
  if (globalThis.window === undefined) return defaultValue

  try {
    const stateMap = readTableUIStorage().tables
    const current = parseTableState(stateMap[tableKey])
    const mapValue = normalizeBooleanValue(current.fuzzySearch)
    if (mapValue !== undefined) return mapValue
  } catch {
    // ignore localStorage errors
  }

  return defaultValue
}

export function setFuzzySearchState(tableKey: string, fuzzySearch: boolean): void {
  if (globalThis.window === undefined) return

  try {
    writeTableState(tableKey, (current) => ({
      ...current,
      fuzzySearch,
    }))
  } catch {
    // ignore localStorage errors
  }
}
