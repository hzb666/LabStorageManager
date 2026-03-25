/**
 * 仪表盘页面
 * 轻量级 Tab 容器：显示统计卡片 + 按需加载对应 Tab
 * activeTab 通过 localStorage 持久化
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { ShoppingCart, Package, ArrowRightLeft, Loader2 } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { UserRoles } from '@/lib/constants'
import { useAuthStore } from '@/store/useStore'

import {
  type DashboardTab,
  DASHBOARD_TAB_STORAGE_KEY,
  subscribeDashboardCountsRefresh,
} from '../lib/dashboardUtils'
import { DashboardReagentTab } from './dashboard/DashboardReagentTab'
import { DashboardConsumableTab } from './dashboard/DashboardConsumableTab'
import { DashboardBorrowTab } from './dashboard/DashboardBorrowTab'
import { DashboardStockinTab } from './dashboard/DashboardStockinTab'

import { reagentOrderAPI, consumableOrderAPI, inventoryAPI } from '@/api/client'

type DashboardCounts = {
  reagentCount: number
  consumableCount: number
  borrowCount: number
  stockinCount: number
}

type DashboardCountsCache = {
  userKey: string
  counts: DashboardCounts
}

type DashboardCountsState = {
  counts: DashboardCounts
  isLoading: boolean
}

type DashboardCardItem = {
  tab: DashboardTab
  title: string
  icon: React.ElementType
  value: React.ReactNode
}

const EMPTY_COUNTS: DashboardCounts = {
  reagentCount: 0,
  consumableCount: 0,
  borrowCount: 0,
  stockinCount: 0,
}

let dashboardCountsCache: DashboardCountsCache | null = null

/**
 * 判断统计卡片数字是否真正发生变化，避免重复写入缓存和状态。
 * 存在原因：统计数据来自多个接口汇总，结构固定，适合做轻量浅比较。
 */
function isCountsEqual(a: DashboardCounts, b: DashboardCounts): boolean {
  return (
    a.reagentCount === b.reagentCount &&
    a.consumableCount === b.consumableCount &&
    a.borrowCount === b.borrowCount &&
    a.stockinCount === b.stockinCount
  )
}

/**
 * 渲染单个统计卡片，并统一处理高亮态样式。
 * 存在原因：让页面主体只负责组织卡片数据，不再堆叠重复 JSX。
 */
function StatCard({
  title,
  icon: Icon,
  value,
  onClick,
  isActive,
}: Readonly<{
  title: string
  icon: React.ElementType
  value: React.ReactNode
  onClick: () => void
  isActive: boolean
}>) {
  return (
    <Card
      className={cn(
        'transition-all cursor-pointer hover:bg-accent',
        isActive && 'border bg-accent/50 dark:border-primary'
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold flex h-8 items-center', isActive && 'text-primary')}>{value}</div>
      </CardContent>
    </Card>
  )
}

const ALL_TABS: DashboardTab[] = ['reagents', 'consumables', 'borrows', 'stockin']

/**
 * 读取上次保存的仪表盘 Tab，并确保结果仍在当前允许范围内。
 * 存在原因：public/admin 用户可见 Tab 不同，直接复用旧值会落到非法页签。
 */
function getSavedTab(allowedTabs: DashboardTab[]): DashboardTab {
  try {
    const saved = localStorage.getItem(DASHBOARD_TAB_STORAGE_KEY)
    if (saved && allowedTabs.includes(saved as DashboardTab)) {
      return saved as DashboardTab
    }
  } catch {
    // ignore localStorage errors
  }
  return allowedTabs[0] ?? 'borrows'
}

/**
 * 持久化当前激活的仪表盘 Tab。
 * 存在原因：返回仪表盘时需要尽量恢复用户上次停留位置。
 */
function saveTab(tab: DashboardTab) {
  try {
    localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, tab)
  } catch {
    // ignore localStorage errors
  }
}

/**
 * 汇总分组订单数量。
 * 存在原因：试剂和耗材接口都返回按状态分组的数据结构，页面只关心总条数。
 */
function countGroupedOrders(grouped: Record<string, { orders: unknown[] }>): number {
  return Object.values(grouped).reduce((sum, item) => sum + (item.orders?.length ?? 0), 0)
}

/**
 * 加载公用账户所需的统计数字。
 * 存在原因：public 账户只展示借用数据，单独拆出可减少主流程分支。
 */
async function loadPublicDashboardCounts(): Promise<DashboardCounts> {
  const borrowRes = await inventoryAPI.getMyBorrows()
  return {
    reagentCount: 0,
    consumableCount: 0,
    borrowCount: (borrowRes.data?.data ?? []).length,
    stockinCount: 0,
  }
}

/**
 * 加载普通账户所需的全部统计数字。
 * 存在原因：试剂、耗材、借用、待入库分别来自不同接口，集中封装后更易复用缓存逻辑。
 */
async function loadMemberDashboardCounts(): Promise<DashboardCounts> {
  const [reagentRes, consumableRes, borrowRes, stockinRes] = await Promise.all([
    reagentOrderAPI.getMyReagentOrders(),
    consumableOrderAPI.getMyConsumableOrders(),
    inventoryAPI.getMyBorrows(),
    inventoryAPI.getPendingStockin(),
  ])

  const reagentGrouped = (reagentRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>
  const consumableGrouped = (consumableRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>

  return {
    reagentCount: countGroupedOrders(reagentGrouped),
    consumableCount: countGroupedOrders(consumableGrouped),
    borrowCount: (borrowRes.data?.data ?? []).length,
    stockinCount: (stockinRes.data?.data ?? []).length,
  }
}

/**
 * 统一按账户角色选择统计加载方式。
 * 存在原因：把“public / 非 public”分叉留在一处，降低 effect 内部复杂度。
 */
function loadDashboardCountsByRole(isPublicUser: boolean): Promise<DashboardCounts> {
  return isPublicUser ? loadPublicDashboardCounts() : loadMemberDashboardCounts()
}

/**
 * 基于当前用户和缓存读取仪表盘统计数字。
 * 存在原因：页面返回时希望优先复用已有统计，避免每次切换页签都闪动 loading。
 */
function useDashboardCounts(userKey: string, isPublicUser: boolean, refreshToken: number): DashboardCountsState {
  const cachedCountsForUser = dashboardCountsCache?.userKey === userKey ? dashboardCountsCache.counts : null
  const [countsState, setCountsState] = useState<DashboardCountsCache | null>(() =>
    cachedCountsForUser ? { userKey, counts: cachedCountsForUser } : null
  )
  const counts = countsState?.userKey === userKey ? countsState.counts : cachedCountsForUser ?? EMPTY_COUNTS
  const isLoading = cachedCountsForUser === null && countsState?.userKey !== userKey

  useEffect(() => {
    let cancelled = false
    const cachedCounts = dashboardCountsCache?.userKey === userKey ? dashboardCountsCache.counts : null

    const applyCounts = (nextCounts: DashboardCounts) => {
      if (cancelled) {
        return
      }

      dashboardCountsCache = {
        userKey,
        counts: nextCounts,
      }

      setCountsState((prev) => {
        if (prev?.userKey === userKey && isCountsEqual(prev.counts, nextCounts)) {
          return prev
        }
        return { userKey, counts: nextCounts }
      })
    }

    const syncCounts = async () => {
      try {
        const nextCounts = await loadDashboardCountsByRole(isPublicUser)
        applyCounts(nextCounts)
      } catch {
        if (cachedCounts !== null) {
          return
        }
        applyCounts(EMPTY_COUNTS)
      }
    }

    void syncCounts()
    return () => {
      cancelled = true
    }
  }, [isPublicUser, refreshToken, userKey])

  return { counts, isLoading }
}

/**
 * 订阅子 Tab 发出的统计刷新信号，并将其转成可依赖的计数器。
 * 存在原因：统计卡片使用本地缓存后，需要一个显式刷新入口而不是依赖切 Tab 隐式触发。
 */
function useDashboardRefreshToken(): number {
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => subscribeDashboardCountsRefresh(() => {
    setRefreshToken((value) => value + 1)
  }), [])

  return refreshToken
}

/**
 * 构造当前可见的统计卡片配置。
 * 存在原因：把角色判断和卡片数据从 JSX 中提到命名结构，降低页面渲染分支密度。
 */
function getDashboardCardItems(
  isPublicUser: boolean,
  counts: DashboardCounts,
  isLoading: boolean
): DashboardCardItem[] {
  const loadingValue = <Loader2 className="size-5 animate-spin text-muted-foreground" />
  const borrowCard: DashboardCardItem = {
    tab: 'borrows',
    title: '当前借用',
    icon: Package,
    value: isLoading ? loadingValue : counts.borrowCount,
  }

  if (isPublicUser) {
    return [borrowCard]
  }

  return [
    {
      tab: 'reagents',
      title: '试剂订单',
      icon: ShoppingCart,
      value: isLoading ? loadingValue : counts.reagentCount,
    },
    {
      tab: 'consumables',
      title: '耗材订单',
      icon: ShoppingCart,
      value: isLoading ? loadingValue : counts.consumableCount,
    },
    borrowCard,
    {
      tab: 'stockin',
      title: '待入库',
      icon: ArrowRightLeft,
      value: isLoading ? loadingValue : counts.stockinCount,
    },
  ]
}

/**
 * 渲染统计卡片网格。
 * 存在原因：页面主体只保留状态编排，卡片布局细节独立收口。
 */
function DashboardStats({
  isPublicUser,
  activeTab,
  counts,
  isLoading,
  onTabChange,
}: Readonly<{
  isPublicUser: boolean
  activeTab: DashboardTab
  counts: DashboardCounts
  isLoading: boolean
  onTabChange: (tab: DashboardTab) => void
}>) {
  const cards = getDashboardCardItems(isPublicUser, counts, isLoading)

  return (
    <div className={cn('grid gap-3', isPublicUser ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4')}>
      {cards.map((card) => (
        <StatCard
          key={card.tab}
          title={card.title}
          icon={card.icon}
          value={card.value}
          onClick={() => onTabChange(card.tab)}
          isActive={activeTab === card.tab}
        />
      ))}
    </div>
  )
}

/**
 * 根据当前页签渲染对应的仪表盘子页面。
 * 存在原因：把页面内容分派从主组件中抽离，降低 JSX 条件分支数量。
 */
function DashboardTabContent({
  isPublicUser,
  activeTab,
}: Readonly<{
  isPublicUser: boolean
  activeTab: DashboardTab
}>) {
  if (!isPublicUser && activeTab === 'reagents') {
    return <DashboardReagentTab />
  }
  if (!isPublicUser && activeTab === 'consumables') {
    return <DashboardConsumableTab />
  }
  if (activeTab === 'borrows') {
    return <DashboardBorrowTab />
  }
  if (!isPublicUser && activeTab === 'stockin') {
    return <DashboardStockinTab />
  }
  return null
}

/**
 * 组织仪表盘页签、统计与对应子页面。
 * 存在原因：仪表盘是多个热点子页的容器，主组件应只保留权限、页签和缓存编排。
 */
export function Dashboard() {
  const currentUser = useAuthStore((state) => state.user)
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC
  const userKey = `${currentUser?.id ?? 'anonymous'}-${currentUser?.role ?? 'unknown'}`
  const refreshToken = useDashboardRefreshToken()
  const allowedTabs = useMemo(
    () => (isPublicUser ? (['borrows'] as DashboardTab[]) : ALL_TABS),
    [isPublicUser]
  )

  const [selectedTab, setSelectedTab] = useState<DashboardTab>(() => getSavedTab(allowedTabs))
  const activeTab = useMemo(
    () => (allowedTabs.includes(selectedTab) ? selectedTab : getSavedTab(allowedTabs)),
    [allowedTabs, selectedTab]
  )
  const { counts, isLoading } = useDashboardCounts(userKey, isPublicUser, refreshToken)

  const handleTabChange = useCallback((tab: DashboardTab) => {
    if (!allowedTabs.includes(tab)) {
      return
    }
    setSelectedTab(tab)
  }, [allowedTabs])

  useEffect(() => {
    saveTab(activeTab)
  }, [activeTab])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">仪表盘</h1>
      </div>

      <DashboardStats
        isPublicUser={isPublicUser}
        activeTab={activeTab}
        counts={counts}
        isLoading={isLoading}
        onTabChange={handleTabChange}
      />
      <DashboardTabContent isPublicUser={isPublicUser} activeTab={activeTab} />
    </div>
  )
}
