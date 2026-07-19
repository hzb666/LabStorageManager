import axios from 'axios'
import { getDeviceId, getDeviceName } from '@/lib/storage/appAuthMetaStorage'
import { AxiosHeaders } from 'axios'
import { getApiBaseUrl } from '@/lib/apiConfig'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { resolveAuthNoticeByCode, triggerSessionInvalidation } from '@/lib/authSession'
import type { SearchMatchMode } from '@/lib/searchMatchMode'
import { useSSEStore } from '@/store/sseStore'

const API_BASE_URL = getApiBaseUrl()

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 允许发送 Cookie
  withCredentials: true,
})

const readHeaderValue = (headers: unknown, headerName: string): unknown => {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }

  if (headers instanceof AxiosHeaders) {
    return headers.get(headerName)
  }

  const record = headers as Record<string, unknown>
  if (headerName in record) {
    return record[headerName]
  }

  const maybeGet = (record as { get?: unknown }).get
  if (typeof maybeGet === 'function') {
    return (maybeGet as (name: string) => unknown).call(headers, headerName)
  }
  return undefined
}

const hasSkipAuthInvalidationHeader = (headers: unknown): boolean => {
  // 允许少量请求（如应用启动探测）在 401 时静默回落，不弹全局失效提示。
  const raw = String(
    readHeaderValue(headers, 'x-skip-auth-invalidation')
    ?? readHeaderValue(headers, 'X-Skip-Auth-Invalidation')
    ?? ''
  )
  return raw === '1'
}

const getAuthErrorCode = (headers: unknown): string =>
  String(
    readHeaderValue(headers, 'x-auth-error-code')
    ?? readHeaderValue(headers, 'X-Auth-Error-Code')
    ?? ''
  )

const isAuthInvalidationIgnoredRequest = (requestUrl: string): boolean =>
  requestUrl.includes('/users/login') || requestUrl.includes('/users/logout')

const shouldTriggerAuthInvalidation = (args: {
  status: number | undefined
  authErrorCode: string
  requestUrl: string
  skipAuthInvalidation: boolean
}): boolean => {
  const { status, authErrorCode, requestUrl, skipAuthInvalidation } = args
  const isDisabled403 = status === 403 && authErrorCode === 'AUTH_USER_DISABLED'
  const isAuthFailure = status === 401 || isDisabled403

  return (
    isAuthFailure
    && !isAuthInvalidationIgnoredRequest(requestUrl)
    && !skipAuthInvalidation
  )
}

// 请求拦截器使用 Cookie 认证，不读取 localStorage token。
api.interceptors.request.use(
  (config) => {
    const sseClientId = useSSEStore.getState().clientId
    if (sseClientId) {
      const headers = AxiosHeaders.from(config.headers)
      headers.set('X-SSE-Client-Id', sseClientId)
      config.headers = headers
    }

    // token 由 httpOnly Cookie 自动发送，无需手动设置。
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器处理认证失效。
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error.config?.url ?? '')
    const skipAuthInvalidation = hasSkipAuthInvalidationHeader(error.config?.headers)
    const status = error.response?.status
    const authErrorCode = getAuthErrorCode(error.response?.headers)

    if (shouldTriggerAuthInvalidation({ status, authErrorCode, requestUrl, skipAuthInvalidation })) {
      const fallbackNotice = getApiErrorMessage(error, '会话已失效，请重新登录')
      const notice = resolveAuthNoticeByCode(authErrorCode || undefined, fallbackNotice)
      void triggerSessionInvalidation({ notice, skipApi: true })
    }
    return Promise.reject(error)
  }
)

// 分页响应类型。
export interface PaginatedResponse<T> {
  data: T[]
  current?: number
  total: number
  skip: number
  limit: number
}

export interface PaginationParams {
  skip?: number
  limit?: number
  search?: string
}

// 试剂订单状态枚举。
export enum ReagentOrderStatus {
  PENDING = "pending",
  APPROVED = "approved",
  ARRIVED = "arrived",
  STOCKED = "stocked",
  REJECTED = "rejected",
}

// 试剂订单原因枚举。
export enum ReagentOrderReason {
  RUNNING_OUT = "running_out",
  NOT_STOCKED = "not_stocked",
  COMMON_PUBLIC = "common_public",
  NOT_FOUND = "not_found",
  REORDER = "reorder",
  HIGH_USAGE = "high_usage",
  DEGRADED = "degraded",
  OTHERS = "others",
}

export interface ReagentWorkflowEditPayload {
  name?: string
  english_name?: string
  alias?: string
  category?: string
  brand?: string
  purity?: string
  specification?: string
  is_hazardous?: boolean
  notes?: string
}

export interface ConfirmArrivalPayload extends ReagentWorkflowEditPayload {
  arrival_notes?: string
  storage_location?: string
  remaining_quantity?: number
}

export interface StockInPayload extends ReagentWorkflowEditPayload {
  storage_location: string
  remaining_quantity?: number
}

// 耗材订单状态枚举。
export enum ConsumableOrderStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  COMPLETED = "completed",
}

// 耗材订单原因枚举。
export enum ConsumableOrderReason {
  NONE = "none",
  RUNNING_OUT = "running_out",
  NOT_STOCKED = "not_stocked",
  COMMON_PUBLIC = "common_public",
  NOT_FOUND = "not_found",
  REORDER = "reorder",
  HIGH_USAGE = "high_usage",
  DEGRADED = "degraded",
}

// 设备管理会话信息类型。
export interface SessionInfo {
  id: number
  user_id: number
  device_id: string
  device_name: string
  ip_address: string
  user_agent?: string
  created_at: string
  last_active_at: string
  expires_at: string
}

export interface UserAdminListItem {
  id: number
  username: string
  full_name: string | null
  full_name_pinyin?: string | null
  full_name_pinyin_initials?: string | null
  role: 'admin' | 'user' | 'public'
  is_active: boolean
  created_at: string
  avatar_url?: string
  last_active_at?: string | null
}

export interface UserAdminListResponse {
  data: UserAdminListItem[]
  total: number
  total_without_filter: number
  skip: number
  limit: number
}

// 认证 API。
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/users/login', { 
      username, 
      password,
      device_id: getDeviceId(),
      device_name: getDeviceName()
    }),
  logout: () => api.post('/users/logout'),
  getProfile: () => api.get('/users/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/users/change-password', { old_password: oldPassword, new_password: newPassword }),
}

// 设备会话 API。
export const sessionAPI = {
  list: () => api.get('/users/me/sessions'),
  delete: (id: number) => api.delete(`/users/me/sessions/${id}`),
  deleteAll: () => api.delete('/users/me/sessions'),
  refresh: () => api.post('/users/me/sessions/refresh'),
  update: (id: number, data: { device_name: string }) =>
    api.patch(`/users/me/sessions/${id}`, data),
}

// 用户管理 API。
export const userAdminAPI = {
  list: (params?: {
    skip?: number
    limit?: number
    username?: string
    full_name?: string
    role?: string
    is_active?: boolean
  }) =>
    api.get<UserAdminListResponse>('/users/', { params }),
  create: (data: { username: string; password: string; full_name?: string; role: 'admin' | 'user' | 'public' }) =>
    api.post('/users', data),
  update: (id: number, data: { username?: string; full_name?: string; role?: string; is_active?: boolean }) =>
    api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  activate: (id: number) => api.post(`/users/${id}/activate`),
  updateRole: (id: number, role: string) => api.put(`/users/${id}/role`, null, { params: { role } }),
  resetPassword: (id: number, newPassword: string, oldPassword?: string) =>
    api.post(`/users/${id}/reset-password`, {
      new_password: newPassword,
      ...(oldPassword && { old_password: oldPassword })
    }),
  uploadAvatar: (userId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ avatar_url: string }>(`/users/${userId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deleteAvatar: (userId: number) => {
    return api.delete<{ avatar_url: null }>(`/users/${userId}/avatar`)
  },
  // 生成日志访问令牌
  generateLogsToken: (userId: number) => 
    api.post<{ token: string }>(`/admin/users/${userId}/logs-token`),
}

export interface UserSearchItem {
  id: number
  full_name: string
  username: string
}

export const userAPI = {
  searchUsers: (query: string) => api.get<UserSearchItem[]>('/users/search', { params: { q: query } }),
}

// 试剂订单 API。
export interface CASOverviewOrder {
  id: number
  name: string
  applicant_name: string | null
  specification: string
  created_at: string
  status: string
}

export interface CASOverviewInventory {
  id: number
  remaining_quantity: number | null
  specification: string
  storage_location: string | null
  created_at: string
  status: string
  borrower_name: string | null
}

export interface CASOverviewResponse {
  cas_number: string
  preferred_name: string | null
  preferred_name_source?: string | null
  display_name?: string | null
  has_warning: boolean
  orders: {
    total_count: number
    latest: CASOverviewOrder | null
  }
  inventory: {
    total_count: number
    latest: CASOverviewInventory | null
  }
}

export interface DashboardPanelCodes {
  label_code?: string | null
  impact_code?: string | null
}

export interface DashboardPanelEntity {
  entity_type?: string | null
  entity_id?: number | string | null
  name?: string | null
  preferred_name?: string | null
  preferred_name_source?: string | null
  cas_number?: string | null
  brand?: string | null
  specification?: string | null
  quantity?: number | null
  unit?: string | null
  actor_name?: string | null
}

export interface DashboardPanelMetrics {
  count?: number | null
  value?: number | null
  remaining_quantity?: number | null
  initial_quantity?: number | null
  remaining_percent?: number | null
  threshold_days?: number | null
}

export const reagentOrderAPI = {
  list: (params?: PaginationParams & {
    status_filter?: ReagentOrderStatus
    search?: string
    search_field?: string
    fuzzy?: boolean
    match_mode?: SearchMatchMode
    sort_by?: string
    sort_order?: string
  }) => api.get('/reagent-orders/', { params }),
  get: (id: number) => api.get(`/reagent-orders/${id}`),
  create: (data: {
    cas_number: string
    name: string
    english_name?: string
    alias?: string
    category?: string
    brand: string
    purity?: string
    specification: string
    quantity: number
    price: number
    order_reason: ReagentOrderReason
    is_hazardous?: boolean
    notes?: string
  }) => api.post('/reagent-orders', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/reagent-orders/${id}`, data),
  delete: (id: number) => api.delete(`/reagent-orders/${id}`),
  approve: (id: number) => api.post(`/reagent-orders/${id}/approve`),
  reject: (id: number, reason: string) =>
    api.post(`/reagent-orders/${id}/reject`, { reason }),
  confirmArrival: (id: number, data?: ConfirmArrivalPayload) =>
    api.post(`/reagent-orders/${id}/confirm-arrival`, data ?? {}),
  stockIn: (id: number, data: StockInPayload) =>
    api.post(`/reagent-orders/${id}/stock-in`, data),
  getCASOverview: (
    casNumber: string,
    params?: { exclude_order_id?: number }
  ) => api.get<CASOverviewResponse>(`/reagent-orders/cas-overview/${casNumber}`, { params }),
  getMyReagentOrders: () => api.get('/reagent-orders/dashboard/my-reagent-orders'),
  getAdminReagentOrders: () => api.get('/reagent-orders/dashboard/admin/reagent-orders'),
  getArrivedOrders: () => api.get('/reagent-orders/dashboard/arrived-orders'),
  exportOrders: () => api.get('/reagent-orders/export', { responseType: 'blob' }),
}

// 耗材订单 API。
export const consumableOrderAPI = {
  list: (params?: PaginationParams & {
    status_filter?: ConsumableOrderStatus
    search?: string
    search_field?: string
    fuzzy?: boolean
    match_mode?: SearchMatchMode
    sort_by?: string
    sort_order?: string
  }) =>
    api.get('/consumable-orders/', { params }),
  get: (id: number) => api.get(`/consumable-orders/${id}`),
  create: (data: {
    name: string
    english_name?: string
    product_number?: string
    specification: string
    unit?: string
    quantity: number
    price?: number
    communication?: string
    notes?: string
  }) => api.post('/consumable-orders', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/consumable-orders/${id}`, data),
  delete: (id: number) => api.delete(`/consumable-orders/${id}`),
  approve: (id: number) => api.post(`/consumable-orders/${id}/approve`),
  reject: (id: number, reason: string) =>
    api.post(`/consumable-orders/${id}/reject`, { reason }),
  complete: (id: number) => api.post(`/consumable-orders/${id}/complete`),
  getMyConsumableOrders: () => api.get('/consumable-orders/dashboard/my-consumable-orders'),
  getAdminConsumableOrders: () => api.get('/consumable-orders/dashboard/admin/consumable-orders'),
  exportOrders: () => api.get('/consumable-orders/export', { responseType: 'blob' as const }),
}

export interface InventoryReturnPayload {
  remaining_quantity: number
  specification?: string
  notes?: string
}

export interface ProcedureInventoryItem {
  id: number
  cas_number: string
  name: string
  brand?: string | null
  storage_location?: string | null
  remaining_quantity?: number | null
  initial_quantity?: number | null
  unit?: string | null
  status?: string
  specification?: string | null
}

export interface ProcedureResolvedReagent {
  name: string
  query_name?: string | null
  cas_number: string
  cas_numbers: string[]
  pubchem_cid?: number | null
  pubchem_name?: string | null
  reason?: string | null
  inventory_count: number
}

export interface ProcedureUnresolvedReagent {
  name: string
  query_name?: string | null
  reason: string
}

export type ProcedureAnalysisStatus = 'resolved' | 'unresolved' | 'common' | 'generic'

export interface ProcedureAnalyzedReagent {
  name: string
  pubchem_query_name?: string | null
  status: ProcedureAnalysisStatus
  cas_number?: string | null
  cas_numbers?: string[]
  reason?: string | null
  pubchem_cid?: number | null
  inventory_count: number
}

export interface ProcedureLLMReagent {
  name: string
  pubchem_query_name?: string | null
  should_query_pubchem: boolean
  evidence?: string | null
  confidence: 'high' | 'medium' | 'low'
}

export interface ProcedureInventoryExtractionResponse {
  rejected: boolean
  message?: string | null
  formatted_text: string
  reagents: ProcedureLLMReagent[]
  analysis_items: ProcedureAnalyzedReagent[]
}

export interface ProcedureInventoryGroup {
  cas_number: string
  reagent_names: string[]
  items: ProcedureInventoryItem[]
}

export interface ProcedureInventorySearchResponse {
  rejected: boolean
  message?: string | null
  formatted_text: string
  cas_query: string
  analysis_items: ProcedureAnalyzedReagent[]
  resolved: ProcedureResolvedReagent[]
  unresolved: ProcedureUnresolvedReagent[]
  inventory_groups: ProcedureInventoryGroup[]
}

export const procedureInventorySearchAPI = {
  extract: (text: string) =>
    api.post<ProcedureInventoryExtractionResponse>('/procedure-inventory-search/extract', { text }),
  resolve: (data: ProcedureInventoryExtractionResponse) =>
    api.post<ProcedureInventorySearchResponse>('/procedure-inventory-search/resolve', {
      rejected: data.rejected,
      message: data.message,
      formatted_text: data.formatted_text,
      reagents: data.reagents,
    }),
  search: (text: string) =>
    api.post<ProcedureInventorySearchResponse>('/procedure-inventory-search', { text }),
}

// 库存 API。
export const inventoryAPI = {
  list: (params?: PaginationParams & {
    status_filter?: string
    cas_filter?: string
    hazardous_only?: boolean
    structure_search_id?: string
    structure_match_mode?: string
    structure_query?: string
    structure_query_format?: string
    search?: string
    search_field?: string
    fuzzy?: boolean
    match_mode?: SearchMatchMode
    sort_by?: string
    sort_order?: string
  }) =>
    api.get('/inventory/', { params }),
  get: (id: number) => api.get(`/inventory/${id}`),
  getByCode: (code: string) => api.get(`/inventory/code/${code}`),
  checkCAS: (casNumber: string) => api.get(`/inventory/cas/${casNumber}`),
  borrow: (id: number, data?: { actual_borrower_id?: number }) => api.post(`/inventory/${id}/borrow`, data),
  return: (id: number, data: InventoryReturnPayload) =>
    api.post(`/inventory/${id}/return`, data),
  returnDelete: (id: number, data: InventoryReturnPayload) =>
    api.post(`/inventory/${id}/return-delete`, data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/inventory/${id}`),
  getMyBorrows: () => api.get('/inventory/dashboard/my-borrows'),
  getAdminBorrows: () => api.get('/inventory/dashboard/admin/borrows'),
  getPendingStockin: () => api.get('/inventory/dashboard/pending-stockin'),
  getAdminPendingStockin: () => api.get('/inventory/dashboard/admin/pending-stockin'),
  completePendingStockin: (id: number, data: StockInPayload) =>
    api.post(`/inventory/${id}/complete-stockin`, data),
  getBorrowHistory: (id: number) => api.get(`/inventory/${id}/borrow-history`),
  getImportTemplate: () => api.get('/inventory/import/template'),
  downloadTemplate: () => api.get('/inventory/import/template', { responseType: 'blob' }),
  previewImportExcel: (file: FormData) =>
    api.post('/inventory/import/preview', file, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  confirmImportExcel: (previewToken: string) =>
    api.post('/inventory/import/confirm', { preview_token: previewToken }),
  manualAdd: (data: {
    cas_number: string
    name: string
    english_name?: string
    alias?: string
    specification: string
    quantity_bottles: number
    brand: string
    category?: string
    purity?: string
    storage_location?: string
    is_hazardous: boolean
    notes?: string
  }) => api.post('/inventory/manual-add', data),
  exportInventory: () => api.get('/inventory/export', { responseType: 'blob' }),
}

export interface AdminDashboardPanelItem {
  detail: string
  submitter_name?: string
  count?: number
  impact?: string
  value?: number
  alert_kind?: 'inventory' | 'common_shelf'
  remaining_quantity?: number | null
  initial_quantity?: number | null
  unit?: string | null
  specification?: string | null
  remaining_percent?: number | null
  severity?: 'high' | 'medium' | 'low' | 'neutral' | 'success' | 'warning'
  tone?: 'neutral' | 'success' | 'warning' | 'high'
  tab?: 'reagents' | 'consumables' | 'borrows' | 'stockin'
  created_at?: string
  is_overdue?: boolean
  codes?: DashboardPanelCodes
  entity?: DashboardPanelEntity
  metrics?: DashboardPanelMetrics
}

export interface AdminDashboardSummary {
  reagent_order_count: number
  consumable_order_count: number
  borrowed_inventory_count: number
  pending_stockin_count: number
  reagent_order_delta: number
  consumable_order_delta: number
  borrowed_inventory_delta: number
  pending_stockin_delta: number
  pending_reagent_count: number
  pending_consumable_count: number
  approved_reagent_count: number
  overdue_borrow_count: number
  pending_reagent_overdue_count: number
  pending_consumable_overdue_count: number
  pending_stockin_overdue_count: number
  long_unarrived_approved_reagent_count: number
  long_unconfirmed_approved_consumable_count: number
  common_stock_alert_count: number
  recent_arrival_count: number
  recent_reagent_order_count?: number
  recent_consumable_order_count?: number
  stock_in_activity_count: number
  order_total_value?: number
  is_all_time?: boolean
  todo_items: AdminDashboardPanelItem[]
  risk_items: AdminDashboardPanelItem[]
  recent_actions: AdminDashboardPanelItem[]
  stock_alert_items: AdminDashboardPanelItem[]
  system_status: AdminDashboardPanelItem[]
  item_counts: DashboardAdminItemCounts
  recent_window_days: number
  system_version?: string
  generated_at: string
}

export interface AdminDashboardWindowStats {
  recent_window_days: number
  is_all_time: boolean
  recent_arrival_count: number
  recent_reagent_order_count: number
  recent_consumable_order_count: number
  stock_in_activity_count: number
  order_total_value: number
}

export interface PersonalDashboardSummary {
  reagent_count: number
  reagent_arrival_overdue_count: number
  consumable_count: number
  consumable_receipt_overdue_count: number
  borrow_count: number
  borrow_overdue_count: number
  stockin_count: number
}

export type DashboardBoardSection = 'actions' | 'orders' | 'stockAlerts'
export type DashboardAdminSection = 'todos' | 'risks' | 'stockAlerts'

export interface DashboardBoardItemCounts {
  action_items: number
  order_overview_items: number
  stock_alert_items: number
}

export interface DashboardAdminItemCounts {
  todo_items: number
  risk_items: number
  stock_alert_items: number
}

export interface DashboardBoardSummary {
  action_items: AdminDashboardPanelItem[]
  order_overview_items: AdminDashboardPanelItem[]
  recent_items: AdminDashboardPanelItem[]
  stock_alert_items: AdminDashboardPanelItem[]
  announcement_items: AdminDashboardPanelItem[]
  system_status: AdminDashboardPanelItem[]
  item_counts: DashboardBoardItemCounts
  recent_window_days: number
  system_version?: string
  generated_at: string
}

export const dashboardAPI = {
  getPersonalSummary: () =>
    api.get<{ data: PersonalDashboardSummary }>('/dashboard/personal/summary'),
  getBoardSummary: () => api.get<{ data: DashboardBoardSummary }>('/dashboard/board/summary'),
  getBoardSectionItems: (section: DashboardBoardSection, params?: Pick<PaginationParams, 'skip' | 'limit'>) =>
    api.get<PaginatedResponse<AdminDashboardPanelItem>>(`/dashboard/board/sections/${section}`, {
      params,
    }),
  getBoardWindowStats: (windowDays = 7, allTime = false) =>
    api.get<{ data: AdminDashboardWindowStats }>('/dashboard/board/summary/window-stats', {
      params: { window_days: windowDays, all_time: allTime },
    }),
  getAdminSummary: () => api.get<{ data: AdminDashboardSummary }>('/dashboard/admin/summary'),
  getAdminSectionItems: (section: DashboardAdminSection, params?: Pick<PaginationParams, 'skip' | 'limit'>) =>
    api.get<PaginatedResponse<AdminDashboardPanelItem>>(`/dashboard/admin/sections/${section}`, {
      params,
    }),
  getAdminWindowStats: (windowDays = 7, allTime = false) =>
    api.get<{ data: AdminDashboardWindowStats }>('/dashboard/admin/summary/window-stats', {
      params: { window_days: windowDays, all_time: allTime },
    }),
}

export type ChemicalCategory =
  | 'acid'
  | 'base'
  | 'salt'
  | 'solvent'
  | 'other'

export interface CommonShelfGroupIdentity {
  group_key: string
  cas_number: string
  brand: string | null
  brand_normalized: string
  specification_text: string
  specification_normalized: string
}

export interface CommonShelfGroupDisplay {
  name: string
  english_name: string | null
  alias_1: string | null
  alias_2: string | null
  alias_3: string | null
  category: ChemicalCategory | null
}

export interface CommonShelfRecentLocation {
  storage_location: string | null
  bottle_count: number
}

export interface CommonShelfGroup {
  id: string
  group: CommonShelfGroupIdentity
  display: CommonShelfGroupDisplay
  bottle_count: number
  location_count: number
  recent_locations: CommonShelfRecentLocation[]
  latest_name_snapshot: string
  created_at: string
  updated_at: string
  cas_number: string
  name: string
  alias_1: string | null
  alias_2: string | null
  alias_3: string | null
  brand: string | null
  specification: string
  storage_location: string | null
  category: ChemicalCategory | null
}

type CommonShelfGroupApiRow = Omit<
  CommonShelfGroup,
  'id'
  | 'cas_number'
  | 'name'
  | 'alias_1'
  | 'alias_2'
  | 'alias_3'
  | 'brand'
  | 'specification'
  | 'storage_location'
  | 'category'
>

export interface CommonShelfLocationSummary {
  storage_location: string | null
  bottle_count: number
  oldest_created_at: string
}

export interface CommonShelfGroupItem {
  id: number
  internal_code: string
  purity: string | null
  storage_location: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ChemicalNameMapItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias_1: string | null
  alias_2: string | null
  alias_3: string | null
  category: ChemicalCategory | null
  created_at: string
  updated_at: string
}

export interface ReagentBrandItem {
  id: number
  name: string
  name_normalized: string
  name_pinyin: string | null
  name_pinyin_initials: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

function normalizeCommonShelfGroupRow(
  item: CommonShelfGroupApiRow,
): CommonShelfGroup {
  return {
    ...item,
    id: item.group.group_key,
    cas_number: item.group.cas_number,
    name: item.display.name,
    alias_1: item.display.alias_1,
    alias_2: item.display.alias_2,
    alias_3: item.display.alias_3,
    brand: item.group.brand,
    specification: item.group.specification_text,
    storage_location: item.recent_locations.find((location) => location.storage_location)?.storage_location ?? null,
    category: item.display.category,
  }
}

export const commonShelfAPI = {
  list: async (params?: PaginationParams & {
    search?: string
    search_field?: string
    fuzzy?: boolean
    match_mode?: SearchMatchMode
    sort_by?: string
    sort_order?: string
  }) => {
    const response = await api.get<PaginatedResponse<CommonShelfGroupApiRow>>('/common-shelf/groups', { params })
    return {
      ...response,
      data: {
        ...response.data,
        data: response.data.data.map((item) => normalizeCommonShelfGroupRow(item)),
      },
    }
  },
  manualAdd: (data: {
    cas_number: string
    name_snapshot: string
    brand: string
    purity?: string
    specification: string
    count: number
    storage_location?: string
    notes?: string
  }) => api.post('/common-shelf/manual-add', data),
  getLocations: (groupKey: string) =>
    api.get<CommonShelfLocationSummary[]>(`/common-shelf/groups/${groupKey}/locations`),
  getLocationSuggestions: (groupKey: string) =>
    api.get<string[]>(`/common-shelf/groups/${groupKey}/location-suggestions`),
  getLocationSuggestionsByFields: (params: {
    cas_number: string
    brand?: string
    specification: string
  }) => api.get<string[]>('/common-shelf/location-suggestions', { params }),
  getGroupItems: (groupKey: string) =>
    api.get<CommonShelfGroupItem[]>(`/common-shelf/groups/${groupKey}/items`),
  updateGroup: (groupKey: string, data: {
    brand: string
    specification: string
    confirm_merge?: boolean
  }) => api.put(`/common-shelf/groups/${groupKey}`, data),
  updateItem: (groupKey: string, itemId: number, data: {
    purity?: string
    storage_location?: string
    notes?: string
  }) => api.put(`/common-shelf/groups/${groupKey}/items/${itemId}`, data),
  deleteItem: (groupKey: string, itemId: number) =>
    api.delete(`/common-shelf/groups/${groupKey}/items/${itemId}`),
  addBottles: (groupKey: string, data: {
    count: number
    storage_location?: string
    purity?: string
    notes?: string
  }) =>
    api.post(`/common-shelf/groups/${groupKey}/add-bottles`, data),
  removeOne: (groupKey: string, data: { storage_location?: string }) =>
    api.post(`/common-shelf/groups/${groupKey}/remove-one`, data),
  deleteGroup: (groupKey: string) =>
    api.delete(`/common-shelf/groups/${groupKey}`),
  exportCommonShelf: () => api.get('/common-shelf/export', { responseType: 'blob' as const }),
}

export const chemicalNameMapAPI = {
  list: (params?: PaginationParams & {
    search?: string
    search_field?: string
    fuzzy?: boolean
    match_mode?: SearchMatchMode
  }) => api.get<PaginatedResponse<ChemicalNameMapItem>>('/chemical-name-map', { params }),
  create: (data: {
    cas_number: string
    name: string
    english_name?: string
    alias_1?: string
    alias_2?: string
    alias_3?: string
    category?: ChemicalCategory | null
  }) => api.post('/chemical-name-map', data),
  update: (id: number, data: {
    name?: string
    english_name?: string
    alias_1?: string
    alias_2?: string
    alias_3?: string
    category?: ChemicalCategory | null
  }) => api.put(`/chemical-name-map/${id}`, data),
  delete: (id: number) => api.delete(`/chemical-name-map/${id}`),
}

export const reagentBrandAPI = {
  list: (params?: PaginationParams & {
    search?: string
    sort_by?: string
    sort_order?: string
    include_inactive?: boolean
  }) => api.get<PaginatedResponse<ReagentBrandItem>>('/reagent-brands', { params }),
  create: (data: { name: string }) => api.post<ReagentBrandItem>('/reagent-brands', data),
  update: (id: number, data: { name: string }) =>
    api.put<ReagentBrandItem>(`/reagent-brands/${id}`, data),
  delete: (id: number) => api.delete(`/reagent-brands/${id}`),
}

// 搜索补全预测 API。
export interface InlineCompletionResponse {
  completion: string | null
  suffix: string | null
  confidence: number
  source: string | null
  personalized: boolean
}

export interface SearchCompletionPreferences {
  personalization_enabled: boolean
}

export const searchCompletionAPI = {
  getInline: (params: { endpoint: string; field?: string; q: string }) =>
    api.get<InlineCompletionResponse>('/search-completions/inline', { params }),
  getPreferences: () =>
    api.get<SearchCompletionPreferences>('/search-completions/preferences'),
  updatePreferences: (data: SearchCompletionPreferences) =>
    api.put<SearchCompletionPreferences>('/search-completions/preferences', data),
  submitFeedback: (data: {
    endpoint: string
    field?: string
    query: string
    accepted: boolean
  }) => api.post('/search-completions/feedback', data),
}

// 化学信息 API。
export interface ChemicalInfo {
  cas_number: string
  name: string | null
  english_name: string | null
  warning?: string | null
  smiles?: string | null
  chinese_name_is_translated?: boolean
}

export const chemicalAPI = {
  getInfo: (casNumber: string, options?: { skipChinese?: boolean; cacheOnly?: boolean }) =>
    api.get<ChemicalInfo>(`/chemical-info/${casNumber}`, {
      params: {
        skip_chinese: options?.skipChinese || undefined,
        cache_only: options?.cacheOnly || undefined,
      },
    }),
}

// 公告类型。
export interface Announcement {
  id: number
  title: string
  content: string
  images: string[]
  is_pinned: boolean
  is_visible: boolean
  created_by: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export interface StorageInfo {
  used_mb: number
  max_mb: number
  usage_percent: number
  image_count: number
}

// 公告 API。
export const announcementAPI = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Announcement[]>('/announcements/', { params }),
  getPublic: () => api.get<Announcement[]>('/announcements/public'),
  get: (id: number) => api.get<Announcement>(`/announcements/${id}`),
  create: (data: {
    title: string
    content: string
    images?: string[]
    is_pinned?: boolean
    is_visible?: boolean
  }) => api.post<Announcement>('/announcements/', data),
  update: (id: number, data: {
    title?: string
    content?: string
    images?: string[]
    is_pinned?: boolean
    is_visible?: boolean
  }) => api.put<Announcement>(`/announcements/${id}`, data),
  delete: (id: number) => api.delete(`/announcements/${id}`),
  togglePin: (id: number) => api.post<Announcement>(`/announcements/${id}/toggle-pin`),
  toggleVisibility: (id: number) => api.post<Announcement>(`/announcements/${id}/toggle-visibility`),
  uploadImage: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post<{ url: string }>('/announcements/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data.url
  },
  deleteImage: (filename: string) => api.delete(`/announcements/images/${filename}`),
  getStorageInfo: () => api.get<StorageInfo>('/announcements/storage-info'),
}

// 用户操作日志 API。
export interface LogItem {
  time: string | null
  type: string
  detail: string
  summary?: {
    kind: string
    action_code?: string | null
    actor_name?: string | null
    actor_is_external?: boolean | null
    targets_viewer?: boolean | null
    target?: {
      target_type?: string | null
      target_id?: number | string | null
      target_name?: string | null
      cas_number?: string | null
      specification?: string | null
      quantity?: number | null
      unit?: string | null
    }
    metrics?: {
      count?: number | null
      result_count?: number | null
      quantity_borrowed?: number | null
      quantity_returned?: number | null
    }
    source_meta?: {
      source?: string | null
      endpoint?: string | null
      query_text?: string | null
      device_name?: string | null
      ip_address?: string | null
      export_scope?: string | null
    }
    extra_detail?: string | null
    is_returned?: boolean | null
  }
  // 展开后显示的完整数据（所有数据库字段）
  full_data?: Record<string, unknown>
}

export interface LogsResponse {
  user_id: number
  username: string
  data: LogItem[]
  total: number
}

export interface LogsAPI {
  list: (params: {
    skip?: number
    limit?: number
    search?: string
    category?: string
    status_filter?: string
    include_search_logs?: boolean
  }) => Promise<{ data: { data: LogItem[]; total: number } }>
}

// 日志 API 适配器将 FilterTable 的 status_filter 转成日志接口的 category。
export const createLogsAPI = (token: string): LogsAPI => ({
  list: async (params) => {
    const payload: {
      token: string
      skip?: number
      limit?: number
      keyword?: string
      category?: string
      include_search_logs?: boolean
    } = { token }

    if (params.skip !== undefined) payload.skip = params.skip
    if (params.limit !== undefined) payload.limit = params.limit
    if (params.search) payload.keyword = params.search
    if (params.include_search_logs === true) payload.include_search_logs = true

    // 'all' 表示全部类型，不向后端传 category。
    if (params.status_filter && params.status_filter !== 'all') {
      payload.category = params.status_filter
    }

    const response = await api.post<LogsResponse>('/admin/users/logs/query', payload)
    // 日志响应包含 { user_id, username, data: LogItem[], total }。
    const logsData = response.data
    return { data: { data: logsData.data, total: logsData.total } }
  }
})
