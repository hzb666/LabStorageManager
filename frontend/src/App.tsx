import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { Layout } from '@/pages/Layout'
import { Login } from '@/pages/Login'
import { CartImportLoadingScreen } from '@/components/CartImportLoadingScreen'
import { AuthDeferredShell } from '@/components/AuthDeferredShell'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/Toast'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useTheme } from '@/hooks/useTheme'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { UserRoles } from '@/lib/constants'
import { canWriteNonPublicData } from '@/lib/permissions'

// 懒加载页面组件 - 使用默认导出
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const InventoryPage = lazy(() => import('@/pages/Inventory').then(m => ({ default: m.InventoryPage })))
const CommonShelfPage = lazy(() => import('@/pages/CommonShelf').then(m => ({ default: m.CommonShelfPage })))
const ImportPage = lazy(() => import('@/pages/Import').then(m => ({ default: m.ImportPage })))
const CartImportPage = lazy(() => import('@/pages/CartImport').then(m => ({ default: m.CartImportPage })))
const AdminUsersPage = lazy(() => import('@/pages/AdminUsers').then(m => ({ default: m.AdminUsersPage })))
const ReagentOrdersPage = lazy(() => import('@/pages/ReagentOrders').then(m => ({ default: m.ReagentOrdersPage })))
const ConsumableOrdersPage = lazy(() => import('@/pages/ConsumableOrders').then(m => ({ default: m.ConsumableOrdersPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFound').then(m => ({ default: m.NotFoundPage })))
const DeviceManagement = lazy(() => import('@/pages/DeviceManagement').then(m => ({ default: m.default })))
const AnnouncementManagement = lazy(() => import('@/pages/AnnouncementManagement').then(m => ({ default: m.AnnouncementManagement })))
const OperationLogsPage = lazy(() => import('@/pages/OperationLogs').then(m => ({ default: m.default })))

function AuthCheckingScreen() {
  return <div className="min-h-svh flex items-center justify-center text-muted-foreground">正在验证登录状态...</div>
}

function ProtectedRoute({
  children,
  checkingFallback,
}: Readonly<{
  children: React.ReactNode
  checkingFallback?: React.ReactNode
}>) {
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (authStatus === 'checking') {
    return <>{checkingFallback ?? <AuthCheckingScreen />}</>
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function ProtectedLayoutRoute() {
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  if (authStatus === 'checking' && isAuthenticated) {
    // 硬刷新校验会话时继续显示 Layout 外壳，业务内容区等待校验完成。
    return <Layout deferOutlet />
  }
  if (authStatus === 'checking') {
    return <AuthCheckingScreen />
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Layout />
}

function AdminRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = useAuthStore((state) => state.user)
  if (user?.role !== UserRoles.ADMIN) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function NonPublicRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = useAuthStore((state) => state.user)
  if (!canWriteNonPublicData(user?.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function LoginRoute() {
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (authStatus === 'checking' && isAuthenticated) {
    return <AuthCheckingScreen />
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }
  return <Login />
}

function AppContent() {
  // 初始化主题
  useTheme()

  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth)
  useEffect(() => {
    void bootstrapAuth()
  }, [bootstrapAuth])

  return (
    <TooltipProvider>
      <BrowserRouter>
        <ToastContainer />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/cart-import"
            element={
              <ProtectedRoute checkingFallback={<CartImportLoadingScreen />}>
                <Suspense>
                  <CartImportPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
          <Route
            path="/"
            element={<ProtectedLayoutRoute />}
          >
            <Route index element={
              <Suspense fallback={<AuthDeferredShell pathname="/" />}>
                <Dashboard />
              </Suspense>
            } />
            <Route path="reagents" element={
              <Suspense fallback={<AuthDeferredShell pathname="/reagents" />}>
                <ReagentOrdersPage />
              </Suspense>
            } />
            <Route path="consumables" element={
              <Suspense fallback={<AuthDeferredShell pathname="/consumables" />}>
                <ConsumableOrdersPage />
              </Suspense>
            } />
            <Route path="inventory" element={
              <Suspense fallback={<AuthDeferredShell pathname="/inventory" />}>
                <InventoryPage />
              </Suspense>
            } />
            <Route path="common-shelf" element={
              <Suspense fallback={<AuthDeferredShell pathname="/common-shelf" />}>
                <CommonShelfPage />
              </Suspense>
            } />
            <Route path="import" element={
              <NonPublicRoute>
                <Suspense fallback={<AuthDeferredShell pathname="/import" />}>
                  <ImportPage />
                </Suspense>
              </NonPublicRoute>
            } />
            <Route
              path="admin/users"
              element={
                <AdminRoute>
                  <Suspense fallback={<AuthDeferredShell pathname="/admin/users" />}>
                    <AdminUsersPage />
                  </Suspense>
                </AdminRoute>
              }
            />
            <Route
              path="admin/announcements"
              element={
                <AdminRoute>
                  <Suspense fallback={<AuthDeferredShell pathname="/admin/announcements" />}>
                    <AnnouncementManagement />
                  </Suspense>
                </AdminRoute>
              }
            />
            <Route path="devices" element={
              <Suspense fallback={<AuthDeferredShell pathname="/devices" />}>
                <DeviceManagement />
              </Suspense>
            } />
            <Route path="logs" element={
              <Suspense fallback={<AuthDeferredShell pathname="/logs" />}>
                <OperationLogsPage />
              </Suspense>
            } />
            <Route
              path="admin/logs"
              element={
                <AdminRoute>
                  <Suspense fallback={<AuthDeferredShell pathname="/admin/logs" />}>
                    <OperationLogsPage />
                  </Suspense>
                </AdminRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}

export default App

