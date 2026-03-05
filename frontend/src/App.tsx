import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/pages/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { InventoryPage } from '@/pages/Inventory'
import { ImportPage } from '@/pages/Import'
import { AdminUsersPage } from '@/pages/AdminUsers'
import { ReagentOrdersPage } from '@/pages/ReagentOrders'
import { ConsumableOrdersPage } from '@/pages/ConsumableOrders'
import { TestErrorPage } from '@/pages/TestError'
import { NotFoundPage } from '@/pages/NotFound'
import DeviceManagement from '@/pages/DeviceManagement'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/Toast'
import { useTheme } from '@/hooks/useTheme'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isAdmin } from '@/lib/constants'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user)
  if (!isAdmin(user)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function AppContent() {
  // 初始化主题
  useTheme()

  return (
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
          <Route index element={<Dashboard />} />
          <Route path="reagents" element={<ReagentOrdersPage />} />
          <Route path="consumables" element={<ConsumableOrdersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route
            path="admin/users"
            element={
              <AdminRoute>
                <AdminUsersPage />
              </AdminRoute>
            }
          />
          <Route path="devices" element={<DeviceManagement />} />
        </Route>
      </Routes>
    </BrowserRouter>
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
