import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { useAuthStore } from '@/store/useStore'

// Placeholder components for other routes
function OrdersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">订单管理</h1>
      <p className="text-muted-foreground">订单管理页面开发中...</p>
    </div>
  )
}

function InventoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">库存管理</h1>
      <p className="text-muted-foreground">库存管理页面开发中...</p>
    </div>
  )
}

function ImportPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">导入库存</h1>
      <p className="text-muted-foreground">Excel 导入页面开发中...</p>
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

function App() {
  return (
    <BrowserRouter>
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
          <Route path="orders" element={<OrdersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="import" element={<ImportPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
