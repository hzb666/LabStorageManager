const TABLE_UI_STORAGE_KEY = 'table-ui-state'
const TABLE_UI_STORAGE_LOCK_KEY = `${TABLE_UI_STORAGE_KEY}:lock`
const TABLE_UI_STORAGE_LOCK_TIMEOUT_MS = 120
const TABLE_UI_STORAGE_LOCK_TTL_MS = 300
let fallbackLockCounter = 0

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

/** 判断值是否为普通对象，避免把数组或原始值当作存储快照。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 解析表格 UI 存储快照并兼容旧版本格式。 */
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

/** 读取并解析表格 UI 存储，屏蔽 localStorage 异常。 */
function readTableUIStorage(): TableUIStorage {
  try {
    return parseTableUIStorage(localStorage.getItem(TABLE_UI_STORAGE_KEY))
  } catch {
    return { version: 0, tables: {} }
  }
}

/** 解析锁对象，确保 token 与过期时间字段类型正确。 */
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

/** 生成锁 token，优先使用 Web Crypto，避免伪随机实现。 */
function generateStorageLockToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(8)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  fallbackLockCounter = (fallbackLockCounter + 1) % 0xffff
  return `${Date.now().toString(16)}${fallbackLockCounter.toString(16).padStart(4, '0')}`
}

/** 获取存储写锁；若锁不可用会返回 null，由上层按兼容语义继续写入。 */
function acquireStorageLock(): string | null {
  if (globalThis.window === undefined) return null

  const token = generateStorageLockToken()
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

/** 释放当前进程持有的写锁，避免残留锁影响后续写入。 */
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

/** 归一化“展开态”输入值，兼容历史字符串和布尔值。 */
function normalizeExpandValue(value: unknown): boolean | undefined {
  if (value === 'expanded' || value === true || value === 'true') return true
  if (value === 'collapsed' || value === false || value === 'false') return false
  return undefined
}

/** 归一化布尔输入值，屏蔽字符串化布尔历史数据。 */
function normalizeBooleanValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/** 把布尔展开态转换为存储枚举，去掉内联嵌套三元。 */
function toExpandStatus(value: boolean | undefined): ExpandStatus | undefined {
  if (value === undefined) return undefined
  return value ? 'expanded' : 'collapsed'
}

/** 解析单表 UI 状态并执行字段归一化。 */
function parseTableState(raw: unknown): TableUIState {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const state = raw as Record<string, unknown>
    const normalizedExpand = normalizeExpandValue(state.expandAll)
    const normalizedFuzzy = normalizeBooleanValue(state.fuzzySearch)
    return {
      expandAll: toExpandStatus(normalizedExpand),
      fuzzySearch: normalizedFuzzy,
    }
  }
  return {}
}

/** 以“读-改-写”更新单表 UI 状态；未拿到锁时维持历史兼容行为继续写入。 */
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

/** 读取“展开全部”状态，缺失时回退到调用方默认值。 */
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

/** 写入“展开全部”状态，供表格展开按钮统一持久化。 */
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

/** 读取模糊搜索开关，缺失时回退到调用方默认值。 */
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

/** 持久化模糊搜索开关，保持与展开状态同一存储协议。 */
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
