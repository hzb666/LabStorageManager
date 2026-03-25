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
import { UserRoles, USER_ROLE_MAP } from '@/lib/constants'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { SidebarLogo } from '@/components/SidebarLogo'

/**
 * 导航分组类型，区分侧边栏中的功能区与管理区。
 * 存在原因是收敛分组可选值，避免分组名称在多处硬编码产生不一致。
 */
type NavGroup = '功能' | '管理'

/**
 * 单个导航项的数据结构定义。
 * 存在原因是统一菜单标题、路由、图标和权限标记字段，便于导航渲染与权限过滤复用。
 */
interface NavItem {
  title: string
  href: string
  icon: typeof LayoutDashboard
  group: NavGroup
  adminOnly?: boolean
}

/**
 * 布局视图组件的入参定义。
 * 存在原因是集中声明布局层所需状态和事件回调，保证壳层组件与状态编排层契约清晰。
 */
interface LayoutViewProps {
  locationPathname: string
  user: ReturnType<typeof useAuthStore>['user']
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  theme: string
  toggleTheme: () => void
  isMobile: boolean
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
  announcements: Announcement[]
  filteredNavItems: NavItem[]
  showBugButton: boolean
  onBugButtonRightClick: () => void
}

/**
 * 全站侧边栏导航配置常量。
 * 存在原因是把菜单元数据集中管理，便于统一维护导航顺序、路由和权限控制规则。
 */
const navItems: NavItem[] = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard, group: '功能' },
  { title: '试剂订单', href: '/reagents', icon: FlaskConical, group: '功能' },
  { title: '耗材订单', href: '/consumables', icon: ShoppingCart, group: '功能' },
  { title: '库存列表', href: '/inventory', icon: Package, group: '功能' },
  { title: '常用货架', href: '/common-shelf', icon: Archive, group: '功能' },
  { title: '导入数据', href: '/import', icon: FolderInput, group: '功能' },
  { title: '用户管理', href: '/admin/users', icon: Users, adminOnly: true, group: '管理' },
  { title: '公告管理', href: '/admin/announcements', icon: Megaphone, adminOnly: true, group: '管理' },
]

/**
 * 根据当前用户角色过滤导航项，保持管理员菜单的权限逻辑不变。
 * 这个函数存在是为了把权限过滤规则从页面主体中拆出，降低主组件复杂度。
 */
function getFilteredNavItems(userRole?: string) {
  return navItems.filter((item) => !item.adminOnly || userRole === UserRoles.ADMIN)
}

/**
 * 计算侧边栏文字的展开收起 class，保持原有动画表现不变。
 * 这个函数存在是为了把多处重复的 class 选择收敛到同一入口。
 */
function getSidebarLabelClassName(sidebarCollapsed: boolean, expandedClassName: string) {
  return cn(
    'whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300',
    sidebarCollapsed ? 'opacity-0 max-w-0 ml-0' : expandedClassName
  )
}

/**
 * 计算导航链接样式，保持激活态与 hover 态表现不变。
 * 这个函数存在是为了避免桌面端和移动端在多个位置重复拼接 class。
 */
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

/**
 * 渲染桌面侧边栏中的单个导航项。
 * 这个函数存在是为了把导航项结构从侧边栏主体中拆出，降低组合层复杂度。
 */
function DesktopSidebarNavItem({
  item,
  pathname,
  sidebarCollapsed,
}: {
  item: NavItem
  pathname: string
  sidebarCollapsed: boolean
}) {
  const isActive = pathname === item.href
  const Icon = item.icon

  return (
    <Tooltip key={item.href}>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      {sidebarCollapsed && (
        <TooltipContent side="right">
          <p>{item.title}</p>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

/**
 * 渲染移动端侧边栏中的单个导航项。
 * 这个函数存在是为了把移动端导航项结构从菜单容器中拆出，降低移动菜单复杂度。
 */
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

/**
 * 渲染桌面侧边栏的导航分组。
 * 这个函数存在是为了把“功能/管理”分组结构从侧边栏主体中拆出，缩短组件长度。
 */
function DesktopSidebarGroup({
  title,
  items,
  pathname,
  sidebarCollapsed,
}: {
  title: NavGroup
  items: NavItem[]
  pathname: string
  sidebarCollapsed: boolean
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
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 渲染桌面端账户入口。
 * 这个函数存在是为了把账户展示与激活态样式从侧边栏主体中拆出，减少主组件噪音。
 */
function DesktopUserLink({
  user,
  sidebarCollapsed,
  isDevicesActive,
}: {
  user: LayoutViewProps['user']
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

/**
 * 渲染桌面侧边栏。
 * 这个函数存在是为了把桌面端导航、账户区和操作区从 Layout 主组件中拆出。
 */
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
}: {
  pathname: string
  user: LayoutViewProps['user']
  sidebarCollapsed: boolean
  theme: string
  toggleTheme: () => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
  filteredNavItems: NavItem[]
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
              />
              <DesktopSidebarGroup
                title="管理"
                items={managementItems}
                pathname={pathname}
                sidebarCollapsed={sidebarCollapsed}
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
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            {sidebarCollapsed && (
              <TooltipContent side="right">
                <p>{tooltipThemeLabel}</p>
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            {sidebarCollapsed && (
              <TooltipContent side="right">
                <p>{logoutTooltipLabel}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}

/**
 * 渲染移动侧边栏中的导航分组。
 * 这个函数存在是为了把移动端分组渲染从菜单主体中拆出，降低 MobileSidebar 复杂度。
 */
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

/**
 * 渲染移动侧边栏底部账户区。
 * 这个函数存在是为了把账户展示与操作按钮从 MobileSidebar 中拆出，降低其复杂度。
 */
function MobileSidebarFooter({
  pathname,
  user,
  closeMobileMenu,
  theme,
  toggleTheme,
  logoutConfirming,
  onLogout,
  onLogoutBlur,
}: {
  pathname: string
  user: LayoutViewProps['user']
  closeMobileMenu: () => void
  theme: string
  toggleTheme: () => void
  logoutConfirming: boolean
  onLogout: () => void
  onLogoutBlur: () => void
}) {
  return (
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
  )
}

/**
 * 渲染移动侧边栏中的账户入口。
 * 这个函数存在是为了把账户展示从 MobileSidebarFooter 中拆出，进一步降低复杂度。
 */
function MobileUserLink({
  pathname,
  user,
  closeMobileMenu,
}: {
  pathname: string
  user: LayoutViewProps['user']
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

/**
 * 渲染移动侧边栏中的主题和退出按钮。
 * 这个函数存在是为了把按钮交互从 MobileSidebarFooter 中拆出，进一步降低复杂度。
 */
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

/**
 * 渲染移动侧边栏。
 * 这个函数存在是为了把移动端菜单与账户区从 Layout 主组件中拆出，降低组合复杂度。
 */
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
  user: LayoutViewProps['user']
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

        <MobileSidebarFooter
          pathname={pathname}
          user={user}
          closeMobileMenu={closeMobileMenu}
          theme={theme}
          toggleTheme={toggleTheme}
          logoutConfirming={logoutConfirming}
          onLogout={onLogout}
          onLogoutBlur={onLogoutBlur}
        />
      </aside>
    </div>
  )
}

/**
 * 计算主内容区域的桌面端左侧偏移 class。
 * 这个函数存在是为了移除布局组件中的嵌套三元表达式，降低渲染复杂度。
 */
function getMainContentShiftClass(showDesktopSidebar: boolean, sidebarCollapsed: boolean) {
  if (!showDesktopSidebar) {
    return ''
  }

  return sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
}

/**
 * 渲染主内容页头。
 * 这个函数存在是为了把页头的侧栏切换、公告区和移动端按钮从主布局中拆出。
 */
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
  )
}

/**
 * 渲染布局页的整体视图。
 * 这个函数存在是为了把主 Layout 组件收缩成状态编排层，避免继续承担大段 JSX。
 */
function LayoutView({
  locationPathname,
  user,
  sidebarCollapsed,
  toggleSidebar,
  theme,
  toggleTheme,
  isMobile,
  mobileMenuOpen,
  setMobileMenuOpen,
  logoutConfirming,
  onLogout,
  onLogoutBlur,
  announcements,
  filteredNavItems,
  showBugButton,
  onBugButtonRightClick,
}: LayoutViewProps) {
  const showDesktopSidebar = !isMobile

  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      {showDesktopSidebar && (
        <DesktopSidebar
          pathname={locationPathname}
          user={user}
          sidebarCollapsed={sidebarCollapsed}
          theme={theme}
          toggleTheme={toggleTheme}
          logoutConfirming={logoutConfirming}
          onLogout={onLogout}
          onLogoutBlur={onLogoutBlur}
          filteredNavItems={filteredNavItems}
        />
      )}

      <MobileSidebar
        pathname={locationPathname}
        user={user}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        theme={theme}
        toggleTheme={toggleTheme}
        logoutConfirming={logoutConfirming}
        onLogout={onLogout}
        onLogoutBlur={onLogoutBlur}
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
              toggleSidebar={toggleSidebar}
              showBugButton={showBugButton}
              onBugButtonRightClick={onBugButtonRightClick}
              mobileMenuOpen={mobileMenuOpen}
              setMobileMenuOpen={setMobileMenuOpen}
              announcements={announcements}
              theme={theme}
              toggleTheme={toggleTheme}
            />

            <div className="px-4 py-6 md:px-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * 布局页负责公告数据、侧边栏状态和全局壳层编排。
 * 这个函数存在是为了保持原有导航、公告和退出行为不变，同时收缩主组件复杂度。
 */
export function Layout() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const isMobile = useIsMobile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [logoutConfirming, setLogoutConfirming] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [showBugButton, setShowBugButton] = useState(() => !getBugButtonHidden())

  useEffect(() => {
    let cancelled = false

    const fetchAnnouncements = async () => {
      try {
        const response = await announcementAPI.getPublic()
        if (!cancelled) {
          setAnnouncements(response.data)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch announcements:', error)
        }
      }
    }

    fetchAnnouncements()

    return () => {
      cancelled = true
    }
  }, [])

  const handleBugButtonRightClick = useCallback(() => {
    setShowBugButton(false)
  }, [])

  const handleLogout = useCallback(() => {
    if (logoutConfirming) {
      clearBugButtonHidden()
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

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
      event.preventDefault()
      toggleSidebar()
    }
  }, [toggleSidebar])

  useEffect(() => {
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <LayoutView
      locationPathname={location.pathname}
      user={user}
      sidebarCollapsed={sidebarCollapsed}
      toggleSidebar={toggleSidebar}
      theme={theme}
      toggleTheme={toggleTheme}
      isMobile={isMobile}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      logoutConfirming={logoutConfirming}
      onLogout={handleLogout}
      onLogoutBlur={handleLogoutBlur}
      announcements={announcements}
      filteredNavItems={filteredNavItems}
      showBugButton={showBugButton}
      onBugButtonRightClick={handleBugButtonRightClick}
    />
  )
}
