import React, { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import {
  LayoutDashboard,
  Package,
  FileSpreadsheet,
  LogOut,
  Users,
  TestTube,
  FlaskConical,
  Sun,
  Moon,
  Menu,
  X,
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
  const { theme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Admin navigation items
  const adminNavItems = [
    { path: '/admin/users', label: '用户管理', icon: Users },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 768) {
      setSidebarOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Mobile menu button */}
      <Button
        variant="outline"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? '关闭菜单' : '打开菜单'}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </Button>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-56 bg-card shadow-lg border-r transition-transform duration-300 ease-in-out flex flex-col",
        // Mobile: transform based on open state
        "md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Header */}
        <div className="flex-none h-16 flex items-center justify-center border-b">
          <h1 className="text-xl font-bold text-foreground">实验室库存管理</h1>
        </div>
        
        {/* Theme Toggle */}
        <div className="flex-none px-4 pt-4">
          <Button
            variant="outline"
            className={cn(
              "w-full flex items-center justify-between",
              theme === 'dark' ? "bg-secondary border-input hover:bg-accent hover:text-accent-foreground" : ""
            )}
            onClick={toggleTheme}
          >
            <span className={cn("text-sm", theme === 'dark' ? "text-secondary-foreground" : "")}>主题</span>
            {theme === 'dark' ? (
              <Moon className={cn("w-4 h-4", theme === 'dark' ? "text-secondary-foreground" : "")} />
            ) : (
              <Sun className="w-4 h-4" />
            )}
          </Button>
        </div>
        
        {/* Navigation - scrollable */}
        <nav className="flex-1 overflow-y-auto mt-6 px-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 mb-2 rounded-lg",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
          
          {/* Admin section - only visible to admins */}
          {user?.role === 'admin' && (
            <>
              <div className="mt-6 py-2 text-xs font-semibold text-muted-foreground uppercase">
                管理
              </div>
              {adminNavItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={handleNavClick}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 mb-2 rounded-lg",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </>
          )}
        </nav>
        
        {/* Footer - always at bottom */}
        <div className="flex-none p-4 border-t bg-card">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              {user?.full_name || user?.username}
            </span>
            <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded whitespace-nowrap">
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
      <main className="md:ml-56 p-4 md:p-8 pt-16 md:pt-8">
        <Outlet />
      </main>
    </div>
  )
}
