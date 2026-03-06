import axios from 'axios'
import { useAuthStore } from '@/store/useStore'
import { getDeviceId, getDeviceName } from '@/lib/deviceId'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 允许发送 Cookie
  withCredentials: true,
})

// Request interceptor — 不再从 localStorage 读取 token，改为使用 Cookie
api.interceptors.request.use(
  (config) => {
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
    // 排除登录接口的 401 错误，避免页面刷新导致登录页错误信息丢失
    const isLoginRequest = error.config?.url?.includes('/users/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Paginated response type
export interface PaginatedResponse<T> {
  data: T[]
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
  NONE = "none",
  RUNNING_OUT = "running_out",
  NOT_STOCKED = "not_stocked",
  COMMON_PUBLIC = "common_public",
  NOT_FOUND = "not_found",
  REORDER = "reorder",
  HIGH_USAGE = "high_usage",
  DEGRADED = "degraded",
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
}

// User Admin APIs
export const userAdminAPI = {
  list: (params?: { skip?: number; limit?: number; username?: string; role?: string; is_active?: boolean }) =>
    api.get('/users/', { params }),
  create: (data: { username: string; password: string; full_name?: string; role: 'admin' | 'user' }) =>
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
}

// Reagent Order APIs
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
  confirmArrival: (id: number, notes?: string) =>
    api.post(`/reagent-orders/${id}/confirm-arrival`, { arrival_notes: notes }),
  stockIn: (id: number) => api.post(`/reagent-orders/${id}/stock-in`),
  getMyOrders: () => api.get('/reagent-orders/dashboard/my-orders'),
  getArrivedOrders: () => api.get('/reagent-orders/dashboard/arrived-orders'),
  exportOrders: () => api.get('/reagent-orders/export', { responseType: 'blob' }),
}

// Consumable Order APIs (new)
export const consumableOrderAPI = {
  list: (params?: PaginationParams & { status_filter?: ConsumableOrderStatus }) =>
    api.get('/consumable-orders/', { params }),
  get: (id: number) => api.get(`/consumable-orders/${id}`),
  create: (data: {
    name: string
    english_name?: string
    alias?: string
    category?: string
    brand?: string
    specification: string
    unit?: string
    quantity: number
    price?: number
    notes?: string
  }) => api.post('/consumable-orders', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/consumable-orders/${id}`, data),
  delete: (id: number) => api.delete(`/consumable-orders/${id}`),
  approve: (id: number) => api.post(`/consumable-orders/${id}/approve`),
  reject: (id: number, reason: string) =>
    api.post(`/consumable-orders/${id}/reject`, { reason }),
  complete: (id: number) => api.post(`/consumable-orders/${id}/complete`),
  getMyOrders: () => api.get('/consumable-orders/dashboard/my-orders'),
  exportOrders: () => api.get('/consumable-orders/export', { responseType: 'blob' as const }),
}

// Inventory APIs
export const inventoryAPI = {
  list: (params?: PaginationParams & { status_filter?: string; cas_filter?: string; hazardous_only?: boolean }) =>
    api.get('/inventory/', { params }),
  get: (id: number) => api.get(`/inventory/${id}`),
  getByCode: (code: string) => api.get(`/inventory/code/${code}`),
  checkCAS: (casNumber: string) => api.get(`/inventory/cas/${casNumber}`),
  borrow: (id: number) => api.post(`/inventory/${id}/borrow`),
  return: (id: number, data: { remaining_quantity: number; unit?: string }) =>
    api.post(`/inventory/${id}/return`, data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/inventory/${id}`),
  getMyBorrows: () => api.get('/inventory/dashboard/my-borrows'),
  getPendingStockin: () => api.get('/inventory/dashboard/pending-stockin'),
  getBorrowHistory: (id: number) => api.get(`/inventory/${id}/borrow-history`),
  getImportTemplate: () => api.get('/inventory/import/template'),
  importExcel: (file: FormData) =>
    api.post('/inventory/import', file, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  manualAdd: (data: {
    cas_number: string
    name: string
    english_name?: string
    alias?: string
    specification: string
    quantity_bottles: number
    brand?: string
    category?: string
    storage_location?: string
    is_hazardous: boolean
    notes?: string
  }) => api.post('/inventory/manual-add', data),
  exportInventory: () => api.get('/inventory/export', { responseType: 'blob' }),
}

// Chemical Info APIs
export interface ChemicalInfo {
  cas_number: string
  name: string | null
  english_name: string | null
}

export const chemicalAPI = {
  getInfo: (casNumber: string) => api.get<ChemicalInfo>(`/chemical-info/${casNumber}`),
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
