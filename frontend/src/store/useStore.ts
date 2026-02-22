import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authAPI } from '@/api/client'

interface User {
  id: number
  username: string
  full_name: string | null
  role: 'admin' | 'user'
  created_at: string
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
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
