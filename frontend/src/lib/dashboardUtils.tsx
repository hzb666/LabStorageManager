/** Dashboard 共享工具、类型和常量。 */
import type { ColumnDef } from '@tanstack/react-table'
import { clearDashboardActiveTab } from '@/lib/storage/appUiStorage'

// ============================================================================
// 类型定义
// ============================================================================

export interface MyBorrowItem {
  inventory_id: number
  name: string
  cas_number: string
  remaining_quantity: number
  unit: string
  borrow_time: string
  english_name?: string | null
  alias?: string | null
  created_at?: string | null
  notes?: string | null
  created_by_name?: string | null
  borrower_name?: string | null
  last_borrower_name?: string | null
}

export interface PendingStockinItem {
  inventory_id: number
  order_id?: number | null
  name: string
  cas_number: string
  initial_quantity: number
  unit: string
  stockin_time: string
}

export interface DashboardOrderBase {
  id: number
  name: string
  status: string
  created_at: string
  applicant_id?: number | null
  applicant_name?: string | null
  [key: string]: unknown
}

export interface DashboardReagentOrder extends DashboardOrderBase {
  cas_number: string
  english_name?: string | null
  alias?: string | null
  category?: string | null
  brand?: string | null
  specification?: string
  initial_quantity?: number | null
  unit?: string | null
  quantity: number
  price?: number | null
  order_reason?: string
  is_hazardous?: boolean
  notes?: string | null
}

export interface DashboardConsumableOrder extends DashboardOrderBase {
  english_name?: string | null
  specification?: string
  quantity: number
  price?: number | null
  communication?: string | null
  notes?: string | null
}

export type DashboardParams = {
  skip?: number
  limit?: number
  status_filter?: string
  search?: string
  search_field?: string
  sort_by?: string
  sort_order?: string
  fuzzy?: boolean
}

export type DashboardTab = 'reagents' | 'consumables' | 'borrows' | 'stockin'

// ============================================================================
// 常量
// ============================================================================

const DASHBOARD_COUNTS_REFRESH_EVENT = 'dashboard-counts-refresh'

/** 清除 Dashboard 页签持久化状态。 */
export function clearDashboardTab(): void {
  try {
    clearDashboardActiveTab()
  } catch {
    // 忽略 localStorage 异常
  }
}

export const REAGENT_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '未通过' },
  { value: 'arrived', label: '已到货' },
]

export const CONSUMABLE_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '未通过' },
]

export const DASHBOARD_REAGENT_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'created_at', label: '订购时间' },
]

export const DASHBOARD_CONSUMABLE_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'specification', label: '规格' },
  { value: 'created_at', label: '订购时间' },
]

export const BORROW_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
]

/** 广播仪表盘统计刷新信号。 */
export function requestDashboardCountsRefresh(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(DASHBOARD_COUNTS_REFRESH_EVENT))
}

/** 订阅仪表盘统计刷新信号。 */
export function subscribeDashboardCountsRefresh(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  window.addEventListener(DASHBOARD_COUNTS_REFRESH_EVENT, listener)
  return () => {
    window.removeEventListener(DASHBOARD_COUNTS_REFRESH_EVENT, listener)
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase()
  }
  return ''
}

function parseDateForSort(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }
  const text = String(value).trim()
  if (!text) {
    return null
  }
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? null : timestamp
}

function toPrimitiveString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function sortLocally<T extends Record<string, unknown>>(
  rows: T[],
  sortBy?: string,
  sortOrder?: string
): T[] {
  if (!sortBy) return rows
  const factor = sortOrder === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const aVal = a[sortBy]
    const bVal = b[sortBy]

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * factor
    }

    const aDate = parseDateForSort(aVal)
    const bDate = parseDateForSort(bVal)
    // 保持原有“truthy 才按日期排序”的行为（例如 1970-01-01 对应 0 不进入日期排序）
    if (aDate && bDate) {
      return (aDate - bDate) * factor
    }

    const aText = normalizeValue(aVal)
    const bText = normalizeValue(bVal)
    return aText.localeCompare(bText) * factor
  })
}

export function buildLocalListData<T extends Record<string, unknown>>(
  rows: T[],
  params: DashboardParams,
  defaultSearchFields: string[]
): { data: T[]; total: number } {
  const {
    skip = 0,
    limit = 50,
    status_filter,
    search,
    search_field,
    sort_by,
    sort_order,
  } = params

  let filtered = rows

  if (status_filter && status_filter !== 'all') {
    filtered = filtered.filter((row) => toPrimitiveString(row.status) === status_filter)
  }

  if (search) {
    const keyword = search.toLowerCase()
    filtered = filtered.filter((row) => {
      const fields = search_field && search_field !== 'all' ? [search_field] : defaultSearchFields
      return fields.some((field) => normalizeValue(row[field]).includes(keyword))
    })
  }

  filtered = sortLocally(filtered, sort_by, sort_order)

  const paged = filtered.slice(skip, skip + limit)
  return { data: paged, total: filtered.length }
}

export function flattenGroupedOrders<T extends DashboardOrderBase>(
  grouped: Record<string, { orders: Record<string, unknown>[] }>,
  currentUserId?: number
): T[] {
  return Object.entries(grouped).flatMap(([status, payload]) => {
    const orders = payload?.orders ?? []
    return orders.map((raw) => ({
      ...raw,
      id: Number(raw.order_id ?? raw.id ?? 0),
      status,
      applicant_id: currentUserId ?? null,
    })) as T[]
  })
}

export function removeApplicantColumn(
  columns: ColumnDef<Record<string, unknown>, unknown>[]
): ColumnDef<Record<string, unknown>, unknown>[] {
  return columns.filter((column) => {
    const candidate = column as { id?: string; accessorKey?: string }
    return candidate.id !== 'applicant' && candidate.accessorKey !== 'applicant_name'
  })
}
