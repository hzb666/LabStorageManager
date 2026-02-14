import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
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
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth APIs
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/users/login', { username, password }),
  getProfile: () => api.get('/users/me'),
}

// Order APIs
export const orderAPI = {
  list: (params?: any) => api.get('/orders', { params }),
  get: (id: number) => api.get(`/orders/${id}`),
  create: (data: any) => api.post('/orders', data),
  update: (id: number, data: any) => api.put(`/orders/${id}`, data),
  delete: (id: number) => api.delete(`/orders/${id}`),
  approve: (id: number) => api.post(`/orders/${id}/approve`),
  reject: (id: number, reason: string) => 
    api.post(`/orders/${id}/reject`, { reason }),
  confirmArrival: (id: number, notes?: string) =>
    api.post(`/orders/${id}/confirm-arrival`, { arrival_notes: notes }),
  stockIn: (id: number) => api.post(`/orders/${id}/stock-in`),
  getMyOrders: () => api.get('/orders/dashboard/my-orders'),
  getArrivedOrders: () => api.get('/orders/dashboard/arrived-orders'),
}

// Inventory APIs
export const inventoryAPI = {
  list: (params?: any) => api.get('/inventory', { params }),
  get: (id: number) => api.get(`/inventory/${id}`),
  getByCode: (code: string) => api.get(`/inventory/code/${code}`),
  checkCAS: (casNumber: string) => api.get(`/inventory/cas/${casNumber}`),
  borrow: (id: number) => api.post(`/inventory/${id}/borrow`, {}),
  return: (id: number, data: { remaining_quantity: number; unit?: string }) =>
    api.post(`/inventory/${id}/return`, data),
  update: (id: number, data: any) => api.put(`/inventory/${id}`, data),
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
    alias?: string
    specification: string
    initial_quantity: number
    quantity_bottles: number
    location?: string
    is_hazardous: boolean
    notes?: string
  }) => api.post('/inventory/manual-add', data),
  exportInventory: () => api.get('/inventory/export'),
}
