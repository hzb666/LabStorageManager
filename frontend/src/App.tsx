import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Login } from '@/pages/Login'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/toast'
import { useTheme } from '@/hooks/useTheme'
import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'

// 使用 lazy 动态导入实现路由级代码分割
const Dashboard = lazy(() => import('@/pages/Dashboard').then(module => ({ default: module.Dashboard })))
const InventoryPage = lazy(() => import('@/pages/Inventory').then(module => ({ default: module.InventoryPage })))
const ImportPage = lazy(() => import('@/pages/Import').then(module => ({ default: module.ImportPage })))
const AdminUsersPage = lazy(() => import('@/pages/AdminUsers').then(module => ({ default: module.AdminUsersPage })))
const ReagentOrdersPage = lazy(() => import('@/pages/ReagentOrders').then(module => ({ default: module.ReagentOrdersPage })))
const ConsumableOrdersPage = lazy(() => import('@/pages/ConsumableOrders').then(module => ({ default: module.ConsumableOrdersPage })))

// 路由加载骨架屏
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user)
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function App() {
  // 初始化主题
  useTheme()

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
          <Route path="reagents" element={<Suspense fallback={<PageLoader />}><ReagentOrdersPage /></Suspense>} />
          <Route path="consumables" element={<Suspense fallback={<PageLoader />}><ConsumableOrdersPage /></Suspense>} />
          <Route path="inventory" element={<Suspense fallback={<PageLoader />}><InventoryPage /></Suspense>} />
          <Route path="import" element={<Suspense fallback={<PageLoader />}><ImportPage /></Suspense>} />
          <Route path="admin/users" element={
            <AdminRoute>
              <Suspense fallback={<PageLoader />}><AdminUsersPage /></Suspense>
            </AdminRoute>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
