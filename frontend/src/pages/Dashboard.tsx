import React, { useEffect, useState, Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { reagentOrderAPI, inventoryAPI, consumableOrderAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { formatDateTime, cn } from '@/lib/utils'
import { Package, ShoppingCart, ArrowRightLeft, AlertCircle, X, Loader2, PackagePlus, CheckCircle } from 'lucide-react'
import { AxiosError } from 'axios'

interface MyBorrowItem {
  inventory_id: number
  name: string
  cas_number: string
  remaining_quantity: number
  unit: string
  borrow_time: string
}

interface PendingStockinItem {
  inventory_id: number
  name: string
  cas_number: string
  initial_quantity: number
  unit: string
  stockin_time: string
}

interface MyOrder {
  id: number
  name: string
  cas_number?: string
  status: string
  created_at: string
  orderType?: 'reagent' | 'consumable'
  order_reason?: string
}

interface OrderItem {
  order_id?: number
  id?: number
  [key: string]: unknown
}

interface ReagentOrdersByStatus {
  pending: { orders: OrderItem[] }
  approved: { orders: OrderItem[] }
  arrived: { orders: OrderItem[] }
}

interface ConsumableOrdersByStatus {
  pending: { orders: OrderItem[] }
  approved: { orders: OrderItem[] }
}

// 骨架屏组件 - 空白占位
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("h-8", className)} />
  )
}

function SkeletonList({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-16" />
      ))}
    </div>
  )
}

// 统计卡片组件
function StatCard({
  title,
  icon: Icon,
  value,
  loading
}: {
  title: string
  icon: React.ElementType
  value?: number
  loading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="h-8 transition-opacity duration-200">
          {loading ? (
            <SkeletonCard />
          ) : (
            <div className="text-2xl font-bold">{value ?? 0}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const [myReagentOrders, setMyReagentOrders] = useState<MyOrder[]>([])
  const [myConsumableOrders, setMyConsumableOrders] = useState<MyOrder[]>([])
  const [myBorrows, setMyBorrows] = useState<MyBorrowItem[]>([])
  const [pendingStockin, setPendingStockin] = useState<PendingStockinItem[]>([])
  
  const [loadingReagentOrders, setLoadingReagentOrders] = useState(true)
  const [loadingConsumableOrders, setLoadingConsumableOrders] = useState(true)
  const [loadingBorrows, setLoadingBorrows] = useState(true)
  const [loadingStockin, setLoadingStockin] = useState(true)

  const [reagentPage, setReagentPage] = useState(1)
  const [reagentPageSize] = useState(5)
  const [consumablePage, setConsumablePage] = useState(1)
  const [consumablePageSize] = useState(5)
  const [borrowPage, setBorrowPage] = useState(1)
  const [borrowPageSize] = useState(5)
  
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnQuantity, setReturnQuantity] = useState('')
  const [usedQuantity, setUsedQuantity] = useState('')
  const [returnUnit, setReturnUnit] = useState('')
  const [returnMode, setReturnMode] = useState<'remaining' | 'used'>('used')
  const [returnLoading, setReturnLoading] = useState(false)
  const [returnError, setReturnError] = useState('')

  const [showStockinModal, setShowStockinModal] = useState(false)
  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLocation, setStockinLocation] = useState('')
  const [stockinLoading, setStockinLoading] = useState(false)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    const loadReagentOrders = async () => {
      try {
        const res = await reagentOrderAPI.getMyOrders()
        const reagentOrdersData = res.data as { data?: ReagentOrdersByStatus } | undefined
        const reagentOrders = reagentOrdersData?.data
        if (reagentOrders && typeof reagentOrders === 'object') {
          const allReagentOrders: MyOrder[] = []
          if (reagentOrders.pending?.orders) {
            reagentOrders.pending.orders.forEach((o: OrderItem) => {
              allReagentOrders.push({ ...o, status: 'pending', id: o.order_id || o.id || 0, orderType: 'reagent' } as MyOrder)
            })
          }
          if (reagentOrders.approved?.orders) {
            reagentOrders.approved.orders.forEach((o: OrderItem) => {
              allReagentOrders.push({ ...o, status: 'approved', id: o.order_id || o.id || 0, orderType: 'reagent' } as MyOrder)
            })
          }
          if (reagentOrders.arrived?.orders) {
            reagentOrders.arrived.orders.forEach((o: OrderItem) => {
              allReagentOrders.push({ ...o, status: 'arrived', id: o.order_id || o.id || 0, orderType: 'reagent' } as MyOrder)
            })
          }
          setMyReagentOrders(allReagentOrders)
        } else {
          setMyReagentOrders([])
        }
      } catch (error) {
        console.error('Failed to load reagent orders:', error)
        setMyReagentOrders([])
      } finally {
        setLoadingReagentOrders(false)
      }
    }

    const loadConsumableOrders = async () => {
      try {
        const res = await consumableOrderAPI.getMyOrders()
        const consumableOrdersData = res.data as { data?: ConsumableOrdersByStatus } | undefined
        const consumableOrders = consumableOrdersData?.data
        if (consumableOrders && typeof consumableOrders === 'object') {
          const allConsumableOrders: MyOrder[] = []
          if (consumableOrders.pending?.orders) {
            consumableOrders.pending.orders.forEach((o: OrderItem) => {
              allConsumableOrders.push({ ...o, status: 'pending', id: o.order_id || o.id || 0, orderType: 'consumable' } as MyOrder)
            })
          }
          if (consumableOrders.approved?.orders) {
            consumableOrders.approved.orders.forEach((o: OrderItem) => {
              allConsumableOrders.push({ ...o, status: 'approved', id: o.order_id || o.id || 0, orderType: 'consumable' } as MyOrder)
            })
          }
          setMyConsumableOrders(allConsumableOrders)
        } else {
          setMyConsumableOrders([])
        }
      } catch (error) {
        console.error('Failed to load consumable orders:', error)
        setMyConsumableOrders([])
      } finally {
        setLoadingConsumableOrders(false)
      }
    }

    const loadBorrows = async () => {
      try {
        const res = await inventoryAPI.getMyBorrows()
        const borrowsData = res.data as { data?: MyBorrowItem[] } | undefined
        setMyBorrows(Array.isArray(borrowsData?.data) ? borrowsData.data : [])
      } catch (error) {
        console.error('Failed to load borrows:', error)
        setMyBorrows([])
      } finally {
        setLoadingBorrows(false)
      }
    }

    const loadStockin = async () => {
      try {
        const res = await inventoryAPI.getPendingStockin()
        const stockinData = res.data as { data?: PendingStockinItem[] } | undefined
        setPendingStockin(Array.isArray(stockinData?.data) ? stockinData.data : [])
      } catch (error) {
        console.error('Failed to load stockin:', error)
        setPendingStockin([])
      } finally {
        setLoadingStockin(false)
      }
    }

    await Promise.all([
      loadReagentOrders(),
      loadConsumableOrders(),
      loadBorrows(),
      loadStockin()
    ])
  }

  const openReturnModal = (item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnQuantity(String(item.remaining_quantity))
    setUsedQuantity('0')
    setReturnUnit(item.unit)
    setReturnMode('used')
    setReturnError('')
    setShowReturnModal(true)
  }

  const handleReturn = async () => {
    if (!selectedBorrow) return
    
    setReturnError('')
    let qty: number
    if (returnMode === 'used') {
      const used = parseFloat(usedQuantity)
      if (isNaN(used) || used < 0) {
        setReturnError('请输入有效的使用量（需大于等于0）')
        return
      }
      if (used > selectedBorrow.remaining_quantity) {
        setReturnError('使用量不能超过借用时剩余量')
        return
      }
      qty = selectedBorrow.remaining_quantity - used
    } else {
      qty = parseFloat(returnQuantity)
      if (isNaN(qty) || qty < 0) {
        setReturnError('请输入有效的剩余量（需大于等于0）')
        return
      }
      if (qty > selectedBorrow.remaining_quantity) {
        setReturnError('剩余量不能超过借用时剩余量')
        return
      }
    }
    
    setReturnLoading(true)
    try {
      await inventoryAPI.return(selectedBorrow.inventory_id, { remaining_quantity: qty, unit: returnUnit })
      setShowReturnModal(false)
      setSelectedBorrow(null)
      loadDashboardData()
      toast.success('归还成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '归还失败')
    } finally {
      setReturnLoading(false)
    }
  }

  const handleStockin = async () => {
    if (!selectedStockin) return
    if (!stockinLocation.trim()) {
      toast.warning('请输入存放位置')
      return
    }
    setStockinLoading(true)
    try {
      await inventoryAPI.update(selectedStockin.inventory_id, { location: stockinLocation })
      setShowStockinModal(false)
      setSelectedStockin(null)
      setStockinLocation('')
      loadDashboardData()
      toast.success('位置分配成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    } finally {
      setStockinLoading(false)
    }
  }

  const handleConfirmArrival = async (orderId: number) => {
    try {
      await reagentOrderAPI.confirmArrival(orderId)
      toast.warning('试剂已到货，请及时完成入库操作！')
      loadDashboardData()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleQuickStockIn = async (orderId: number) => {
    try {
      await reagentOrderAPI.stockIn(orderId)
      loadDashboardData()
      toast.success('入库成功！')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '入库失败')
    }
  }

  const handleConfirmReceive = async (orderId: number) => {
    try {
      await consumableOrderAPI.complete(orderId)
      loadDashboardData()
      toast.success('已确认收货')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '确认收货失败')
    }
  }

  const openStockinModal = (item: PendingStockinItem) => {
    setSelectedStockin(item)
    setStockinLocation('')
    setShowStockinModal(true)
  }

  const pendingCount = myReagentOrders.filter((o) => o.status === 'pending').length + 
                       myConsumableOrders.filter((o) => o.status === 'pending').length

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight card-title-placeholder">仪表盘</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="试剂订单"
          icon={ShoppingCart}
          value={myReagentOrders.length}
          loading={loadingReagentOrders}
        />
        <StatCard
          title="耗材订单"
          icon={ShoppingCart}
          value={myConsumableOrders.length}
          loading={loadingConsumableOrders}
        />
        <StatCard
          title="当前借用"
          icon={Package}
          value={myBorrows.length}
          loading={loadingBorrows}
        />
        <StatCard
          title="待入库"
          icon={ArrowRightLeft}
          value={pendingStockin.length}
          loading={loadingStockin}
        />
        <StatCard
          title="待处理"
          icon={AlertCircle}
          value={pendingCount}
          loading={loadingReagentOrders || loadingConsumableOrders}
        />
      </div>

      {/* Tabs for 4 tables */}
      <Tabs defaultValue="reagents">
        <TabsList className="mb-1">
          <TabsTrigger value="reagents" className="w-25">试剂订单</TabsTrigger>
          <TabsTrigger value="consumables" className="w-25">耗材订单</TabsTrigger>
          <TabsTrigger value="borrows" className="w-25">当前借用</TabsTrigger>
          <TabsTrigger value="stockin" className="w-25">待入库</TabsTrigger>
        </TabsList>

        <TabsContent value="reagents">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>试剂订单</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingReagentOrders ? (
                <SkeletonList lines={3} />
              ) : myReagentOrders.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">暂无试剂订单</p>
              ) : (
                <div className="space-y-4">
                  {myReagentOrders.slice((reagentPage - 1) * reagentPageSize, reagentPage * reagentPageSize).map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted"
                    >
                      <div>
                        <p className="font-medium">{order.name}</p>
                        <p className="text-sm text-muted-foreground">
                          CAS: {order.cas_number || '-'} • {formatDateTime(order.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'px-3 py-1 text-sm rounded-full',
                            order.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                              : order.status === 'approved'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : order.status === 'arrived'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-muted text-foreground'
                          )}
                        >
                          {order.status === 'pending'
                            ? '待审批'
                            : order.status === 'approved'
                            ? '已审批'
                            : order.status === 'arrived'
                            ? '已到货'
                            : order.status}
                        </span>
                        {order.status === 'approved' && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleConfirmArrival(order.id)}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              确认到货
                            </Button>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              disabled={order.order_reason === 'common_public'}
                              title={order.order_reason === 'common_public' ? '常用/公用试剂无需入库，请使用确认到货' : undefined}
                              onClick={() => handleQuickStockIn(order.id)}
                            >
                              <PackagePlus className="w-3 h-3 mr-1" />
                              一键入库
                            </Button>
                          </div>
                        )}
                        {order.status === 'arrived' && (
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            disabled={order.order_reason === 'common_public'}
                            title={order.order_reason === 'common_public' ? '常用/公用试剂无需入库，请使用确认到货' : undefined}
                            onClick={() => handleQuickStockIn(order.id)}
                          >
                            <PackagePlus className="w-3 h-3 mr-1" />
                            入库
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {Math.ceil(myReagentOrders.length / reagentPageSize) > 1 && (
                    <div className="flex items-center justify-between pt-4">
                      <PaginationInfo currentPage={reagentPage} pageSize={reagentPageSize} total={myReagentOrders.length} />
                      <Pagination
                        currentPage={reagentPage}
                        totalPages={Math.ceil(myReagentOrders.length / reagentPageSize)}
                        pageSize={reagentPageSize}
                        onPageChange={setReagentPage}
                        onPageSizeChange={() => {}}
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumables">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>耗材订单</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingConsumableOrders ? (
                <SkeletonList lines={3} />
              ) : myConsumableOrders.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">暂无耗材订单</p>
              ) : (
                <>
                  <div className="px-6 rounded-md overflow-auto">
                    <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                      <thead>
                        <tr className="border-b-2 border-border">
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">名称</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">状态</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">时间</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myConsumableOrders.slice((consumablePage - 1) * consumablePageSize, consumablePage * consumablePageSize).map((order) => (
                          <tr key={order.id} className="border-b border-border hover:bg-muted/30 cursor-pointer transition-none">
                            <td className="p-3 align-middle text-base">{order.name}</td>
                            <td className="p-3 align-middle text-base">
                              <span className={cn('px-2.5 py-1 text-xs rounded-full font-medium whitespace-nowrap', order.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : order.status === 'approved' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-muted text-foreground')}>
                                {order.status === 'pending' ? '待审批' : order.status === 'approved' ? '已审批' : order.status}
                              </span>
                            </td>
                            <td className="p-3 align-middle text-base">{formatDateTime(order.created_at)}</td>
                            <td className="p-3 align-middle text-base">
                              {order.status === 'approved' && (
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleConfirmReceive(order.id)}>
                                  <CheckCircle className="w-3 h-3 mr-1" />确认收货
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {Math.ceil(myConsumableOrders.length / consumablePageSize) > 1 && (
                    <div className="px-6 flex items-center justify-between pt-4 pb-4">
                      <PaginationInfo currentPage={consumablePage} pageSize={consumablePageSize} total={myConsumableOrders.length} />
                      <Pagination currentPage={consumablePage} totalPages={Math.ceil(myConsumableOrders.length / consumablePageSize)} pageSize={consumablePageSize} onPageChange={setConsumablePage} onPageSizeChange={() => {}} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="borrows">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>当前借用</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingBorrows ? (
                <SkeletonList lines={3} />
              ) : myBorrows.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">暂无借用</p>
              ) : (
                <>
                  <div className="px-6 rounded-md overflow-auto">
                    <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                      <thead>
                        <tr className="border-b-2 border-border">
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">名称</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">CAS号</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">剩余量</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">借用时间</th>
                          <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myBorrows.slice((borrowPage - 1) * borrowPageSize, borrowPage * borrowPageSize).map((item) => (
                          <tr key={item.inventory_id} className="border-b border-border hover:bg-muted/30 transition-none">
                            <td className="p-3 align-middle text-base">{item.name}</td>
                            <td className="p-3 align-middle text-base">{item.cas_number}</td>
                            <td className="p-3 align-middle text-base">{item.remaining_quantity} {item.unit}</td>
                            <td className="p-3 align-middle text-base">{formatDateTime(item.borrow_time)}</td>
                            <td className="p-3 align-middle text-base">
                              <Button onClick={() => openReturnModal(item)} size="sm">归还</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {Math.ceil(myBorrows.length / borrowPageSize) > 1 && (
                    <div className="px-6 flex items-center justify-between pt-4 pb-4">
                      <PaginationInfo currentPage={borrowPage} pageSize={borrowPageSize} total={myBorrows.length} />
                      <Pagination currentPage={borrowPage} totalPages={Math.ceil(myBorrows.length / borrowPageSize)} pageSize={borrowPageSize} onPageChange={setBorrowPage} onPageSizeChange={() => {}} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stockin">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>待入库位置分配</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingStockin ? (
                <SkeletonList lines={3} />
              ) : pendingStockin.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">无待入库物品</p>
              ) : (
                <div className="px-6 rounded-md overflow-auto">
                  <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b-2 border-border">
                        <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">名称</th>
                        <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">CAS号</th>
                        <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">数量</th>
                        <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">入库时间</th>
                        <th className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingStockin.map((item) => (
                        <tr key={item.inventory_id} className="border-b border-border hover:bg-muted/30 cursor-pointer transition-none">
                          <td className="p-3 align-middle text-base">{item.name}</td>
                          <td className="p-3 align-middle text-base">{item.cas_number}</td>
                          <td className="p-3 align-middle text-base">{item.initial_quantity} {item.unit}</td>
                          <td className="p-3 align-middle text-base">{formatDateTime(item.stockin_time)}</td>
                          <td className="p-3 align-middle text-base">
                            <Button variant="outline" onClick={() => openStockinModal(item)} size="sm">分配位置</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Return Modal */}
      <Dialog open={showReturnModal} onOpenChange={setShowReturnModal}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>归还物品</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="font-medium">{selectedBorrow?.name}</p>
              <p className="text-sm text-muted-foreground">
                CAS: {selectedBorrow?.cas_number}
              </p>
            </div>
            
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="returnMode"
                  checked={returnMode === 'used'}
                  onChange={() => setReturnMode('used')}
                  className="w-4 h-4"
                />
                <span className="text-sm">填写使用量</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="returnMode"
                  checked={returnMode === 'remaining'}
                  onChange={() => setReturnMode('remaining')}
                  className="w-4 h-4"
                />
                <span className="text-sm">填写剩余量</span>
              </label>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                {returnMode === 'remaining' ? '剩余量' : '使用量'} 
                <span className="text-destructive">*</span>
                {returnMode === 'used' && selectedBorrow && (
                  <span className="text-muted-foreground font-normal ml-2">
                    (借用时剩余量: {selectedBorrow.remaining_quantity} {returnUnit})
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={returnMode === 'remaining' ? returnQuantity : usedQuantity}
                  onChange={(e) => {
                    setReturnError('')
                    if (returnMode === 'remaining') {
                      setReturnQuantity(e.target.value)
                    } else {
                      setUsedQuantity(e.target.value)
                    }
                  }}
                  placeholder={returnMode === 'remaining' ? '输入剩余量' : '输入使用量'}
                  className={cn("flex-1", returnError && "border-destructive")}
                />
                <span className="text-muted-foreground text-sm min-w-[40px]">{returnUnit}</span>
              </div>
              {returnError && (
                <p className="text-sm text-destructive mt-1">{returnError}</p>
              )}
              {returnMode === 'used' && usedQuantity && !returnError && selectedBorrow && (
                <p className="text-sm text-muted-foreground mt-1">
                  归还后剩余: {Math.max(0, selectedBorrow.remaining_quantity - (parseFloat(usedQuantity) || 0)).toFixed(2)} {returnUnit} (原借用时剩余量: {selectedBorrow.remaining_quantity} {returnUnit})
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleReturn}
                disabled={returnLoading}
                className="flex-1"
                size="lg"
              >
                {returnLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    处理中...
                  </>
                ) : (
                  '确认归还'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowReturnModal(false)}
                className="flex-1"
                size="lg"
              >
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stockin Location Modal */}
      {showStockinModal && selectedStockin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">分配存放位置</h2>
              <button
                onClick={() => setShowStockinModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{selectedStockin.name}</p>
                <p className="text-sm text-muted-foreground">
                  CAS: {selectedStockin.cas_number} • {selectedStockin.initial_quantity} {selectedStockin.unit}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">
                  存放位置 <span className="text-destructive">*</span>
                </label>
                <Input
                  value={stockinLocation}
                  onChange={(e) => setStockinLocation(e.target.value)}
                  placeholder="如: A-1-1 柜"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleStockin}
                  disabled={stockinLoading}
                  className="flex-1"
                  size="lg"
                >
                  {stockinLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    '确认分配'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowStockinModal(false)}
                  className="flex-1"
                  size="lg"
                >
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
