import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { Layout } from '@/pages/Layout'
import { Login } from '@/pages/Login'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/Toast'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useTheme } from '@/hooks/useTheme'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isAdmin } from '@/lib/constants'
import { authAPI } from '@/api/client'

// 懒加载页面组件 - 使用默认导出
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const InventoryPage = lazy(() => import('@/pages/Inventory').then(m => ({ default: m.InventoryPage })))
const CommonShelfPage = lazy(() => import('@/pages/CommonShelf').then(m => ({ default: m.CommonShelfPage })))
const ImportPage = lazy(() => import('@/pages/Import').then(m => ({ default: m.ImportPage })))
const AdminUsersPage = lazy(() => import('@/pages/AdminUsers').then(m => ({ default: m.AdminUsersPage })))
const ReagentOrdersPage = lazy(() => import('@/pages/ReagentOrders').then(m => ({ default: m.ReagentOrdersPage })))
const ConsumableOrdersPage = lazy(() => import('@/pages/ConsumableOrders').then(m => ({ default: m.ConsumableOrdersPage })))
const TestErrorPage = lazy(() => import('@/pages/TestError').then(m => ({ default: m.TestErrorPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFound').then(m => ({ default: m.NotFoundPage })))
const DeviceManagement = lazy(() => import('@/pages/DeviceManagement').then(m => ({ default: m.default })))
const AnnouncementManagement = lazy(() => import('@/pages/AnnouncementManagement').then(m => ({ default: m.AnnouncementManagement })))
const OperationLogsPage = lazy(() => import('@/pages/OperationLogs').then(m => ({ default: m.default })))

function ProtectedRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AdminRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = useAuthStore((state) => state.user)
  if (!isAdmin(user)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function AppContent() {
  // 初始化主题
  useTheme()

  const setAuth = useAuthStore((state) => state.setAuth)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const hasFetchedUser = useRef(false)

  // 刷新页面时获取最新用户信息（包括头像）
  useEffect(() => {
    if (isAuthenticated && !hasFetchedUser.current) {
      hasFetchedUser.current = true
      authAPI.getProfile().then((res) => {
        setAuth(res.data)
      }).catch(console.error)
    }
  }, [isAuthenticated, setAuth])

  return (
    <TooltipProvider>
      <BrowserRouter>
        <ToastContainer />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/test-error" element={<TestErrorPage />} />
          <Route path="*" element={<NotFoundPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
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
              path="admin/logs/:token"
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
