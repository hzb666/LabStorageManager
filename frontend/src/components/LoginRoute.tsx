import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Login } from '@/pages/Login'
import { useAuthStore } from '@/store/useStore'

export function LoginRoute() {
  const location = useLocation()
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const setUnauthenticated = useAuthStore((state) => state.setUnauthenticated)
  const forceLogin = new URLSearchParams(location.search).get('switch') === '1'

  useEffect(() => {
    if (forceLogin) setUnauthenticated()
  }, [forceLogin, setUnauthenticated])

  if (forceLogin) return <Login />
  if (authStatus === 'checking') {
    return <div className="min-h-svh flex items-center justify-center text-muted-foreground">正在验证登录状态...</div>
  }
  if (authStatus === 'authenticated' && isAuthenticated) {
    return <Navigate to="/" replace />
  }
  return <Login />
}
