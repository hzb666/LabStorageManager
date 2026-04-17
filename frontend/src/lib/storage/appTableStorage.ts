import {
  isRecord,
  parseJson,
  readLocalStorageItem,
  writeLocalStorageItem,
} from './localStorageCore'
import {
  DEFAULT_SEARCH_MATCH_MODE,
  SEARCH_MATCH_MODES,
  type SearchMatchMode,
} from '../searchMatchMode'

const APP_TABLE_STORAGE_KEY = 'app-table'

export type ExpandStatus = 'expanded' | 'collapsed'

export type TableUIState = {
  expandAll?: ExpandStatus
  fuzzySearch?: boolean
  matchMode?: SearchMatchMode
}

export type TableColumnSizing = Record<string, number>

export type AppTableStorage = {
  version: number
  uiState: Record<string, TableUIState>
  columnSizing: Record<string, TableColumnSizing>
}

const DEFAULT_APP_TABLE_STORAGE: AppTableStorage = {
  version: 1,
  uiState: {},
  columnSizing: {},
}

let isUiStateWriteLocked = false

function withUiStateWriteLock<T>(operation: () => T): T {
  if (isUiStateWriteLocked) {
    return operation()
  }

  isUiStateWriteLocked = true
  try {
    return operation()
  } finally {
    isUiStateWriteLocked = false
  }
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true
  }
  if (value === false || value === 'false') {
    return false
  }
  return undefined
}

function normalizeExpandStatus(value: unknown): ExpandStatus | undefined {
  if (value === 'expanded' || value === true || value === 'true') {
    return 'expanded'
  }
  if (value === 'collapsed' || value === false || value === 'false') {
    return 'collapsed'
  }
  return undefined
}

function normalizeMatchMode(value: unknown): SearchMatchMode | undefined {
  if (value === SEARCH_MATCH_MODES.CONTAINS || value === SEARCH_MATCH_MODES.EXACT) {
    return value
  }
  return undefined
}

function normalizeTableUIState(value: unknown): TableUIState {
  if (!isRecord(value)) {
    return {}
  }

  return {
    expandAll: normalizeExpandStatus(value.expandAll),
    fuzzySearch: normalizeBoolean(value.fuzzySearch),
    matchMode: normalizeMatchMode(value.matchMode),
  }
}

function normalizeTableUIStateMap(value: unknown): Record<string, TableUIState> {
  if (!isRecord(value)) {
    return {}
  }

  const next: Record<string, TableUIState> = {}
  for (const [tableId, tableState] of Object.entries(value)) {
    next[tableId] = normalizeTableUIState(tableState)
  }
  return next
}

function normalizeSizingValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return value
}

function normalizeTableColumnSizing(value: unknown): TableColumnSizing {
  if (!isRecord(value)) {
    return {}
  }

  const next: TableColumnSizing = {}
  for (const [columnId, width] of Object.entries(value)) {
    const normalized = normalizeSizingValue(width)
    if (normalized !== undefined) {
      next[columnId] = normalized
    }
  }
  return next
}

function normalizeTableColumnSizingMap(value: unknown): Record<string, TableColumnSizing> {
  if (!isRecord(value)) {
    return {}
  }

  const next: Record<string, TableColumnSizing> = {}
  for (const [tableId, sizing] of Object.entries(value)) {
    next[tableId] = normalizeTableColumnSizing(sizing)
  }
  return next
}

function normalizeAppTableStorage(raw: unknown): AppTableStorage {
  if (!isRecord(raw)) {
    return { ...DEFAULT_APP_TABLE_STORAGE }
  }

  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    uiState: normalizeTableUIStateMap(raw.uiState),
    columnSizing: normalizeTableColumnSizingMap(raw.columnSizing),
  }
}

function readAppTableStorageRaw(): AppTableStorage {
  const parsed = parseJson<unknown>(readLocalStorageItem(APP_TABLE_STORAGE_KEY), DEFAULT_APP_TABLE_STORAGE)
  return normalizeAppTableStorage(parsed)
}

export function getAppTable(): AppTableStorage {
  return readAppTableStorageRaw()
}

export function setAppTable(next: AppTableStorage): boolean {
  const normalized = normalizeAppTableStorage(next)
  return writeLocalStorageItem(APP_TABLE_STORAGE_KEY, JSON.stringify(normalized))
}

export function updateAppTable(updater: (current: AppTableStorage) => AppTableStorage): boolean {
  const current = getAppTable()
  const next = normalizeAppTableStorage(updater(current))
  return setAppTable(next)
}

export function getTableUIState(tableId: string): TableUIState {
  const state = getAppTable().uiState[tableId]
  return normalizeTableUIState(state)
}

export function setTableUIState(tableId: string, partial: Partial<TableUIState>): void {
  withUiStateWriteLock(() => {
    updateAppTable((current) => {
      const previous = normalizeTableUIState(current.uiState[tableId])
      const nextState = normalizeTableUIState({
        ...previous,
        ...partial,
      })
      return {
        ...current,
        uiState: {
          ...current.uiState,
          [tableId]: nextState,
        },
      }
    })
  })
}

export function getTableColumnSizing(tableId: string): TableColumnSizing {
  return normalizeTableColumnSizing(getAppTable().columnSizing[tableId])
}

export function setTableColumnSizing(tableId: string, sizing: TableColumnSizing): void {
  const normalized = normalizeTableColumnSizing(sizing)
  updateAppTable((current) => ({
    ...current,
    columnSizing: {
      ...current.columnSizing,
      [tableId]: normalized,
    },
  }))
}

function expandStatusToBoolean(value: ExpandStatus | undefined): boolean | undefined {
  if (value === 'expanded') {
    return true
  }
  if (value === 'collapsed') {
    return false
  }
  return undefined
}

export function getExpandAllState(tableId: string, defaultValue = false): boolean {
  if (globalThis.window === undefined) return defaultValue

  try {
    const current = getTableUIState(tableId)
    const normalized = expandStatusToBoolean(current.expandAll)
    if (normalized !== undefined) {
      return normalized
    }
  } catch {
    // 读取偏好失败时回退默认值，别让存储异常影响表格交互。
  }

  return defaultValue
}

export function setExpandAllState(tableId: string, isExpanded: boolean): void {
  if (globalThis.window === undefined) return

  try {
    setTableUIState(tableId, {
      expandAll: isExpanded ? 'expanded' : 'collapsed',
    })
  } catch {
    // 持久化失败不影响当前 UI 切换。
  }
}

export function getFuzzySearchState(tableId: string, defaultValue = false): boolean {
  if (globalThis.window === undefined) return defaultValue

  try {
    const current = getTableUIState(tableId)
    if (typeof current.fuzzySearch === 'boolean') {
      return current.fuzzySearch
    }
  } catch {
    // 模糊搜索偏好读取失败时回退默认值。
  }

  return defaultValue
}

export function setFuzzySearchState(tableId: string, fuzzySearch: boolean): void {
  if (globalThis.window === undefined) return

  try {
    setTableUIState(tableId, { fuzzySearch })
  } catch {
    // 持久化失败不阻断当前筛选行为。
  }
}

export function getSearchMatchModeState(
  tableId: string,
  defaultValue = DEFAULT_SEARCH_MATCH_MODE,
): SearchMatchMode {
  if (globalThis.window === undefined) return defaultValue

  try {
    const current = getTableUIState(tableId)
    if (current.matchMode) {
      return current.matchMode
    }
  } catch {
    // 匹配模式偏好读取失败时回退默认值。
  }

  return defaultValue
}

export function setSearchMatchModeState(tableId: string, matchMode: SearchMatchMode): void {
  if (globalThis.window === undefined) return

  try {
    setTableUIState(tableId, { matchMode })
  } catch {
    // 持久化失败不阻断当前筛选行为。
  }
}
