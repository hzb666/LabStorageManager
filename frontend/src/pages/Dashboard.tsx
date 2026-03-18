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

const EMPTY_COUNTS: DashboardCounts = {
  reagentCount: 0,
  consumableCount: 0,
  borrowCount: 0,
  stockinCount: 0,
}

let dashboardCountsCache: DashboardCountsCache | null = null

function isCountsEqual(a: DashboardCounts, b: DashboardCounts): boolean {
  return (
    a.reagentCount === b.reagentCount &&
    a.consumableCount === b.consumableCount &&
    a.borrowCount === b.borrowCount &&
    a.stockinCount === b.stockinCount
  )
}

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

function saveTab(tab: DashboardTab) {
  try {
    localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, tab)
  } catch {
    // ignore localStorage errors
  }
}

export function Dashboard() {
  const currentUser = useAuthStore((state) => state.user)
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC
  const userKey = `${currentUser?.id ?? 'anonymous'}-${currentUser?.role ?? 'unknown'}`
  const cachedCountsForUser = dashboardCountsCache?.userKey === userKey ? dashboardCountsCache.counts : null
  const allowedTabs = useMemo(
    () => (isPublicUser ? (['borrows'] as DashboardTab[]) : ALL_TABS),
    [isPublicUser]
  )

  const [selectedTab, setSelectedTab] = useState<DashboardTab>(() => getSavedTab(allowedTabs))
  const [countsState, setCountsState] = useState<DashboardCountsCache | null>(() =>
    cachedCountsForUser ? { userKey, counts: cachedCountsForUser } : null
  )
  const activeTab = useMemo(
    () => (allowedTabs.includes(selectedTab) ? selectedTab : getSavedTab(allowedTabs)),
    [allowedTabs, selectedTab]
  )
  const counts = countsState?.userKey === userKey ? countsState.counts : cachedCountsForUser ?? EMPTY_COUNTS
  const isLoading = cachedCountsForUser === null && countsState?.userKey !== userKey

  const handleTabChange = useCallback((tab: DashboardTab) => {
    if (!allowedTabs.includes(tab)) {
      return
    }
    setSelectedTab(tab)
  }, [allowedTabs])

  useEffect(() => {
    saveTab(activeTab)
  }, [activeTab])

  // 加载统计数量：返回页面时优先复用缓存，只有首次或数据变化时才显示 loading
  useEffect(() => {
    let cancelled = false
    const cachedCounts = dashboardCountsCache?.userKey === userKey ? dashboardCountsCache.counts : null

    const applyCounts = (nextCounts: DashboardCounts) => {
      if (cancelled) return

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

    const loadCounts = async () => {
      try {
        if (isPublicUser) {
          const borrowRes = await inventoryAPI.getMyBorrows()
          if (cancelled) return

          const borrowCount = (borrowRes.data?.data ?? []).length
          applyCounts({
            reagentCount: 0,
            consumableCount: 0,
            borrowCount,
            stockinCount: 0,
          })
          return
        }

        const [reagentRes, consumableRes, borrowRes, stockinRes] = await Promise.all([
          reagentOrderAPI.getMyReagentOrders(),
          consumableOrderAPI.getMyConsumableOrders(),
          inventoryAPI.getMyBorrows(),
          inventoryAPI.getPendingStockin(),
        ])

        if (cancelled) return

        const reagentGrouped = (reagentRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>
        const consumableGrouped = (consumableRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>

        const reagentCount = Object.values(reagentGrouped).reduce(
          (sum, item) => sum + (item.orders?.length ?? 0), 0
        )
        const consumableCount = Object.values(consumableGrouped).reduce(
          (sum, item) => sum + (item.orders?.length ?? 0), 0
        )
        const borrowCount = (borrowRes.data?.data ?? []).length
        const stockinCount = (stockinRes.data?.data ?? []).length

        applyCounts({ reagentCount, consumableCount, borrowCount, stockinCount })
      } catch {
        if (cancelled) return

        if (cachedCounts !== null) {
          return
        }

        applyCounts(EMPTY_COUNTS)
      }
    }

    void loadCounts()
    return () => { cancelled = true }
  }, [activeTab, isPublicUser, userKey])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">仪表盘</h1>
      </div>

      <div className={cn('grid gap-3', isPublicUser ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4')}>
        {!isPublicUser && (
          <StatCard
            title="试剂订单"
            icon={ShoppingCart}
            value={isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : counts.reagentCount}
            onClick={() => handleTabChange('reagents')}
            isActive={activeTab === 'reagents'}
          />
        )}
        {!isPublicUser && (
          <StatCard
            title="耗材订单"
            icon={ShoppingCart}
            value={isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : counts.consumableCount}
            onClick={() => handleTabChange('consumables')}
            isActive={activeTab === 'consumables'}
          />
        )}
        <StatCard
          title="当前借用"
          icon={Package}
          value={isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : counts.borrowCount}
          onClick={() => handleTabChange('borrows')}
          isActive={activeTab === 'borrows'}
        />
        {!isPublicUser && (
          <StatCard
            title="待入库"
            icon={ArrowRightLeft}
            value={isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : counts.stockinCount}
            onClick={() => handleTabChange('stockin')}
            isActive={activeTab === 'stockin'}
          />
        )}
      </div>

      {!isPublicUser && activeTab === 'reagents' && <DashboardReagentTab />}
      {!isPublicUser && activeTab === 'consumables' && <DashboardConsumableTab />}
      {activeTab === 'borrows' && <DashboardBorrowTab />}
      {!isPublicUser && activeTab === 'stockin' && <DashboardStockinTab />}
    </div>
  )
}
