import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore, useUIStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  FlaskConical,
  LogOut,
  Menu,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  FolderInput,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useIsMobile } from '@/hooks/use-mobile'

const navItems = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard, group: '功能' },
  { title: '试剂订单', href: '/reagents', icon: FlaskConical, group: '功能' },
  { title: '耗材订单', href: '/consumables', icon: ShoppingCart, group: '功能' },
  { title: '库存列表', href: '/inventory', icon: Package, group: '功能' },
  { title: '导入数据', href: '/import', icon: FolderInput, group: '功能' },
  { title: '用户管理', href: '/admin/users', icon: Users, adminOnly: true, group: '管理' },
]

export function Layout() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const isMobile = useIsMobile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  )

  // 键盘快捷键支持 Ctrl+B / Cmd+B
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      toggleSidebar()
    }
  }, [toggleSidebar])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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

  // 桌面端始终显示侧边栏（不隐藏）
  const showDesktopSidebar = !isMobile

  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      {/* Desktop Sidebar */}
      {showDesktopSidebar && (
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 bg-sidebar flex flex-col transition-[width] duration-300 ease-in-out',
            sidebarCollapsed ? 'w-16' : 'w-64'
          )}
        >
          {/* 标题区域 - 折叠时保持高度，只隐藏文字 */}
          <div 
            className={cn(
              'flex flex-col items-center justify-center transition-opacity duration-200 overflow-hidden',
              sidebarCollapsed ? 'opacity-0' : 'opacity-100',
              // 始终保持固定高度，确保展开和折叠时导航图标位置不变
              'h-20 pt-12 pb-12'
            )}
          >
            <h1 className="text-2xl font-bold text-center px-2 whitespace-nowrap text-primary">实验室库存管理</h1>
          </div>

          {/* 导航区域 */}
          <nav className={cn(
            "flex-1 overflow-y-auto px-2",
            sidebarCollapsed ? "px-3" : "px-3"
          )}>
            {/* 功能组 */}
            <div className="mb-4">
              {!sidebarCollapsed && (
                <p className="px-3 mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">功能</p>
              )}
                <div className="space-y-1">
                  {filteredNavItems.filter(item => item.group === '功能').map((item) => {
                    const isActive = location.pathname === item.href
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                          'flex items-center rounded-lg py-2 font-medium min-w-0 overflow-hidden',
                          sidebarCollapsed 
                            ? 'justify-center px-2' 
                            : 'gap-3 px-3',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-sidebar-foreground hover:bg-muted'
                        )}
                        title={sidebarCollapsed ? item.title : undefined}
                      >
                        <Icon className={cn("h-5 w-5 flex-shrink-0", isActive ? '' : 'text-sidebar-foreground')} />
                        <span 
                          className={cn(
                            "whitespace-nowrap overflow-hidden min-w-0",
                            sidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100'
                          )}
                        >
                          {item.title}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>

            {/* 管理组 */}
            <div className="pt-2">
              {!sidebarCollapsed && (
                <p className="px-3 mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">管理</p>
              )}
                <div className="space-y-1">
                  {filteredNavItems.filter(item => item.group === '管理').map((item) => {
                    const isActive = location.pathname === item.href
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                          'flex items-center rounded-lg py-2 font-medium min-w-0 overflow-hidden',
                          sidebarCollapsed 
                            ? 'justify-center px-2' 
                            : 'gap-3 px-3',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-sidebar-foreground hover:bg-muted'
                        )}
                        title={sidebarCollapsed ? item.title : undefined}
                      >
                        <Icon className={cn("h-5 w-5 flex-shrink-0", isActive ? '' : 'text-sidebar-foreground')} />
                        <span 
                          className={cn(
                            "whitespace-nowrap overflow-hidden min-w-0",
                            sidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100'
                          )}
                        >
                          {item.title}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </nav>

          {/* 用户区域 - 保持固定 padding */}
          <div className="mt-auto p-3">
            <div className="pt-2">
              {/* 头像 */}
              <div className={cn("flex items-center gap-3 mb-3", sidebarCollapsed ? "" : "ml-1")}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground flex-shrink-0">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div 
                  className={cn(
                    "flex-1 min-w-0 overflow-hidden",
                    sidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100'
                  )}
                >
                  <p className="text-base font-medium truncate text-sidebar-foreground whitespace-nowrap">
                    {user?.full_name || user?.username}
                  </p>
                  <p className="text-sm text-sidebar-foreground/70 whitespace-nowrap">
                    {user?.role === 'admin' ? '管理员' : '用户'}
                  </p>
                </div>
              </div>

              {/* 按钮区域 */}
              <div 
                className={cn(
                  "flex gap-2",
                  sidebarCollapsed 
                    ? "flex-col items-center" 
                    : "items-center justify-between"
                )}
              >
                <Button
                  variant="ghost"
                  onClick={() => logout()}
                  className={cn(
                    "h-10 text-sidebar-foreground text-base hover:bg-muted min-w-0 overflow-hidden flex",
                    sidebarCollapsed 
                      ? "w-10 h-10 p-0 justify-center" 
                      : "flex-1 justify-start px-3"
                  )}
                  title={sidebarCollapsed ? "退出登录" : undefined}
                >
                  <LogOut className="size-5 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="ml-2 whitespace-nowrap">
                      退出登录
                    </span>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  className={cn(
                    "size-10 shrink-0 hover:bg-muted shadow-none text-sidebar-foreground",
                    sidebarCollapsed 
                      ? "w-10" 
                      : ""
                  )}
                  title={sidebarCollapsed ? (theme === 'dark' ? '切换亮色' : '切换暗黑') : undefined}
                >
                  {theme === 'dark' ? (
                    <Sun className="size-5" />
                  ) : (
                    <Moon className="size-5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}

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
            "fixed inset-y-0 left-0 w-64 border-r border-border bg-sidebar transition-transform duration-200 flex flex-col",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
          onClick={(e) => e.stopPropagation()}
        >
            <div className="flex flex-col items-center justify-center pt-8 pb-4">
              <h1 className="text-xl font-bold text-primary">实验室库存管理</h1>
            </div>
            <nav className="flex-1 space-y-4 p-4 overflow-y-auto">
              {/* 功能组 */}
              <div>
                <p className="px-3 mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">功能</p>
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
                <p className="px-3 mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">管理</p>
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
                    <p className="text-base font-medium truncate text-sidebar-foreground">
                      {user?.full_name || user?.username}
                    </p>
                    <p className="text-sm text-sidebar-foreground/70">
                      {user?.role === 'admin' ? '管理员' : '用户'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="w-full text-base h-10 justify-start text-sidebar-foreground hover:bg-muted"
                  onClick={() => logout()}
                >
                  <LogOut className="mr-2 size-5" />
                  退出登录
                </Button>
              </div>
            </div>
          </aside>
        </div>

      {/* Main Content */}
      <div 
        className={cn(
          "flex-1 flex flex-col min-h-screen min-w-0 w-full transition-[margin-left] duration-300 ease-in-out",
          showDesktopSidebar ? (sidebarCollapsed ? "md:ml-16" : "md:ml-64") : ""
        )}
      >
        {/* Page Content */}
        <main className="flex-1 py-2 md:py-3 lg:py-4 pl-2 pr-2 md:pl-3 md:pr-3 lg:pl-3 lg:pr-4">
          <div className="bg-page-card rounded-lg page-card-shadow-light dark:page-card-shadow-dark min-h-full flex flex-col">
            {/* Top Header - sticky + 顶部圆角 */}
            <header 
              className="sticky top-0 z-40 flex h-16 items-center gap-4 px-4 bg-page-card border-b border-border rounded-tl-lg rounded-tr-lg"
              data-sticky-header="true"
              id="page-header"
            >
              {/* Sidebar Toggle Button - Desktop */}
              {showDesktopSidebar && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 hidden md:flex"
                  onClick={toggleSidebar}
                  title={sidebarCollapsed ? "展开侧边栏 (Ctrl+B)" : "折叠侧边栏 (Ctrl+B)"}
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-5" />
                  ) : (
                    <PanelLeftClose className="size-5" />
                  )}
                </Button>
              )}
              
              {/* Mobile Menu Button - 关闭菜单时显示，打开菜单时隐藏 */}
              {!mobileMenuOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 md:hidden"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="size-5" />
                </Button>
              )}
              
              <div className="flex-1" />
              
              {/* Mobile Theme Toggle Only */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-10 w-10 md:hidden text-foreground transition-none"
              >
                {theme === 'dark' ? (
                  <Sun className="size-5" />
                ) : (
                  <Moon className="size-5" />
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
