/** Dashboard 共享工具、类型和常量。 */
import type { QueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ConsumableOrderStatus,
  ReagentOrderStatus,
} from '@/api/client'
import type { FilterOption } from '@/hooks/useTableState'
import { clearDashboardActiveTab } from '@/lib/storage/appUiStorage'
import {
  DEFAULT_SEARCH_MATCH_MODE,
  matchesSearchText,
  type SearchMatchMode,
} from '@/lib/searchMatchMode'
import { isAtLeastDisplayNaturalDaysOld } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

export interface MyBorrowItem {
  inventory_id: number
  name: string
  cas_number: string
  storage_location?: string | null
  initial_quantity?: number | null
  specification?: string | null
  remaining_quantity?: number | null
  unit?: string | null
  borrow_time: string
  borrower_id?: number | null
  english_name?: string | null
  alias?: string | null
  created_at?: string | null
  notes?: string | null
  created_by_name?: string | null
  borrower_name?: string | null
  last_borrower_name?: string | null
  borrow_days?: number
  is_overdue?: boolean
}

export interface PendingStockinItem {
  inventory_id: number
  order_id?: number | null
  name: string
  cas_number: string
  english_name?: string | null
  alias?: string | null
  category?: string | null
  brand?: string | null
  purity?: string | null
  specification?: string | null
  initial_quantity: number
  remaining_quantity?: number | null
  unit: string
  is_hazardous?: boolean
  notes?: string | null
  temporary_keeper_id?: number | null
  temporary_keeper_name?: string | null
  stockin_time: string
  stockin_days?: number
  is_overdue?: boolean
}

export interface DashboardOrderBase {
  id: number
  name: string
  status: string
  created_at: string
  updated_at?: string | null
  approved_at?: string | null
  rejected_at?: string | null
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
  remaining_quantity?: number | null
  unit?: string | null
  quantity: number
  price?: number | null
  order_reason?: string
  is_hazardous?: boolean
  notes?: string | null
  arrived_at?: string | null
  stocked_at?: string | null
}

export interface DashboardConsumableOrder extends DashboardOrderBase {
  english_name?: string | null
  specification?: string
  quantity: number
  price?: number | null
  communication?: string | null
  notes?: string | null
  completed_at?: string | null
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
  match_mode?: SearchMatchMode
}

export type DashboardTab = 'reagents' | 'consumables' | 'borrows' | 'stockin'

// ============================================================================
// 常量
// ============================================================================

const DASHBOARD_COUNTS_REFRESH_EVENT = 'dashboard-counts-refresh'
const PENDING_APPROVAL_STATUSES = new Set<string>([
  ReagentOrderStatus.PENDING,
  ConsumableOrderStatus.PENDING,
])

export const PENDING_ORDER_ALERT_DAYS = 2
export const PENDING_STOCKIN_ALERT_DAYS = 7
export const APPROVED_ORDER_ALERT_DAYS = 3

export type DashboardAlertTone = 'destructive' | 'warning'

const DASHBOARD_ALERT_BADGE_BASE_CLASS =
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-normal'

export function getDashboardAlertBadgeClassName(
  tone: DashboardAlertTone = 'destructive'
): string {
  if (tone === 'warning') {
    return `${DASHBOARD_ALERT_BADGE_BASE_CLASS} bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300`
  }
  return `${DASHBOARD_ALERT_BADGE_BASE_CLASS} bg-destructive/10 text-destructive`
}

function isDateOlderThanDays(dateText: string | null | undefined, days: number): boolean {
  if (!dateText) {
    return false
  }
  return isAtLeastDisplayNaturalDaysOld(dateText, days)
}

export function isPendingApprovalOverdue(
  status: unknown,
  updatedAt: string | null | undefined
): boolean {
  return typeof status === 'string'
    && PENDING_APPROVAL_STATUSES.has(status)
    && isDateOlderThanDays(updatedAt, PENDING_ORDER_ALERT_DAYS)
}

export function isPendingStockinOverdue(stockinTime: string | null | undefined): boolean {
  return isDateOlderThanDays(stockinTime, PENDING_STOCKIN_ALERT_DAYS)
}

export function isApprovedOrderOverdue(
  status: unknown,
  updatedAt: string | null | undefined
): boolean {
  return status === ReagentOrderStatus.APPROVED
    && isDateOlderThanDays(updatedAt, APPROVED_ORDER_ALERT_DAYS)
}

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
]

export const CONSUMABLE_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '未通过' },
]

export const DASHBOARD_EMPTY_STATUS_OPTIONS: FilterOption[] = []

export const DASHBOARD_REAGENT_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'created_at', label: '订购时间' },
]

export const DASHBOARD_REAGENT_ADMIN_SEARCH_FIELDS = [
  ...DASHBOARD_REAGENT_SEARCH_FIELDS,
  { value: 'applicant_name', label: '订购人' },
]

export const DASHBOARD_CONSUMABLE_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'specification', label: '规格' },
  { value: 'created_at', label: '订购时间' },
]

export const DASHBOARD_CONSUMABLE_ADMIN_SEARCH_FIELDS = [
  ...DASHBOARD_CONSUMABLE_SEARCH_FIELDS,
  { value: 'applicant_name', label: '订购人' },
]

export const BORROW_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
]

export const ADMIN_BORROW_SEARCH_FIELDS = [
  ...BORROW_SEARCH_FIELDS,
  { value: 'borrower_name', label: '借用人' },
]

export const ADMIN_STOCKIN_SEARCH_FIELDS = [
  ...BORROW_SEARCH_FIELDS,
  { value: 'temporary_keeper_name', label: '暂存人' },
]

/** 广播仪表盘统计刷新信号。 */
export function requestDashboardCountsRefresh(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(DASHBOARD_COUNTS_REFRESH_EVENT))
}

/** 业务写操作后统一刷新 dashboard 快照和本地统计事件。 */
export async function refreshDashboardAfterMutation(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  requestDashboardCountsRefresh()
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
    fuzzy,
    match_mode = DEFAULT_SEARCH_MATCH_MODE,
  } = params

  let filtered = rows

  if (status_filter && status_filter !== 'all') {
    filtered = filtered.filter((row) => toPrimitiveString(row.status) === status_filter)
  }

  if (search) {
    filtered = filtered.filter((row) => {
      const fields = search_field && search_field !== 'all' ? [search_field] : defaultSearchFields
      return fields.some((field) => matchesSearchText(row[field], search, match_mode, fuzzy))
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
      applicant_id: currentUserId ?? raw.applicant_id ?? null,
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

export function findDashboardColumnIndex(
  columns: ColumnDef<Record<string, unknown>, unknown>[],
  columnId: string
): number {
  return columns.findIndex((column) => {
    const candidate = column as { id?: string; accessorKey?: string }
    return candidate.id === columnId || candidate.accessorKey === columnId
  })
}
