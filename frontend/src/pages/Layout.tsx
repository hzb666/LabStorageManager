import { useState, useEffect } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Upload,
  FlaskConical,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useIsMobile } from '@/hooks/use-mobile'

const navItems = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard, group: '功能' },
  { title: '试剂订单', href: '/reagents', icon: FlaskConical, group: '功能' },
  { title: '耗材订单', href: '/consumables', icon: ShoppingCart, group: '功能' },
  { title: '库存列表', href: '/inventory', icon: Package, group: '功能' },
  { title: '导入数据', href: '/import', icon: Upload, group: '功能' },
  { title: '用户管理', href: '/admin/users', icon: Users, adminOnly: true, group: '管理' },
]

export function Layout() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  )

  // 移动端侧边栏打开时禁止背景滚动
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform bg-sidebar transition-transform duration-200 max-md:hidden flex flex-col',
          !sidebarOpen && '-translate-x-full'
        )}
      >
        <div className="flex flex-col items-center justify-center pt-8 pb-4">
          <h1 className="text-2xl font-bold">实验室库存管理</h1>
        </div>
        <nav className="flex-1 space-y-4 p-4 overflow-y-auto">
          {/* 功能组 */}
          <div>
            <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">功能</p>
              <div className="space-y-1">
              {filteredNavItems.filter(item => item.group === '功能').map((item) => {
                const isActive = location.pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-none',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-sidebar text-sidebar-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.title}
                  </Link>
                )
              })}
            </div>
          </div>
          {/* 管理组 */}
            <div>
            <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">管理</p>
            <div className="space-y-1">
              {filteredNavItems.filter(item => item.group === '管理').map((item) => {
                const isActive = location.pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-none',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-sidebar text-sidebar-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.title}
                  </Link>
                )
              })}
            </div>
          </div>
        </nav>
        <div className="mt-auto p-4">
          <div className="pt-2">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.full_name || user?.username}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user?.role === 'admin' ? '管理员' : '用户'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                className="flex-1 justify-start text-foreground hover:bg-muted hover:text-foreground border-0 shadow-none"
                onClick={() => logout()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                className="h-9 w-9 flex-shrink-0 hover:bg-muted hover:text-foreground border-0 shadow-none text-foreground transition-none"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Menu */}
      <div 
        className={cn(
          "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden transition-opacity duration-200",
          mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileMenuOpen(false)}
      >
          <aside 
          className={cn(
            "fixed inset-y-0 left-0 w-64 bg-sidebar border-r transition-transform duration-200 flex flex-col",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
          onClick={(e) => e.stopPropagation()}
        >
            <div className="flex flex-col items-center justify-center pt-8 pb-4">
              <h1 className="text-xl font-bold">实验室库存管理</h1>
            </div>
            <nav className="flex-1 space-y-4 p-4 overflow-y-auto">
              {/* 功能组 */}
              <div>
                <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">功能</p>
                <div className="space-y-1">
                  {filteredNavItems.filter(item => item.group === '功能').map((item) => {
                    const isActive = location.pathname === item.href
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-none',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-sidebar text-sidebar-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        {item.title}
                      </Link>
                    )
                  })}
                </div>
              </div>
              {/* 管理组 */}
              <div>
                <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">管理</p>
                <div className="space-y-1">
                  {filteredNavItems.filter(item => item.group === '管理').map((item) => {
                    const isActive = location.pathname === item.href
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-none',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-sidebar text-sidebar-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        {item.title}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </nav>
            {/* Mobile User Info */}
            <div className="mt-auto p-4">
              <div className="pt-2">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-sidebar-foreground">
                      {user?.full_name || user?.username}
                    </p>
                    <p className="text-xs text-sidebar-foreground/70">
                      {user?.role === 'admin' ? '管理员' : '用户'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-foreground/10"
                  onClick={() => logout()}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </Button>
              </div>
            </div>
          </aside>
        </div>

      {/* Main Content */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen min-w-0 w-full">
        {/* Page Content */}
        <main className="flex-1 py-2 md:py-3 lg:py-4 pl-2 pr-2 md:pr-3 lg:pr-4">
          <div className="bg-page-card rounded-lg page-card-shadow-light dark:page-card-shadow-dark min-h-full flex flex-col">
            {/* Top Header - sticky + 顶部圆角 */}
            <header className="sticky top-0 z-30 flex h-16 items-center gap-4 px-4 bg-page-card border-b border-border rounded-tl-lg rounded-tr-lg">
              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>
              <div className="flex-1" />
              {/* Mobile Theme Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-10 w-10 md:hidden text-foreground transition-none"
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
            </header>
            
            {/* Page Content */}
            <div className="p-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
