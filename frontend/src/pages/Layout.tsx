import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore, useUIStore } from '@/store/useStore'
import { cn, getFullImageUrl } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { AnnouncementButton } from '@/components/AnnouncementButton'
import { announcementAPI, type Announcement } from '@/api/client'
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
  Megaphone,
  Archive,
} from 'lucide-react'
import { BugReportButton } from '@/components/BugReportButton'
import { getBugButtonHidden, clearBugButtonHidden } from '@/lib/bugReportButtonStorage'
import { clearDashboardTab } from '@/lib/dashboardUtils'
import { useTheme } from '@/hooks/useTheme'
import { useIsMobile } from '@/hooks/useMobile'
import { isAdmin, USER_ROLE_MAP } from '@/lib/constants'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { SidebarLogo } from '@/components/SidebarLogo'

const navItems = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard, group: '功能' },
  { title: '试剂订单', href: '/reagents', icon: FlaskConical, group: '功能' },
  { title: '耗材订单', href: '/consumables', icon: ShoppingCart, group: '功能' },
  { title: '库存列表', href: '/inventory', icon: Package, group: '功能' },
  { title: '常用货架', href: '/common-shelf', icon: Archive, group: '功能' },
  { title: '导入数据', href: '/import', icon: FolderInput, group: '功能' },
  { title: '用户管理', href: '/admin/users', icon: Users, adminOnly: true, group: '管理' },
  { title: '公告管理', href: '/admin/announcements', icon: Megaphone, adminOnly: true, group: '管理' },
]

export function Layout() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const isMobile = useIsMobile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [logoutConfirming, setLogoutConfirming] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const response = await announcementAPI.getPublic()
        setAnnouncements(response.data)
      } catch (error) {
        console.error('Failed to fetch announcements:', error)
      }
    }
    fetchAnnouncements()
  }, [])

  const [showBugButton, setShowBugButton] = useState(() => !getBugButtonHidden())

  const handleBugButtonRightClick = useCallback(() => {
    setShowBugButton(false)
  }, [])

  const handleLogout = () => {
    if (logoutConfirming) {
      clearBugButtonHidden()
      clearDashboardTab()
      logout()
    } else {
      setLogoutConfirming(true)
    }
  }

  const handleLogoutBlur = () => {
    if (logoutConfirming) {
      setLogoutConfirming(false)
    }
  }

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin(user)
  )

  const isDevicesActive = location.pathname.startsWith('/devices')

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      toggleSidebar()
    }
  }, [toggleSidebar])

  useEffect(() => {
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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

  const showDesktopSidebar = !isMobile

  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      {/* Desktop Sidebar */}
      {showDesktopSidebar && (
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 bg-sidebar flex flex-col transition-[width] duration-300 ease-in-out',
            sidebarCollapsed ? 'w-16' : 'w-64'
          )}
        >
          {/* 标题区域 */}
          <div className="flex items-center justify-center h-20 pt-16 pb-8 overflow-hidden whitespace-nowrap shrink-0 relative">
            {sidebarCollapsed ? (
              <SidebarLogo className="size-9 pl-3" />
            ) : null}
            <div className={cn(
              "absolute inset-0 flex items-center justify-center pt-16 pb-8 pointer-events-none",
              sidebarCollapsed ? "opacity-0 transition-none" : "opacity-100 transition-opacity duration-200 ease-in delay-50"
            )}>
              <h1 className="text-2xl font-bold text-primary w-64 text-center pl-2 pointer-events-auto">
                实验室库存管理
              </h1>
            </div>
          </div>

          {/* 导航区域 - 使用宽度解耦方案实现完美的悬浮滚动条 */}
          <div className="flex-1 relative overflow-hidden -mr-2">
            <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
              <nav className={cn("flex flex-col pb-2 transition-[width] duration-300", sidebarCollapsed ? "w-16" : "w-64")}>
                <div className="pl-4 pr-1">
                  {/* 功能组 */}
                  <div className="mb-2">
                    <div className="px-2 text-sm text-muted-foreground tracking-wider whitespace-nowrap overflow-hidden transition-opacity duration-300 opacity-100 max-h-10 mt-4 mb-2">
                      功能
                    </div>
                    <div className="space-y-1">
                      {filteredNavItems.filter(item => item.group === '功能').map((item) => {
                        const isActive = location.pathname === item.href
                        const Icon = item.icon
                        return (
                          <Tooltip key={item.href}>
                            <TooltipTrigger asChild>
                              <Link
                                to={item.href}
                                className={cn(
                                  'flex items-center rounded-lg pl-3 py-2.5 overflow-hidden relative isolate',
                                  isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : "text-sidebar-foreground before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"
                                )}
                              >
                                <Icon className={cn("h-5 w-5 shrink-0", isActive ? '' : 'text-sidebar-foreground')} />
                                <span
                                  className={cn(
                                    "whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300",
                                    sidebarCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-50 ml-3'
                                  )}
                                >
                                  {item.title}
                                </span>
                              </Link>
                            </TooltipTrigger>
                            {sidebarCollapsed && (
                              <TooltipContent side="right">
                                <p>{item.title}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        )
                      })}
                    </div>
                  </div>

                  {/* 管理组 */}
                  {filteredNavItems.some(item => item.group === '管理') && (
                    <div>
                      <div className="px-2 text-sm text-muted-foreground tracking-wider whitespace-nowrap overflow-hidden transition-opacity duration-300 opacity-100 max-h-10 mt-6 mb-2">
                        管理
                      </div>
                      <div className="space-y-1">
                        {filteredNavItems.filter(item => item.group === '管理').map((item) => {
                          const isActive = location.pathname === item.href
                          const Icon = item.icon
                          return (
                            <Tooltip key={item.href}>
                              <TooltipTrigger asChild>
                                <Link
                                  to={item.href}
                                  className={cn(
                                    'flex items-center rounded-lg pl-3 py-2.5 overflow-hidden relative isolate',
                                    isActive
                                      ? 'bg-primary text-primary-foreground'
                                      : "text-sidebar-foreground before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"
                                  )}
                                >
                                  <Icon className={cn("h-5 w-5 shrink-0", isActive ? '' : 'text-sidebar-foreground')} />
                                  <span
                                    className={cn(
                                      "whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300",
                                      sidebarCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-50 ml-3'
                                    )}
                                  >
                                    {item.title}
                                  </span>
                                </Link>
                              </TooltipTrigger>
                              {sidebarCollapsed && (
                                <TooltipContent side="right">
                                  <p>{item.title}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          )
                        })}
                      </div>
                    </div>)}
                </div>
              </nav>
            </div>
          </div>

          {/* 用户与设置区域 */}
          <div className="pl-4 py-4 pr-1 shrink-0">
            <Link
              to="/devices"
              className="flex items-center overflow-hidden hover:bg-muted rounded-lg p-1 -mx-1 transition-colors relative"
            >
              <div className={cn("absolute right-0 top-1/2 -translate-y-1/2 h-3/4 w-1 bg-primary rounded-md transition-all duration-300 ease-in-out origin-center",
                isDevicesActive
                  ? "opacity-100 scale-y-100"
                  : "opacity-0 scale-y-0"
              )} />
              <Avatar className="h-10 w-10 shrink-0 mx-auto md:mx-0">
                <AvatarImage src={user?.avatar_url ? getFullImageUrl(user.avatar_url) : undefined} alt={user?.username} />
                <AvatarFallback className="bg-primary text-primary-foreground dark:text-sidebar-foreground">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "flex-1 overflow-hidden transition-[max-width,opacity,margin] duration-300",
                  sidebarCollapsed ? 'opacity-0 max-w-0 ml-0' : 'opacity-100 max-w-37.5 ml-3'
                )}
              >
                <p className="text-base truncate text-sidebar-foreground">
                  {user?.full_name || user?.username}
                </p>
                <p className="text-sm text-sidebar-foreground/70 truncate">
                  {user?.role ? USER_ROLE_MAP[user.role] || user.role : '用户'}
                </p>
              </div>
            </Link>

            <div className="flex flex-col gap-1 overflow-hidden pt-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={toggleTheme}
                    className="justify-start text-base p-2 h-11 w-full hover:bg-muted text-sidebar-foreground transition-colors"
                  >
                    {theme === 'dark' ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
                    <span className={cn(
                      "whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300",
                      sidebarCollapsed ? "opacity-0 max-w-0 ml-0" : "opacity-100 max-w-50 ml-3"
                    )}>
                      {theme === 'dark' ? '切换亮色模式' : '切换暗黑模式'}
                    </span>
                  </Button>
                </TooltipTrigger>
                {sidebarCollapsed && (
                  <TooltipContent side="right">
                    <p>{theme === 'dark' ? '切换亮色' : '切换暗黑'}</p>
                  </TooltipContent>
                )}
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={logoutConfirming ? "destructive" : "ghost"}
                    onClick={handleLogout}
                    onBlur={handleLogoutBlur}
                    className={cn(
                      "justify-start p-2 h-11 w-full text-base", logoutConfirming ? "transition-none" : "hover:bg-muted text-sidebar-foreground transition-colors"
                    )}
                  >
                    <LogOut className="size-5 shrink-0" />
                    <span className={cn(
                      "whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300",
                      sidebarCollapsed ? "opacity-0 max-w-0 ml-0" : "opacity-100 max-w-50 ml-3"
                    )}>
                      {logoutConfirming ? "确认退出" : "退出登录"}
                    </span>
                  </Button>
                </TooltipTrigger>
                {sidebarCollapsed && (
                  <TooltipContent side="right">
                    <p>{logoutConfirming ? "再次点击确认退出" : "退出登录"}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Menu Overlay */}
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
          <div className="flex flex-col items-center justify-center pt-8 pb-4 shrink-0">
            <h1 className="text-2xl font-bold text-primary px-2">实验室库存管理</h1>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <div className="absolute inset-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-sidebar-foreground/20">
              <nav className="flex flex-col space-y-4 p-4 w-64 pb-2">
                <div>
                  <p className="px-2 mb-2 text-sm text-muted-foreground uppercase tracking-wider">功能</p>
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
                            'flex items-center rounded-lg pl-3 py-2 text-base relative isolate',
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : "text-sidebar-foreground hover:text-foreground transition-[color] duration-200 before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0 mr-3" />
                          {item.title}
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {filteredNavItems.some(item => item.group === '管理') && (
                  <div>
                    <p className="px-2 mb-2 text-sm text-muted-foreground uppercase tracking-wider">管理</p>
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
                              'flex items-center rounded-lg pl-3 py-2 text-base relative isolate',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : "text-sidebar-foreground hover:text-foreground transition-[color] duration-200 before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"
                            )}
                          >
                            <Icon className="h-5 w-5 shrink-0 mr-3" />
                            {item.title}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}
              </nav>
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-border/50 shrink-0">
            <Link
              to="/devices"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 mb-2 hover:bg-muted rounded-lg p-2 -mx-2 transition-colors relative"
            >
              {isDevicesActive && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3/4 w-1 bg-primary rounded-md" />
              )}

              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={user?.avatar_url ? getFullImageUrl(user.avatar_url) : undefined} alt={user?.username} />
                <AvatarFallback className="bg-primary text-primary-foreground dark:text-sidebar-foreground">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-base truncate text-sidebar-foreground">
                  {user?.full_name || user?.username}
                </p>
                <p className="text-sm text-sidebar-foreground/70 truncate">
                  {user?.role ? USER_ROLE_MAP[user.role] || user.role : '用户'}
                </p>
              </div>
            </Link>

            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                onClick={toggleTheme}
                className="w-full text-base h-10 justify-start p-2 text-sidebar-foreground hover:bg-muted transition-colors"
              >
                {theme === 'dark' ? <Sun className="mr-3 size-5 shrink-0" /> : <Moon className="mr-3 size-5 shrink-0" />}
                {theme === 'dark' ? '切换亮色模式' : '切换暗黑模式'}
              </Button>

              <Button
                variant={logoutConfirming ? "destructive" : "ghost"}
                onClick={handleLogout}
                onBlur={handleLogoutBlur}
                className={cn(
                  "justify-start p-2 h-11 w-full text-base", logoutConfirming ? "transition-none" : "hover:bg-muted text-sidebar-foreground transition-colors"
                )}
              >
                <LogOut className="mr-3 size-5 shrink-0" />
                {logoutConfirming ? "确认退出" : "退出登录"}
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
        <main className="flex-1 py-2 md:py-3 lg:py-4 ml-2 pr-2 md:ml-3 md:pr-3 lg:ml-3 lg:pr-4">
          <div className="bg-page-card rounded-lg page-card-shadow-light dark:page-card-shadow-dark min-h-full flex flex-col">
            <header
              className="sticky top-0 z-40 flex h-16 items-center gap-1 px-4 bg-page-card border-b border-border rounded-tl-lg rounded-tr-lg"
              data-sticky-header="true"
              id="page-header"
            >
              {showDesktopSidebar && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 hidden md:flex transition-colors"
                        onClick={toggleSidebar}
                      >
                        {sidebarCollapsed ? (
                          <PanelLeftOpen className="size-5" />
                        ) : (
                          <PanelLeftClose className="size-5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{sidebarCollapsed ? "展开侧边栏 (Ctrl+B)" : "折叠侧边栏 (Ctrl+B)"}</p>
                    </TooltipContent>
                  </Tooltip>
                  {showBugButton && (
                    <BugReportButton variant="ghost" size="icon" className="h-10 w-10 hidden md:flex transition-colors" showText={false} onRightClick={handleBugButtonRightClick} />
                  )}
                </>
              )}

              {!mobileMenuOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 md:hidden transition-colors"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="size-5" />
                </Button>
              )}

              <AnnouncementBanner announcements={announcements} />
              <div className="hidden md:block">
                <AnnouncementButton announcements={announcements} />
              </div>

              <div className="flex items-center gap-1 md:hidden ml-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  className="h-10 w-10 text-foreground transition-colors"
                >
                  {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </Button>
                <AnnouncementButton announcements={announcements} />
              </div>
            </header>

            <div className="px-4 py-6 md:px-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
