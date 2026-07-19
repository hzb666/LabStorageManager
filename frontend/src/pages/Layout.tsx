import { useState, useEffect, useCallback, useRef, type ComponentProps, type ReactElement } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore, useUIStore } from '@/store/useStore'
import { cn, getFullImageUrl } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { AnnouncementButton } from '@/components/AnnouncementButton'
import { ProcedureInventorySearchButton } from '@/components/ProcedureInventorySearchButton'
import type { Announcement } from '@/api/client'
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
import { clearDashboardTab } from '@/lib/dashboardUtils'
import { clearBugButtonHiddenUntil, getBugButtonHiddenUntil } from '@/lib/storage/appUiStorage'
import { useTheme } from '@/hooks/useTheme'
import { useIsMobile } from '@/hooks/useMobile'
import { UserRoles, USER_ROLE_MAP, type UserRole } from '@/lib/constants'
import { canWriteNonPublicData } from '@/lib/permissions'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { SidebarLogo } from '@/components/SidebarLogo'
import { AuthDeferredShell } from '@/components/AuthDeferredShell'
import { getPublicAnnouncementsQueryOptions } from '@/lib/announcementQueries'

type NavGroup = '功能' | '管理'
type TooltipSide = ComponentProps<typeof TooltipContent>['side']
const SIDEBAR_TRANSITION_MS = 300

interface NavItem {
  title: string
  href: string
  icon: typeof LayoutDashboard
  group: NavGroup
  adminOnly?: boolean
  nonPublicOnly?: boolean
}

type LayoutUser = ReturnType<typeof useAuthStore.getState>['user']

// 全站侧边栏的顺序、路由和 `adminOnly` 权限标记都集中在这里维护。
const navItems: NavItem[] = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard, group: '功能' },
  { title: '试剂订单', href: '/reagents', icon: FlaskConical, group: '功能' },
  { title: '耗材订单', href: '/consumables', icon: ShoppingCart, group: '功能' },
  { title: '库存列表', href: '/inventory', icon: Package, group: '功能' },
  { title: '常用货架', href: '/common-shelf', icon: Archive, group: '功能' },
  { title: '导入数据', href: '/import', icon: FolderInput, group: '功能', nonPublicOnly: true },
  { title: '用户管理', href: '/admin/users', icon: Users, adminOnly: true, group: '管理' },
  { title: '公告管理', href: '/admin/announcements', icon: Megaphone, adminOnly: true, group: '管理' },
]

// 侧边栏入口按角色过滤；后端仍负责最终权限校验。
function getFilteredNavItems(userRole?: UserRole | null) {
  return navItems.filter((item) => {
    if (item.adminOnly && userRole !== UserRoles.ADMIN) {
      return false
    }
    if (item.nonPublicOnly && !canWriteNonPublicData(userRole)) {
      return false
    }
    return true
  })
}

// 桌面侧边栏折叠时通过 `opacity / max-width / ml` 组合隐藏文字，避免布局跳动。
function getSidebarLabelClassName(sidebarCollapsed: boolean, expandedClassName: string) {
  return cn(
    'whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300',
    sidebarCollapsed ? 'opacity-0 max-w-0 ml-0' : expandedClassName
  )
}

// 统一导航激活态和非激活态 class；移动端额外补文字 hover 颜色，桌面端主要靠背景层。
function getNavLinkClassName(
  isActive: boolean,
  baseClassName: string,
  variant: 'desktop' | 'mobile'
) {
  const inactiveClassName = variant === 'mobile'
    ? "text-sidebar-foreground hover:text-foreground transition-[color] duration-200 before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"
    : "text-sidebar-foreground before:content-[''] before:absolute before:inset-0 before:-z-10 before:bg-muted before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200"

  return cn(
    baseClassName,
    isActive ? 'bg-primary text-primary-foreground' : inactiveClassName
  )
}

function DesktopCollapsedTooltip({
  enabled,
  label,
  side = 'right',
  children,
}: {
  enabled: boolean
  label: string
  side?: TooltipSide
  children: ReactElement
}) {
  if (!enabled) {
    return children
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function DesktopSidebarNavItem({
  item,
  pathname,
  sidebarCollapsed,
  sidebarTooltipsEnabled,
}: {
  item: NavItem
  pathname: string
  sidebarCollapsed: boolean
  sidebarTooltipsEnabled: boolean
}) {
  const isActive = pathname === item.href
  const Icon = item.icon

  return (
    <DesktopCollapsedTooltip enabled={sidebarTooltipsEnabled} label={item.title}>
      <Link
        to={item.href}
        className={getNavLinkClassName(
          isActive,
          'flex items-center rounded-lg pl-3 py-2.5 overflow-hidden relative isolate',
          'desktop'
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', isActive ? '' : 'text-sidebar-foreground')} />
        <span className={getSidebarLabelClassName(sidebarCollapsed, 'opacity-100 max-w-50 ml-3')}>
          {item.title}
        </span>
      </Link>
    </DesktopCollapsedTooltip>
  )
}

function MobileSidebarNavItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  onNavigate: () => void
}) {
  const isActive = pathname === item.href
  const Icon = item.icon

  return (
    <Link
      key={item.href}
      to={item.href}
      onClick={onNavigate}
      className={getNavLinkClassName(
        isActive,
        'flex items-center rounded-lg pl-3 py-2 text-base relative isolate',
        'mobile'
      )}
    >
      <Icon className="h-5 w-5 shrink-0 mr-3" />
      {item.title}
    </Link>
  )
}

function DesktopSidebarGroup({
  title,
  items,
  pathname,
  sidebarCollapsed,
  sidebarTooltipsEnabled,
}: {
  title: NavGroup
  items: NavItem[]
  pathname: string
  sidebarCollapsed: boolean
  sidebarTooltipsEnabled: boolean
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className={title === '管理' ? 'mt-6' : 'mb-2'}>
      <div className="px-2 text-sm text-muted-foreground tracking-wider whitespace-nowrap overflow-hidden transition-opacity duration-300 opacity-100 max-h-10 mt-4 mb-2">
        {title}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <DesktopSidebarNavItem
            key={item.href}
            item={item}
            pathname={pathname}
            sidebarCollapsed={sidebarCollapsed}
            sidebarTooltipsEnabled={sidebarTooltipsEnabled}
          />
        ))}
      </div>
    </div>
  )
}

// 桌面端账户入口跳到 `/devices`，并用右侧高亮条标识设备页激活态。
function DesktopUserLink({
  user,
  sidebarCollapsed,
  isDevicesActive,
}: {
  user: LayoutUser
  sidebarCollapsed: boolean
  isDevicesActive: boolean
}) {
  return (
    <Link
      to="/devices"
      className="flex items-center overflow-hidden hover:bg-muted rounded-lg p-1 -mx-1 transition-colors relative"
    >
      <div
        className={cn(
          'absolute right-0 top-1/2 -translate-y-1/2 h-3/4 w-1 bg-primary rounded-md transition-all duration-300 ease-in-out origin-center',
          isDevicesActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
        )}
      />
      <Avatar className="h-10 w-10 shrink-0 mx-auto md:mx-0">
        <AvatarImage src={user?.avatar_url ? getFullImageUrl(user.avatar_url) : undefined} alt={user?.username} />
        <AvatarFallback className="bg-primary text-primary-foreground dark:text-sidebar-foreground">
          {user?.username?.charAt(0).toUpperCase() || 'U'}
        </AvatarFallback>
      </Avatar>
      <div className={getSidebarLabelClassName(sidebarCollapsed, 'opacity-100 max-w-37.5 ml-3')}>
        <p className="text-base truncate text-sidebar-foreground">
          {user?.full_name || user?.username}
        </p>
        <p className="text-sm text-sidebar-foreground/70 truncate">
          {user?.role ? USER_ROLE_MAP[user.role] || user.role : '用户'}
        </p>
      </div>
    </Link>
  )
}

// 桌面侧边栏承载权限过滤后的分组导航、账户入口、主题切换和退出入口。
function DesktopSidebar({
  pathname,
  user,
  sidebarCollapsed,
  theme,
  toggleTheme,
  logoutConfirming,
  onLogout,
  onLogoutBlur,
  filteredNavItems,
  sidebarTooltipsEnabled,
}: {
  pathname: string
  user: LayoutUser
  sidebarCollapsed: boolean
  theme: string
  toggleTheme: () => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
  filteredNavItems: NavItem[]
  sidebarTooltipsEnabled: boolean
}) {
  const functionalItems = filteredNavItems.filter((item) => item.group === '功能')
  const managementItems = filteredNavItems.filter((item) => item.group === '管理')
  const isDevicesActive = pathname.startsWith('/devices')
  const themeLabel = theme === 'dark' ? '切换亮色模式' : '切换暗黑模式'
  const tooltipThemeLabel = theme === 'dark' ? '切换亮色' : '切换暗黑'
  const logoutLabel = logoutConfirming ? '确认退出' : '退出登录'
  const logoutTooltipLabel = logoutConfirming ? '再次点击确认退出' : '退出登录'

  return (
    <aside
      data-desktop-sidebar="true"
      className={cn(
        'fixed inset-y-0 left-0 z-30 bg-sidebar flex flex-col transition-[width] duration-300 ease-in-out',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex items-center justify-center h-20 pt-16 pb-8 overflow-hidden whitespace-nowrap shrink-0 relative">
        {sidebarCollapsed ? <SidebarLogo className="size-9 pl-3" /> : null}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center pt-16 pb-8 pointer-events-none',
            sidebarCollapsed ? 'opacity-0 transition-none' : 'opacity-100 transition-opacity duration-200 ease-in delay-50'
          )}
        >
          <h1 className="text-2xl font-bold text-primary w-64 text-center pl-2 pointer-events-auto">
            实验室库存管理
          </h1>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden -mr-2">
        <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
          <nav className={cn('flex flex-col pb-2 transition-[width] duration-300', sidebarCollapsed ? 'w-16' : 'w-64')}>
            <div className="pl-4 pr-1">
              <DesktopSidebarGroup
                title="功能"
                items={functionalItems}
                pathname={pathname}
                sidebarCollapsed={sidebarCollapsed}
                sidebarTooltipsEnabled={sidebarTooltipsEnabled}
              />
              <DesktopSidebarGroup
                title="管理"
                items={managementItems}
                pathname={pathname}
                sidebarCollapsed={sidebarCollapsed}
                sidebarTooltipsEnabled={sidebarTooltipsEnabled}
              />
            </div>
          </nav>
        </div>
      </div>

      <div className="pl-4 py-4 pr-1 shrink-0">
        <DesktopUserLink
          user={user}
          sidebarCollapsed={sidebarCollapsed}
          isDevicesActive={isDevicesActive}
        />

        <div className="flex flex-col gap-1 overflow-hidden pt-4">
          <DesktopCollapsedTooltip enabled={sidebarTooltipsEnabled} label={tooltipThemeLabel}>
            <Button
              variant="ghost"
              onClick={toggleTheme}
              className="justify-start text-base p-2 h-11 w-full hover:bg-muted text-sidebar-foreground transition-colors"
            >
              {theme === 'dark' ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
              <span className={getSidebarLabelClassName(sidebarCollapsed, 'opacity-100 max-w-50 ml-3')}>
                {themeLabel}
              </span>
            </Button>
          </DesktopCollapsedTooltip>

          <DesktopCollapsedTooltip enabled={sidebarTooltipsEnabled} label={logoutTooltipLabel}>
            <Button
              variant={logoutConfirming ? 'destructive' : 'ghost'}
              onClick={onLogout}
              onBlur={onLogoutBlur}
              className={cn(
                'justify-start p-2 h-11 w-full text-base',
                logoutConfirming ? 'transition-none' : 'hover:bg-muted text-sidebar-foreground transition-colors'
              )}
            >
              <LogOut className="size-5 shrink-0" />
              <span className={getSidebarLabelClassName(sidebarCollapsed, 'opacity-100 max-w-50 ml-3')}>
                {logoutLabel}
              </span>
            </Button>
          </DesktopCollapsedTooltip>
        </div>
      </div>
    </aside>
  )
}

function MobileSidebarSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: NavGroup
  items: NavItem[]
  pathname: string
  onNavigate: () => void
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div>
      <p className="px-2 mb-2 text-sm text-muted-foreground uppercase tracking-wider">{title}</p>
      <div className="space-y-1">
        {items.map((item) => (
          <MobileSidebarNavItem
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}

// 移动端账户入口点击后关闭菜单，并沿用 `/devices` 的激活标识。
function MobileUserLink({
  pathname,
  user,
  closeMobileMenu,
}: {
  pathname: string
  user: LayoutUser
  closeMobileMenu: () => void
}) {
  const isDevicesActive = pathname.startsWith('/devices')

  return (
    <Link
      to="/devices"
      onClick={closeMobileMenu}
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
  )
}

// 移动端提供主题切换和二次确认退出入口。
function MobileSidebarActions({
  theme,
  toggleTheme,
  logoutConfirming,
  onLogout,
  onLogoutBlur,
}: {
  theme: string
  toggleTheme: () => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
}) {
  const themeLabel = theme === 'dark' ? '切换亮色模式' : '切换暗黑模式'

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        onClick={toggleTheme}
        className="w-full text-base h-10 justify-start p-2 text-sidebar-foreground hover:bg-muted transition-colors"
      >
        {theme === 'dark' ? <Sun className="mr-3 size-5 shrink-0" /> : <Moon className="mr-3 size-5 shrink-0" />}
        {themeLabel}
      </Button>

      <Button
        variant={logoutConfirming ? 'destructive' : 'ghost'}
        onClick={onLogout}
        onBlur={onLogoutBlur}
        className={cn(
          'justify-start p-2 h-11 w-full text-base',
          logoutConfirming ? 'transition-none' : 'hover:bg-muted text-sidebar-foreground transition-colors'
        )}
      >
        <LogOut className="mr-3 size-5 shrink-0" />
        {logoutConfirming ? '确认退出' : '退出登录'}
      </Button>
    </div>
  )
}

// 移动端通过遮罩和抽屉展示权限过滤后的导航，点击遮罩关闭菜单。
function MobileSidebar({
  pathname,
  user,
  mobileMenuOpen,
  setMobileMenuOpen,
  theme,
  toggleTheme,
  logoutConfirming,
  onLogout,
  onLogoutBlur,
  filteredNavItems,
}: {
  pathname: string
  user: LayoutUser
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  theme: string
  toggleTheme: () => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
  filteredNavItems: NavItem[]
}) {
  const functionalItems = filteredNavItems.filter((item) => item.group === '功能')
  const managementItems = filteredNavItems.filter((item) => item.group === '管理')
  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden transition-opacity duration-200',
        mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      onClick={() => setMobileMenuOpen(false)}
    >
      <aside
        className={cn(
          'fixed inset-y-0 left-0 w-64 border-r border-border bg-sidebar transition-transform duration-200 flex flex-col',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col items-center justify-center pt-8 pb-4 shrink-0">
          <h1 className="text-2xl font-bold text-primary px-2">实验室库存管理</h1>
        </div>

        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-sidebar-foreground/20">
            <nav className="flex flex-col space-y-4 p-4 w-64 pb-2">
              <MobileSidebarSection
                title="功能"
                items={functionalItems}
                pathname={pathname}
                onNavigate={closeMobileMenu}
              />
              <MobileSidebarSection
                title="管理"
                items={managementItems}
                pathname={pathname}
                onNavigate={closeMobileMenu}
              />
            </nav>
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-border/50 shrink-0">
          <MobileUserLink
            pathname={pathname}
            user={user}
            closeMobileMenu={closeMobileMenu}
          />
          <MobileSidebarActions
            theme={theme}
            toggleTheme={toggleTheme}
            logoutConfirming={logoutConfirming}
            onLogout={onLogout}
            onLogoutBlur={onLogoutBlur}
          />
        </div>
      </aside>
    </div>
  )
}

// 把桌面侧边栏状态映射成主内容 `md:ml-16 / md:ml-64`，移动端不偏移。
function getMainContentShiftClass(showDesktopSidebar: boolean, sidebarCollapsed: boolean) {
  if (!showDesktopSidebar) {
    return ''
  }

  return sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
}

function useDesktopSidebarTooltipGuard({
  sidebarCollapsed,
  toggleSidebar,
}: {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}) {
  const [sidebarTooltipSuspended, setSidebarTooltipSuspended] = useState(false)
  const sidebarTooltipTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)

  const blurActiveElement = useCallback(() => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('[data-desktop-sidebar="true"]')
    ) {
      activeElement.blur()
    }
  }, [])

  const suspendSidebarTooltips = useCallback(() => {
    setSidebarTooltipSuspended(true)

    if (sidebarTooltipTimerRef.current !== null) {
      globalThis.clearTimeout(sidebarTooltipTimerRef.current)
    }

    sidebarTooltipTimerRef.current = globalThis.setTimeout(() => {
      setSidebarTooltipSuspended(false)
      sidebarTooltipTimerRef.current = null
    }, SIDEBAR_TRANSITION_MS)
  }, [])

  const handleToggleSidebar = useCallback(() => {
    blurActiveElement()
    suspendSidebarTooltips()
    toggleSidebar()
  }, [blurActiveElement, suspendSidebarTooltips, toggleSidebar])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
      event.preventDefault()
      handleToggleSidebar()
    }
  }, [handleToggleSidebar])

  useEffect(() => {
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    return () => {
      if (sidebarTooltipTimerRef.current !== null) {
        globalThis.clearTimeout(sidebarTooltipTimerRef.current)
      }
    }
  }, [])

  return {
    handleToggleSidebar,
    sidebarTooltipsEnabled: sidebarCollapsed && !sidebarTooltipSuspended,
  }
}

// 页头统一放桌面侧栏开关、公告横幅/公告按钮，以及移动端菜单和主题入口。
function LayoutHeader({
  showDesktopSidebar,
  sidebarCollapsed,
  toggleSidebar,
  showBugButton,
  onBugButtonRightClick,
  mobileMenuOpen,
  setMobileMenuOpen,
  announcements,
  theme,
  toggleTheme,
}: {
  showDesktopSidebar: boolean
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  showBugButton: boolean
  onBugButtonRightClick: () => void
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  announcements: Announcement[]
  theme: string
  toggleTheme: () => void
}) {
  return (
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
                {sidebarCollapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{sidebarCollapsed ? '展开侧边栏 (Ctrl+B)' : '折叠侧边栏 (Ctrl+B)'}</p>
            </TooltipContent>
          </Tooltip>
          {showBugButton && (
            <BugReportButton
              variant="ghost"
              size="icon"
              className="h-10 w-10 hidden md:flex transition-colors"
              showText={false}
              onRightClick={onBugButtonRightClick}
            />
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
      <div className="hidden md:flex items-center gap-1">
        <ProcedureInventorySearchButton />
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
        <ProcedureInventorySearchButton />
        <AnnouncementButton announcements={announcements} />
      </div>
    </header>
  )
}

function LayoutDeferredOutlet({ pathname }: Readonly<{ pathname: string }>) {
  // 骨架按页面类型区分到“仪表盘/列表页”两档，避免为每个页面单独维护一份占位布局。
  return <AuthDeferredShell pathname={pathname} />
}

// 布局页负责拉取公告、维护桌面/移动侧栏状态、处理退出确认和移动端滚动锁定。
export function Layout({ deferOutlet = false }: Readonly<{ deferOutlet?: boolean }>) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user, logout } = useAuthStore()
  const userId = user?.id
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const isMobile = useIsMobile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [logoutConfirming, setLogoutConfirming] = useState(false)
  const announcementsQuery = useQuery({
    ...getPublicAnnouncementsQueryOptions(),
    enabled: Boolean(userId),
  })
  const announcements = announcementsQuery.data ?? []
  const [showBugButton, setShowBugButton] = useState(
    () => Date.now() >= getBugButtonHiddenUntil()
  )
  useEffect(() => {
    if (!userId) {
      return
    }

    const { queryKey, queryFn, staleTime } = getPublicAnnouncementsQueryOptions()
    queryClient.fetchQuery({ queryKey, queryFn, staleTime }).catch(() => {})
  }, [location.pathname, queryClient, userId])

  useEffect(() => {
    if (announcementsQuery.error) {
      console.error('Failed to fetch announcements:', announcementsQuery.error)
    }
  }, [announcementsQuery.error])

  const handleBugButtonRightClick = useCallback(() => {
    setShowBugButton(false)
  }, [])

  const handleLogout = useCallback(() => {
    // 二次确认期间不立即登出，避免误触；确认后再清理隐藏状态和仪表盘持久化页签。
    if (logoutConfirming) {
      clearBugButtonHiddenUntil()
      clearDashboardTab()
      logout()
      return
    }

    setLogoutConfirming(true)
  }, [logout, logoutConfirming])

  const handleLogoutBlur = useCallback(() => {
    if (logoutConfirming) {
      setLogoutConfirming(false)
    }
  }, [logoutConfirming])

  const filteredNavItems = getFilteredNavItems(user?.role)

  const { handleToggleSidebar, sidebarTooltipsEnabled } = useDesktopSidebarTooltipGuard({
    sidebarCollapsed,
    toggleSidebar,
  })

  useEffect(() => {
    // 移动端侧栏打开时锁 body 滚动，防止背景内容跟随滚动造成“抽屉 + 页面”双滚动。
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  const showDesktopSidebar = !isMobile

  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      {showDesktopSidebar && (
        <DesktopSidebar
          pathname={location.pathname}
          user={user}
          sidebarCollapsed={sidebarCollapsed}
          theme={theme}
          toggleTheme={toggleTheme}
          logoutConfirming={logoutConfirming}
          onLogout={handleLogout}
          onLogoutBlur={handleLogoutBlur}
          filteredNavItems={filteredNavItems}
          sidebarTooltipsEnabled={sidebarTooltipsEnabled}
        />
      )}

      <MobileSidebar
        pathname={location.pathname}
        user={user}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        theme={theme}
        toggleTheme={toggleTheme}
        logoutConfirming={logoutConfirming}
        onLogout={handleLogout}
        onLogoutBlur={handleLogoutBlur}
        filteredNavItems={filteredNavItems}
      />

      <div
        className={cn(
          'flex-1 flex flex-col min-h-screen min-w-0 w-full transition-[margin-left] duration-300 ease-in-out',
          getMainContentShiftClass(showDesktopSidebar, sidebarCollapsed)
        )}
      >
        <main className="flex-1 py-2 md:py-3 lg:py-4 ml-2 pr-2 md:ml-3 md:pr-3 lg:ml-3 lg:pr-4">
          <div className="bg-page-card rounded-lg page-card-shadow-light dark:page-card-shadow-dark min-h-full flex flex-col">
            <LayoutHeader
              showDesktopSidebar={showDesktopSidebar}
              sidebarCollapsed={sidebarCollapsed}
              toggleSidebar={handleToggleSidebar}
              showBugButton={showBugButton}
              onBugButtonRightClick={handleBugButtonRightClick}
              mobileMenuOpen={mobileMenuOpen}
              setMobileMenuOpen={setMobileMenuOpen}
              announcements={announcements}
              theme={theme}
              toggleTheme={toggleTheme}
            />

            <div className="px-4 py-6 md:px-6">
              {deferOutlet ? <LayoutDeferredOutlet pathname={location.pathname} /> : <Outlet />}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
