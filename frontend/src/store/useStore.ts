import { create } from 'zustand'
import { persist, type StorageValue, type PersistStorage } from 'zustand/middleware'
import { authAPI } from '@/api/client'

// 自定义存储，带有过期时间支持 (3天)
const createExpireStorage = <T>(expiresInDays: number): PersistStorage<T> => ({
  getItem: (name: string): StorageValue<T> | null => {
    const value = localStorage.getItem(name)
    if (!value) return null
    
    try {
      const parsed = JSON.parse(value) as StorageValue<T> & { expiresAt?: number }
      if (parsed.expiresAt) {
        const now = Date.now()
        if (now > parsed.expiresAt) {
          localStorage.removeItem(name)
          return null
        }
      }
      return parsed
    } catch {
      // 如果解析失败，返回null让zustand处理
      return null
    }
  },
  setItem: (name: string, value: StorageValue<T>): void => {
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000
    const valueWithExpiry = { ...value, expiresAt }
    localStorage.setItem(name, JSON.stringify(valueWithExpiry))
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name)
  },
})

interface User {
  id: number
  username: string
  full_name: string | null
  role: 'admin' | 'user' | 'public'
  created_at: string
  avatar_url?: string
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  setAuth: (user: User) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setAuth: (user) => {
        set({ user, isAuthenticated: true })
      },
      logout: async () => {
        try {
          await authAPI.logout()
        } catch (error) {
          // 即使 API 调用失败也要清除本地状态
          console.error('Logout API error:', error)
        }
        set({ user: null, isAuthenticated: false })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
)

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: 'sidebar-storage',
      storage: createExpireStorage(3), // 3天过期
    }
  )
)
