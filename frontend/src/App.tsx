import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { InventoryPage } from '@/pages/Inventory'
import { ImportPage } from '@/pages/Import'
import { AdminUsersPage } from '@/pages/AdminUsers'
import { ReagentOrdersPage } from '@/pages/ReagentOrders'
import { ConsumableOrdersPage } from '@/pages/ConsumableOrders'
import { useAuthStore } from '@/store/useStore'
import { ToastContainer } from '@/components/ui/toast'
import { useTheme } from '@/hooks/useTheme'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
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
          <Route index element={<Dashboard />} />
          <Route path="reagents" element={<ReagentOrdersPage />} />
          <Route path="consumables" element={<ConsumableOrdersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="admin/users" element={<AdminUsersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
