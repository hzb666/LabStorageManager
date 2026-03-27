import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { Layout } from '@/pages/Layout'
import { Login } from '@/pages/Login'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/Toast'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useTheme } from '@/hooks/useTheme'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { UserRoles } from '@/lib/constants'

// 懒加载页面组件 - 使用默认导出
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const InventoryPage = lazy(() => import('@/pages/Inventory').then(m => ({ default: m.InventoryPage })))
const CommonShelfPage = lazy(() => import('@/pages/CommonShelf').then(m => ({ default: m.CommonShelfPage })))
const ImportPage = lazy(() => import('@/pages/Import').then(m => ({ default: m.ImportPage })))
const CartImportPage = lazy(() => import('@/pages/CartImport').then(m => ({ default: m.CartImportPage })))
const AdminUsersPage = lazy(() => import('@/pages/AdminUsers').then(m => ({ default: m.AdminUsersPage })))
const ReagentOrdersPage = lazy(() => import('@/pages/ReagentOrders').then(m => ({ default: m.ReagentOrdersPage })))
const ConsumableOrdersPage = lazy(() => import('@/pages/ConsumableOrders').then(m => ({ default: m.ConsumableOrdersPage })))
const TestErrorPage = lazy(() => import('@/pages/TestError').then(m => ({ default: m.TestErrorPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFound').then(m => ({ default: m.NotFoundPage })))
const DeviceManagement = lazy(() => import('@/pages/DeviceManagement').then(m => ({ default: m.default })))
const AnnouncementManagement = lazy(() => import('@/pages/AnnouncementManagement').then(m => ({ default: m.AnnouncementManagement })))
const OperationLogsPage = lazy(() => import('@/pages/OperationLogs').then(m => ({ default: m.default })))

function AuthCheckingScreen() {
  return <div className="min-h-svh flex items-center justify-center text-muted-foreground">正在验证登录状态...</div>
}

function ProtectedRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const location = useLocation()
  if (authStatus === 'checking') {
    return <AuthCheckingScreen />
  }
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ authNotice: '登录状态已失效，请重新登录', from: location.pathname }}
      />
    )
  }
  return <>{children}</>
}

function ProtectedLayoutRoute() {
  const authStatus = useAuthStore((state) => state.authStatus)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const location = useLocation()

  if (authStatus === 'checking' && isAuthenticated) {
    // 保留 Layout 外壳，避免硬刷新时整页白屏；只延后真正的业务内容区。
    return <Layout deferOutlet />
  }
  if (authStatus === 'checking') {
    return <AuthCheckingScreen />
  }
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ authNotice: '登录状态已失效，请重新登录', from: location.pathname }}
      />
    )
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
              <ProtectedRoute>
                <Suspense>
                  <CartImportPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="/test-error" element={<TestErrorPage />} />
          <Route path="*" element={<NotFoundPage />} />
          <Route
            path="/"
            element={<ProtectedLayoutRoute />}
          >
            <Route index element={
              <Suspense>
                <Dashboard />
              </Suspense>
            } />
            <Route path="reagents" element={
              <Suspense>
                <ReagentOrdersPage />
              </Suspense>
            } />
            <Route path="consumables" element={
              <Suspense>
                <ConsumableOrdersPage />
              </Suspense>
            } />
            <Route path="inventory" element={
              <Suspense>
                <InventoryPage />
              </Suspense>
            } />
            <Route path="common-shelf" element={
              <Suspense>
                <CommonShelfPage />
              </Suspense>
            } />
            <Route path="import" element={
              <Suspense>
                <ImportPage />
              </Suspense>
            } />
            <Route
              path="admin/users"
              element={
                <AdminRoute>
                  <Suspense>
                    <AdminUsersPage />
                  </Suspense>
                </AdminRoute>
              }
            />
            <Route
              path="admin/announcements"
              element={
                <AdminRoute>
                  <Suspense>
                    <AnnouncementManagement />
                  </Suspense>
                </AdminRoute>
              }
            />
            <Route path="devices" element={
              <Suspense>
                <DeviceManagement />
              </Suspense>
            } />
            <Route
              path="admin/logs"
              element={
                <AdminRoute>
                  <Suspense>
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

