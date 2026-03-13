/**
 * 仪表盘页面
 * 轻量级 Tab 容器：显示统计卡片 + 按需加载对应 Tab
 * activeTab 通过 localStorage 持久化
 */
import { useState, useCallback, useEffect } from 'react'
import { ShoppingCart, Package, ArrowRightLeft } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

import {
  type DashboardTab,
  DASHBOARD_TAB_STORAGE_KEY,
} from './dashboard/dashboardUtils'
import { DashboardReagentTab } from './dashboard/DashboardReagentTab'
import { DashboardConsumableTab } from './dashboard/DashboardConsumableTab'
import { DashboardBorrowTab } from './dashboard/DashboardBorrowTab'
import { DashboardStockinTab } from './dashboard/DashboardStockinTab'

import { reagentOrderAPI, consumableOrderAPI, inventoryAPI } from '@/api/client'

function StatCard({
  title,
  icon: Icon,
  value,
  onClick,
  isActive,
}: Readonly<{
  title: string
  icon: React.ElementType
  value: number
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
        <div className={cn('text-2xl font-bold', isActive && 'text-primary')}>{value}</div>
      </CardContent>
    </Card>
  )
}

const VALID_TABS: DashboardTab[] = ['reagents', 'consumables', 'borrows', 'stockin']

function getSavedTab(): DashboardTab {
  try {
    const saved = localStorage.getItem(DASHBOARD_TAB_STORAGE_KEY)
    if (saved && VALID_TABS.includes(saved as DashboardTab)) {
      return saved as DashboardTab
    }
  } catch {
    // ignore localStorage errors
  }
  return 'reagents'
}

function saveTab(tab: DashboardTab) {
  try {
    localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, tab)
  } catch {
    // ignore localStorage errors
  }
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>(getSavedTab)
  const [counts, setCounts] = useState({
    reagentCount: 0,
    consumableCount: 0,
    borrowCount: 0,
    stockinCount: 0,
  })

  const handleTabChange = useCallback((tab: DashboardTab) => {
    setActiveTab(tab)
    saveTab(tab)
  }, [])

  // 加载统计数量（所有卡片同时显示，需要一次性请求）
  useEffect(() => {
    let cancelled = false

    const loadCounts = async () => {
      try {
        const [reagentRes, consumableRes, borrowRes, stockinRes] = await Promise.all([
          reagentOrderAPI.getMyOrders(),
          consumableOrderAPI.getMyOrders(),
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

        setCounts({ reagentCount, consumableCount, borrowCount, stockinCount })
      } catch {
        if (!cancelled) {
          setCounts({ reagentCount: 0, consumableCount: 0, borrowCount: 0, stockinCount: 0 })
        }
      }
    }

    void loadCounts()
    return () => { cancelled = true }
  }, [activeTab])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">仪表盘</h1>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="试剂订单"
          icon={ShoppingCart}
          value={counts.reagentCount}
          onClick={() => handleTabChange('reagents')}
          isActive={activeTab === 'reagents'}
        />
        <StatCard
          title="耗材订单"
          icon={ShoppingCart}
          value={counts.consumableCount}
          onClick={() => handleTabChange('consumables')}
          isActive={activeTab === 'consumables'}
        />
        <StatCard
          title="当前借用"
          icon={Package}
          value={counts.borrowCount}
          onClick={() => handleTabChange('borrows')}
          isActive={activeTab === 'borrows'}
        />
        <StatCard
          title="待入库"
          icon={ArrowRightLeft}
          value={counts.stockinCount}
          onClick={() => handleTabChange('stockin')}
          isActive={activeTab === 'stockin'}
        />
      </div>

      {activeTab === 'reagents' && <DashboardReagentTab />}
      {activeTab === 'consumables' && <DashboardConsumableTab />}
      {activeTab === 'borrows' && <DashboardBorrowTab />}
      {activeTab === 'stockin' && <DashboardStockinTab />}
    </div>
  )
}
