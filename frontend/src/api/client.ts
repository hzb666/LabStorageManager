import axios from 'axios'
import { getDeviceId, getDeviceName } from '@/lib/storage/appAuthMetaStorage'
import { AxiosHeaders } from 'axios'
import { getApiBaseUrl } from '@/lib/apiConfig'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { resolveAuthNoticeByCode, triggerSessionInvalidation } from '@/lib/authSession'
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

  const record = headers as Record<string, unknown>
  if (headerName in record) {
    return record[headerName]
  }

  const maybeGet = (record as { get?: unknown }).get
  if (typeof maybeGet === 'function') {
    return (maybeGet as (name: string) => unknown)(headerName)
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

// Request interceptor — 不再从 localStorage 读取 token，改为使用 Cookie
api.interceptors.request.use(
  (config) => {
    const sseClientId = useSSEStore.getState().clientId
    if (sseClientId) {
      const headers = AxiosHeaders.from(config.headers)
      headers.set('X-SSE-Client-Id', sseClientId)
      config.headers = headers
    }

    // Token 现在通过 httpOnly Cookie 自动发送，不需要手动设置
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle auth errors
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

// Paginated response type
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

// Reagent Order Status Enum
export enum ReagentOrderStatus {
  PENDING = "pending",
  APPROVED = "approved",
  ARRIVED = "arrived",
  STOCKED = "stocked",
  REJECTED = "rejected",
}

// Reagent Order Reason Enum
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

// Consumable Order Status Enum
export enum ConsumableOrderStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  COMPLETED = "completed",
}

// Consumable Order Reason Enum
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

// Session Info type for device management
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

// Auth APIs
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

// Session APIs (Device Management)
export const sessionAPI = {
  list: () => api.get('/users/me/sessions'),
  delete: (id: number) => api.delete(`/users/me/sessions/${id}`),
  deleteAll: () => api.delete('/users/me/sessions'),
  refresh: () => api.post('/users/me/sessions/refresh'),
  update: (id: number, data: { device_name: string }) =>
    api.patch(`/users/me/sessions/${id}`, data),
}

// User Admin APIs
export const userAdminAPI = {
  list: (params?: { skip?: number; limit?: number; username?: string; role?: string; is_active?: boolean }) =>
    api.get('/users/', { params }),
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
}

export const userAPI = {
  searchUsers: (query: string) => api.get<UserSearchItem[]>('/users/search', { params: { q: query } }),
}

// Reagent Order APIs
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
  display_name: string | null
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

export const reagentOrderAPI = {
  list: (params?: PaginationParams & {
    status_filter?: ReagentOrderStatus
    search?: string
    search_field?: string
    fuzzy?: boolean
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
    brand?: string
    purity?: string
    specification: string
    quantity: number
    price: number
    order_reason: ReagentOrderReason
    is_hazardous: boolean
    notes?: string
  }) => api.post('/reagent-orders', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/reagent-orders/${id}`, data),
  delete: (id: number) => api.delete(`/reagent-orders/${id}`),
  approve: (id: number) => api.post(`/reagent-orders/${id}/approve`),
  reject: (id: number, reason: string) =>
    api.post(`/reagent-orders/${id}/reject`, { reason }),
  confirmArrival: (id: number, data?: { arrival_notes?: string; storage_location?: string }) =>
    api.post(`/reagent-orders/${id}/confirm-arrival`, data ?? {}),
  stockIn: (id: number, data: { storage_location: string; remaining_quantity?: number }) =>
    api.post(`/reagent-orders/${id}/stock-in`, data),
  getCASOverview: (
    casNumber: string,
    params?: { exclude_order_id?: number }
  ) => api.get<CASOverviewResponse>(`/reagent-orders/cas-overview/${casNumber}`, { params }),
  getMyReagentOrders: () => api.get('/reagent-orders/dashboard/my-reagent-orders'),
  getArrivedOrders: () => api.get('/reagent-orders/dashboard/arrived-orders'),
  exportOrders: () => api.get('/reagent-orders/export', { responseType: 'blob' }),
}

// Consumable Order APIs (new)
export const consumableOrderAPI = {
  list: (params?: PaginationParams & {
    status_filter?: ConsumableOrderStatus
    search?: string
    search_field?: string
    fuzzy?: boolean
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
  exportOrders: () => api.get('/consumable-orders/export', { responseType: 'blob' as const }),
}

export type CartSyncOrderType = 'reagent' | 'consumable'

export interface CartSyncItemPayload {
  name: string
  specification?: string
  quantity: number
  price?: number
  brand?: string
  cas_number?: string
  english_name?: string
  alias?: string
  unit?: string
  product_number?: string
  is_hazardous?: boolean
  product_id?: string
  detail_url?: string
}

export const cartSyncAPI = {
  importItems: (data: { items: CartSyncItemPayload[]; order_type: CartSyncOrderType }) =>
    api.post('/cart-sync/import', data),
}

// Inventory APIs
export const inventoryAPI = {
  list: (params?: PaginationParams & {
    status_filter?: string
    cas_filter?: string
    hazardous_only?: boolean
    search?: string
    search_field?: string
    fuzzy?: boolean
    sort_by?: string
    sort_order?: string
  }) =>
    api.get('/inventory/', { params }),
  get: (id: number) => api.get(`/inventory/${id}`),
  getByCode: (code: string) => api.get(`/inventory/code/${code}`),
  checkCAS: (casNumber: string) => api.get(`/inventory/cas/${casNumber}`),
  borrow: (id: number, data?: { actual_borrower_id?: number }) => api.post(`/inventory/${id}/borrow`, data),
  return: (id: number, data: { remaining_quantity: number; unit?: string }) =>
    api.post(`/inventory/${id}/return`, data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/inventory/${id}`),
  getMyBorrows: () => api.get('/inventory/dashboard/my-borrows'),
  getPendingStockin: () => api.get('/inventory/dashboard/pending-stockin'),
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
    brand?: string
    category?: string
    purity?: string
    storage_location?: string
    is_hazardous: boolean
    notes?: string
  }) => api.post('/inventory/manual-add', data),
  exportInventory: () => api.get('/inventory/export', { responseType: 'blob' }),
}

export type ChemicalCategory =
  | 'acid'
  | 'base'
  | 'salt'
  | 'solvent'
  | 'catalyst'
  | 'indicator'
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
  category: ChemicalCategory | null
  purity: string | null
  notes: string | null
}

export interface CommonShelfGroup {
  id: string
  group: CommonShelfGroupIdentity
  display: CommonShelfGroupDisplay
  bottle_count: number
  location_count: number
  latest_name_snapshot: string
  created_at: string
  updated_at: string
}

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

export const commonShelfAPI = {
  list: async (params?: PaginationParams & {
    search?: string
    search_field?: string
    fuzzy?: boolean
    sort_by?: string
    sort_order?: string
  }) => {
    const response = await api.get<PaginatedResponse<Omit<CommonShelfGroup, 'id'>>>('/common-shelf/groups', { params })
    return {
      ...response,
      data: {
        ...response.data,
        data: response.data.data.map((item) => ({
          ...item,
          id: item.group.group_key,
        })),
      },
    }
  },
  manualAdd: (data: {
    cas_number: string
    name_snapshot: string
    brand?: string
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
    brand?: string
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
  addBottles: (groupKey: string, data: { count: number; storage_location?: string }) =>
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

// Chemical Info APIs
export interface ChemicalInfo {
  cas_number: string
  name: string | null
  english_name: string | null
  warning?: string | null
}

export const chemicalAPI = {
  getInfo: (casNumber: string, options?: { skipChinese?: boolean }) =>
    api.get<ChemicalInfo>(`/chemical-info/${casNumber}`, {
      params: options?.skipChinese ? { skip_chinese: true } : undefined,
    }),
}

// Announcement types
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

// Announcement APIs
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

// User Operation Logs APIs
export interface LogItem {
  time: string | null
  type: string
  detail: string
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
    log_type?: string
    status_filter?: string
  }) => Promise<{ data: { data: LogItem[]; total: number } }>
}

// 创建日志 API 适配器（用于 FilterTable）
// 注意：FilterTable 使用 status_filter 参数，但日志 API 需要 log_type，需要转换
export const createLogsAPI = (token: string): LogsAPI => ({
  list: async (params) => {
    const payload: {
      token: string
      skip?: number
      limit?: number
      keyword?: string
      log_type?: string
    } = { token }

    if (params.skip !== undefined) payload.skip = params.skip
    if (params.limit !== undefined) payload.limit = params.limit
    if (params.search) payload.keyword = params.search

    // 将 status_filter 转换为 log_type（FilterTable 使用 status_filter，日志 API 需要 log_type）
    // 注意：'all' 表示全部类型，不传参给后端
    if (params.status_filter && params.status_filter !== 'all') {
      payload.log_type = params.status_filter
    }

    const response = await api.post<LogsResponse>('/admin/users/logs/query', payload)
    // LogsResponse 包含 { user_id, username, data: LogItem[], total }
    const logsData = response.data
    return { data: { data: logsData.data, total: logsData.total } }
  }
})
