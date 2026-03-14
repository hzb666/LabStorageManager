/**
 * Dashboard 共享工具函数、类型定义和常量
 * 纯工具文件，不包含 React 组件（避免 react-refresh/only-export-components 规则冲突）
 */
import type { ColumnDef } from '@tanstack/react-table'

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

export const DASHBOARD_TAB_STORAGE_KEY = 'dashboard-active-tab'

/**
 * 清除 Dashboard Tab 持久化状态
 * 用于退出登录时清理用户特定的状态
 */
export function clearDashboardTab(): void {
  try {
    localStorage.removeItem(DASHBOARD_TAB_STORAGE_KEY)
  } catch {
    // ignore localStorage errors
  }
}

export const REAGENT_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'arrived', label: '已到货' },
]

export const CONSUMABLE_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
]

export const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
]

export const BORROW_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
]

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

    if (Date.parse(String(aVal)) && Date.parse(String(bVal))) {
      return (Date.parse(String(aVal)) - Date.parse(String(bVal))) * factor
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
    filtered = filtered.filter((row) => String(row.status) === status_filter)
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
