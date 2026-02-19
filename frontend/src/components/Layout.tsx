import React from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Package,
  FileSpreadsheet,
  LogOut,
  Users,
  TestTube,
  FlaskConical,
} from 'lucide-react'

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/reagents', label: '试剂订购', icon: TestTube },
  { path: '/consumables', label: '耗材订购', icon: FlaskConical },
  { path: '/inventory', label: '库存管理', icon: Package },
  { path: '/import', label: '导入库存', icon: FileSpreadsheet },
]

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  // Admin navigation items
  const adminNavItems = [
    { path: '/admin/users', label: '用户管理', icon: Users },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-56 bg-white shadow-lg">
        <div className="flex h-16 items-center justify-center border-b">
          <h1 className="text-xl font-bold text-gray-800">实验室库存管理</h1>
        </div>
        <nav className="mt-6 px-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 mb-2 rounded-lg transition-colors",
                  isActive
                    ? "bg-primary text-white"
                    : "text-gray-600 hover:bg-gray-100"
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        
        {/* Admin section - only visible to admins */}
        {user?.role === 'admin' && (
          <>
            <div className="mt-6 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">
              管理
            </div>
            <nav className="mt-2 px-4">
              {adminNavItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 mb-2 rounded-lg transition-colors",
                      isActive
                        ? "bg-primary text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          </>
        )}
        
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-600">
              {user?.full_name || user?.username}
            </span>
            <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded">
              {user?.role === 'admin' ? '管理员' : '用户'}
            </span>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 p-8">
        <Outlet />
      </main>
    </div>
  )
}
