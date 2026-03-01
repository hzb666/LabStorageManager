import React, { useEffect, useState, useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { reagentOrderAPI, inventoryAPI, consumableOrderAPI } from '@/api/client'
import { toast } from '@/components/ui/Toast'
import { Pagination, PaginationInfo } from '@/components/ui/Pagination'
import { formatDateTime, cn } from '@/lib/utils'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'
// 移除 Loader2，因为 LoadingButton 内部已经包含了
import { Package, ShoppingCart, ArrowRightLeft, X, PackagePlus, CheckCircle } from 'lucide-react'
import { AxiosError } from 'axios'
import { LoadingButton } from '@/components/ui/LoadingButton'

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

// 状态样式映射
const CONSUMABLE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

// columnHelper 定义
const consumableOrderHelper = createColumnHelper<MyOrder>()
const borrowHelper = createColumnHelper<MyBorrowItem>()
const stockinHelper = createColumnHelper<PendingStockinItem>()

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

// 统计卡片组件 - 可点击切换Tab
function StatCard({
  title,
  icon: Icon,
  value,
  loading,
  onClick,
  isActive
}: {
  title: string
  icon: React.ElementType
  value?: number
  loading?: boolean
  onClick?: () => void
  isActive?: boolean
}) {
  return (
    <Card
      className={cn(
        "transition-all cursor-pointer",
        onClick && "hover:bg-accent",
        isActive && "border bg-accent/50 dark:border-primary"
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
      </CardHeader>
      <CardContent>
        <div className="h-8 transition-opacity">
          {loading ? (
            <SkeletonCard />
          ) : (
            <div className={cn("text-2xl font-bold", isActive && "text-primary")}>{value ?? 0}</div>
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
  const [returnQuantity, setReturnQuantity] = useState('0')
  const [usedQuantity, setUsedQuantity] = useState('0')
  const [returnUnit, setReturnUnit] = useState('')
  const [returnMode, setReturnMode] = useState<'remaining' | 'used'>('used')
  const [returnLoading, setReturnLoading] = useState(false)
  const [returnError, setReturnError] = useState('')

  const [showStockinModal, setShowStockinModal] = useState(false)
  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLocation, setStockinLocation] = useState('')
  const [stockinLoading, setStockinLoading] = useState(false)

  // 耗材订单表格列定义
  const consumableColumns = useMemo(() => [
    consumableOrderHelper.accessor('name', {
      header: '名称',
      size: 180,
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    consumableOrderHelper.accessor('status', {
      header: '状态',
      size: 100,
      cell: info => {
        const status = info.getValue()
        return (
          <span className={cn(
            'px-2.5 py-1 text-sm rounded-full font-medium whitespace-nowrap',
            CONSUMABLE_STATUS_STYLES[status] || 'bg-muted'
          )}>
            {status === 'pending' ? '待审批' : status === 'approved' ? '已审批' : status}
          </span>
        )
      },
    }),
    consumableOrderHelper.accessor('created_at', {
      header: '时间',
      size: 150,
      cell: info => formatDateTime(info.getValue()),
    }),
    consumableOrderHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      cell: info => {
        const order = info.row.original
        return (
          order.status === 'approved' && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleConfirmReceive(order.id)}>
              <CheckCircle className="w-3 h-3 mr-1" />确认收货
            </Button>
          )
        )
      },
    }),
  ], [])

  // 借用记录表格列定义
  const borrowColumns = useMemo(() => [
    borrowHelper.accessor('name', {
      header: '名称',
      size: 150,
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    borrowHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 100,
      cell: info => info.getValue(),
    }),
    borrowHelper.accessor('remaining_quantity', {
      header: '剩余量',
      size: 100,
      cell: info => `${info.getValue()} ${info.row.original.unit}`,
    }),
    borrowHelper.accessor('borrow_time', {
      header: '借用时间',
      size: 150,
      cell: info => formatDateTime(info.getValue()),
    }),
    borrowHelper.display({
      id: 'actions',
      header: '操作',
      size: 80,
      cell: info => {
        const item = info.row.original
        return (
          <Button onClick={() => openReturnModal(item)} size="sm" className="h-8 text-sm/4 px-3 bg-primary hover:bg-primary/80 border-0">
            归还
          </Button>
        )
      },
    }),
  ], [])

  // 入库记录表格列定义
  const stockinColumns = useMemo(() => [
    stockinHelper.accessor('name', {
      header: '名称',
      size: 150,
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    stockinHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 100,
      cell: info => info.getValue(),
    }),
    stockinHelper.accessor('initial_quantity', {
      header: '数量',
      size: 100,
      cell: info => `${info.getValue()} ${info.row.original.unit}`,
    }),
    stockinHelper.accessor('stockin_time', {
      header: '入库时间',
      size: 150,
      cell: info => formatDateTime(info.getValue()),
    }),
    stockinHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      cell: info => {
        const item = info.row.original
        return (
          <Button variant="outline" onClick={() => openStockinModal(item)} size="sm">
            分配位置
          </Button>
        )
      },
    }),
  ], [])

  // ✅ 缓存耗材表格数据
  const consumableData = useMemo(() => {
    return myConsumableOrders.slice(
      (consumablePage - 1) * consumablePageSize,
      consumablePage * consumablePageSize
    )
  }, [myConsumableOrders, consumablePage, consumablePageSize])

  // ✅ 缓存借用表格数据
  const borrowData = useMemo(() => {
    return myBorrows.slice(
      (borrowPage - 1) * borrowPageSize,
      borrowPage * borrowPageSize
    )
  }, [myBorrows, borrowPage, borrowPageSize])

  // ✅ 缓存待入库表格数据
  const stockinData = useMemo(() => pendingStockin, [pendingStockin])

  // 创建表格实例
  const consumableTable = useReactTable({
    data: consumableData,
    columns: consumableColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const borrowTable = useReactTable({
    data: borrowData,
    columns: borrowColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const stockinTable = useReactTable({
    data: stockinData,
    columns: stockinColumns,
    getCoreRowModel: getCoreRowModel(),
  })

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
      await inventoryAPI.update(selectedStockin.inventory_id, { storage_location: stockinLocation })
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

  const getInitialTab = () => {
    const cached = localStorage.getItem('dashboard_active_tab')
    if (cached) {
      const { value, timestamp } = JSON.parse(cached)
      const now = Date.now()
      const threeDays = 3 * 24 * 60 * 60 * 1000
      if (now - timestamp < threeDays) {
        return value
      }
    }
    return 'reagents'
  }

  const [activeTab, setActiveTab] = useState<string>(getInitialTab)

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    localStorage.setItem('dashboard_active_tab', JSON.stringify({ value, timestamp: Date.now() }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">仪表盘</h1>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="试剂订单"
          icon={ShoppingCart}
          value={myReagentOrders.length}
          loading={loadingReagentOrders}
          onClick={() => handleTabChange('reagents')}
          isActive={activeTab === 'reagents'}
        />
        <StatCard
          title="耗材订单"
          icon={ShoppingCart}
          value={myConsumableOrders.length}
          loading={loadingConsumableOrders}
          onClick={() => handleTabChange('consumables')}
          isActive={activeTab === 'consumables'}
        />
        <StatCard
          title="当前借用"
          icon={Package}
          value={myBorrows.length}
          loading={loadingBorrows}
          onClick={() => handleTabChange('borrows')}
          isActive={activeTab === 'borrows'}
        />
        <StatCard
          title="待入库"
          icon={ArrowRightLeft}
          value={pendingStockin.length}
          loading={loadingStockin}
          onClick={() => handleTabChange('stockin')}
          isActive={activeTab === 'stockin'}
        />
      </div>

      {/* 试剂订单内容区域 */}
      {activeTab === 'reagents' && (
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
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted transition-all"
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
                      onPageSizeChange={() => { }}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 耗材订单内容区域 */}
      {activeTab === 'consumables' && (
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
                      {consumableTable.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} className="border-b-2 border-border">
                          {headerGroup.headers.map(header => (
                            <th
                              key={header.id}
                              className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
                            >
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {consumableTable.getRowModel().rows.map(row => (
                        <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-all">
                          {row.getVisibleCells().map(cell => (
                            <td
                              key={cell.id}
                              className="p-3 align-middle text-base"
                              style={{ width: cell.column.getSize() }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Math.ceil(myConsumableOrders.length / consumablePageSize) > 1 && (
                  <div className="px-6 flex items-center justify-between pt-4 pb-4">
                    <PaginationInfo currentPage={consumablePage} pageSize={consumablePageSize} total={myConsumableOrders.length} />
                    <Pagination currentPage={consumablePage} totalPages={Math.ceil(myConsumableOrders.length / consumablePageSize)} pageSize={consumablePageSize} onPageChange={setConsumablePage} onPageSizeChange={() => { }} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 当前借用内容区域 */}
      {activeTab === 'borrows' && (
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
                      {borrowTable.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} className="border-b-2 border-border">
                          {headerGroup.headers.map(header => (
                            <th
                              key={header.id}
                              className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
                            >
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {borrowTable.getRowModel().rows.map(row => (
                        <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-all">
                          {row.getVisibleCells().map(cell => (
                            <td
                              key={cell.id}
                              className="p-3 align-middle text-base"
                              style={{ width: cell.column.getSize() }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Math.ceil(myBorrows.length / borrowPageSize) > 1 && (
                  <div className="px-6 flex items-center justify-between pt-4 pb-4">
                    <PaginationInfo currentPage={borrowPage} pageSize={borrowPageSize} total={myBorrows.length} />
                    <Pagination currentPage={borrowPage} totalPages={Math.ceil(myBorrows.length / borrowPageSize)} pageSize={borrowPageSize} onPageChange={setBorrowPage} onPageSizeChange={() => { }} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 待入库内容区域 */}
      {activeTab === 'stockin' && (
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
                    {stockinTable.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id} className="border-b-2 border-border">
                        {headerGroup.headers.map(header => (
                          <th
                            key={header.id}
                            className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {stockinTable.getRowModel().rows.map(row => (
                      <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-all">
                        {row.getVisibleCells().map(cell => (
                          <td
                            key={cell.id}
                            className="p-3 align-middle text-base"
                            style={{ width: cell.column.getSize() }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Return Modal (已替换 LoadingButton) */}
      <Dialog open={showReturnModal} onOpenChange={setShowReturnModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归还物品</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="font-medium">{selectedBorrow?.name}</p>
              <p className="text-sm text-muted-foreground">
                CAS: {selectedBorrow?.cas_number}
              </p>
            </div>

            <RadioGroup
              value={returnMode}
              onValueChange={(value) => setReturnMode(value as 'used' | 'remaining')}
              className="flex flex-row gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="used" id="returnMode-used" />
                <Label htmlFor="returnMode-used" className="cursor-pointer text-base">填写使用量</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="remaining" id="returnMode-remaining" />
                <Label htmlFor="returnMode-remaining" className="cursor-pointer text-base">填写剩余量</Label>
              </div>
            </RadioGroup>

            <div>
              <label className={LABEL_STYLES.base}>
                {returnMode === 'remaining' ? '剩余量' : '使用量'}
                <span className="text-destructive"> *</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
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
                  className={cn(INPUT_STYLES.base, "flex-1", returnError && "border-destructive")}
                />
                <span className="text-muted-foreground text-sm min-w-10">{returnUnit}</span>
              </div>
              {returnError && (
                <p className="text-sm text-destructive mt-1">{returnError}</p>
              )}
              {returnMode === 'used' && usedQuantity && !returnError && selectedBorrow && (
                <p className="text-sm text-muted-foreground mt-1">
                  归还后剩余: {Math.max(0, selectedBorrow.remaining_quantity - (parseFloat(usedQuantity) || 0)).toFixed(2)} {returnUnit} (原借用时剩余量: {selectedBorrow.remaining_quantity} {returnUnit})
                </p>
              )}
              {returnMode === 'remaining' && returnQuantity && !returnError && selectedBorrow && (
                <p className="text-sm text-muted-foreground mt-1">
                  归还后剩余: {(parseFloat(returnQuantity) || 0).toFixed(2)} {returnUnit} (原借用时剩余量: {selectedBorrow.remaining_quantity} {returnUnit})
                </p>
              )}
            </div>

            {/* 👇 归还弹窗的按钮区 */}
            <div className="flex gap-3 mt-8">
              <Button
                variant="morden"
                onClick={() => setShowReturnModal(false)}
                className="flex-1"
                size="lg"
              >
                取消
              </Button>
              <LoadingButton
                onClick={handleReturn}
                isLoading={returnLoading}
                loadingText="处理中..."
                className="flex-1"
                size="lg"
              >
                确认归还
              </LoadingButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stockin Location Modal (已替换 LoadingButton) */}
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
                <label className={LABEL_STYLES.base}>
                  存放位置 <span className="text-destructive"> *</span>
                </label>
                <Input
                  value={stockinLocation}
                  onChange={(e) => setStockinLocation(e.target.value)}
                  placeholder="如: A-1-1 柜"
                  className={INPUT_STYLES.base}
                />
              </div>

              {/* 👇 入库弹窗的按钮区 */}
              <div className="flex gap-3 t-1">
                <LoadingButton
                  onClick={handleStockin}
                  isLoading={stockinLoading}
                  loadingText="处理中..."
                  className="flex-1"
                  size="lg"
                >
                  确认分配
                </LoadingButton>
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