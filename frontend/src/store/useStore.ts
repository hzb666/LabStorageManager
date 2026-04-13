import { create } from 'zustand'
import { persist, type StorageValue, type PersistStorage } from 'zustand/middleware'
import { api, authAPI } from '@/api/client'
import { resolveAuthNoticeByCode, triggerSessionInvalidation } from '@/lib/authSession'
import { AUTH_STORAGE_EXPIRY_MS } from '@/lib/constants'

// 自定义存储，带有过期时间支持 (3天)
const createExpireStorage = <T>(expiresInMs: number): PersistStorage<T> => ({
  getItem: (name: string): StorageValue<T> | null => {
    let value: string | null = null
    try {
      value = localStorage.getItem(name)
    } catch {
      return null
    }
    if (!value) return null

    try {
      const parsed = JSON.parse(value) as StorageValue<T> & { expiresAt?: number }
      if (parsed.expiresAt) {
        const now = Date.now()
        if (now > parsed.expiresAt) {
          try {
            localStorage.removeItem(name)
          } catch {
            // 忽略存储异常
          }
          return null
        }
      }
      return parsed
    } catch {
      return null
    }
  },
  setItem: (name: string, value: StorageValue<T>): void => {
    const expiresAt = Date.now() + expiresInMs
    const valueWithExpiry = { ...value, expiresAt }
    try {
      localStorage.setItem(name, JSON.stringify(valueWithExpiry))
    } catch {
      // 忽略存储异常
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name)
    } catch {
      // 忽略存储异常
    }
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

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

interface LogoutOptions {
  skipApi?: boolean
  forceLocal?: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  authStatus: AuthStatus
  setAuth: (user: User) => void
  setUnauthenticated: () => void
  bootstrapAuth: () => Promise<void>
  logout: (options?: LogoutOptions) => Promise<void>
}

const UNAUTH_STATE = {
  user: null,
  isAuthenticated: false,
  authStatus: 'unauthenticated' as const,
}

const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000

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

const readErrorStatus = (error: unknown): number | undefined => {
  const response = (error as { response?: { status?: unknown } } | undefined)?.response
  return typeof response?.status === 'number' ? response.status : undefined
}

const readAuthErrorCode = (error: unknown): string => {
  const headers = (error as { response?: { headers?: unknown } } | undefined)?.response?.headers
  return String(
    readHeaderValue(headers, 'x-auth-error-code')
    ?? readHeaderValue(headers, 'X-Auth-Error-Code')
    ?? ''
  )
}

let bootstrapInFlight: Promise<void> | null = null
let logoutInFlight: Promise<void> | null = null
let authFlowEpoch = 0

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const applyAuthenticated = (user: User, invalidatePending = true) => {
        if (invalidatePending) {
          authFlowEpoch += 1
        }
        set({ user, isAuthenticated: true, authStatus: 'authenticated' })
      }

      return {
        user: null,
        isAuthenticated: false,
        // 页面初始阶段必须先走服务端会话确认，不能直接信任本地持久化。
        authStatus: 'checking',
        setAuth: (user) => {
          applyAuthenticated(user)
        },
        setUnauthenticated: () => {
          set(UNAUTH_STATE)
        },
        bootstrapAuth: async () => {
          if (bootstrapInFlight) {
            await bootstrapInFlight
            return
          }

          const current = get()
          if (current.authStatus === 'authenticated') {
            return
          }

          const hasLocalAuth = Boolean(current.isAuthenticated && current.user)
          const epoch = ++authFlowEpoch
          set({ authStatus: 'checking' })
          bootstrapInFlight = (async () => {
            try {
              // 启动探测只用于判定“是否已登录”，不应触发全局失效弹窗。
              const response = await api.get('/users/me', {
                headers: { 'X-Skip-Auth-Invalidation': '1' },
                timeout: AUTH_BOOTSTRAP_TIMEOUT_MS,
              })
              if (epoch !== authFlowEpoch) {
                return
              }
              applyAuthenticated(response.data, false)
            } catch (error) {
              if (epoch !== authFlowEpoch) {
                return
              }

              const status = readErrorStatus(error)
              const authErrorCode = readAuthErrorCode(error)
              if (status === 403 && authErrorCode === 'AUTH_USER_DISABLED') {
                await triggerSessionInvalidation({
                  notice: resolveAuthNoticeByCode(authErrorCode, '账号已被禁用'),
                  skipApi: true,
                })
                return
              }

              if (status === 401) {
                set(UNAUTH_STATE)
                return
              }

              if (hasLocalAuth && current.user) {
                console.error('Auth bootstrap probe failed, keeping local auth state:', error)
                applyAuthenticated(current.user, false)
                return
              }

              set(UNAUTH_STATE)
            } finally {
              bootstrapInFlight = null
            }
          })()

          await bootstrapInFlight
        },
        logout: async (options = {}) => {
          const { skipApi = false, forceLocal = false } = options
          if (forceLocal) {
            // 强制本地下线：用于被踢/401 并发风暴时优先收敛 UI 状态，不等待网络。
            authFlowEpoch += 1
            set(UNAUTH_STATE)
            return
          }

          if (logoutInFlight) {
            await logoutInFlight
            return
          }

          authFlowEpoch += 1
          logoutInFlight = (async () => {
            if (!skipApi) {
              try {
                await authAPI.logout()
              } catch (error) {
                // 即使 API 调用失败也要清除本地状态
                console.error('Logout API error:', error)
              }
            }
            set(UNAUTH_STATE)
          })()

          try {
            await logoutInFlight
          } finally {
            logoutInFlight = null
          }
        },
      }
    },
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
      storage: createExpireStorage(AUTH_STORAGE_EXPIRY_MS),
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
      storage: createExpireStorage(AUTH_STORAGE_EXPIRY_MS),
    }
  )
)
