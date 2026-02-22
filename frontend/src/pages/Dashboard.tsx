import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

// Order item from backend (can be order_id or id)
interface OrderItem {
  order_id?: number
  id?: number
  [key: string]: unknown
}

// Backend response structures for reagent orders
interface ReagentOrdersByStatus {
  pending: { orders: OrderItem[] }
  approved: { orders: OrderItem[] }
  arrived: { orders: OrderItem[] }
}

// Backend response structures for consumable orders
interface ConsumableOrdersByStatus {
  pending: { orders: OrderItem[] }
  approved: { orders: OrderItem[] }
}

export function Dashboard() {
  const [myReagentOrders, setMyReagentOrders] = useState<MyOrder[]>([])
  const [myConsumableOrders, setMyConsumableOrders] = useState<MyOrder[]>([])
  const [myBorrows, setMyBorrows] = useState<MyBorrowItem[]>([])
  const [pendingStockin, setPendingStockin] = useState<PendingStockinItem[]>([])
  const [loading, setLoading] = useState(true)

  // Pagination states
  const [reagentPage, setReagentPage] = useState(1)
  const [reagentPageSize] = useState(5)
  const [consumablePage, setConsumablePage] = useState(1)
  const [consumablePageSize] = useState(5)
  const [borrowPage, setBorrowPage] = useState(1)
  const [borrowPageSize] = useState(5)
  
  // Return Modal state
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnQuantity, setReturnQuantity] = useState('')
  const [usedQuantity, setUsedQuantity] = useState('')
  const [returnUnit, setReturnUnit] = useState('')
  const [returnMode, setReturnMode] = useState<'remaining' | 'used'>('used')
  const [returnLoading, setReturnLoading] = useState(false)
  const [returnError, setReturnError] = useState('')

  // Stockin Modal state
  const [showStockinModal, setShowStockinModal] = useState(false)
  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLocation, setStockinLocation] = useState('')
  const [stockinLoading, setStockinLoading] = useState(false)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const [reagentOrdersRes, consumableOrdersRes, borrowsRes, stockinRes] = await Promise.all([
        reagentOrderAPI.getMyOrders(),
        consumableOrderAPI.getMyOrders(),
        inventoryAPI.getMyBorrows(),
        inventoryAPI.getPendingStockin(),
      ])

      // Parse reagent orders - backend returns { data: { pending: {orders}, approved: {orders}, arrived: {orders} } }
      const reagentOrdersData = reagentOrdersRes.data as { data?: ReagentOrdersByStatus } | undefined
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

      // Parse consumable orders - backend returns { data: { pending: {orders}, approved: {orders} } }
      const consumableOrdersData = consumableOrdersRes.data as { data?: ConsumableOrdersByStatus } | undefined
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

      // Parse borrows - backend returns { data: [...], total: ... }
      const borrowsData = borrowsRes.data as { data?: MyBorrowItem[] } | undefined
      setMyBorrows(Array.isArray(borrowsData?.data) ? borrowsData.data : [])

      // Parse pending stockin - backend returns { data: [...], total: ... }
      const stockinData = stockinRes.data as { data?: PendingStockinItem[] } | undefined
      setPendingStockin(Array.isArray(stockinData?.data) ? stockinData.data : [])

    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
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
      // Calculate remaining = borrowed - used
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

  // 处理试剂确认到货（暂不入库）
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

  // 处理试剂一键入库
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

  // 处理耗材确认收货
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold title-placeholder">仪表盘</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">试剂订单</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myReagentOrders.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">耗材订单</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myConsumableOrders.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">当前借用</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myBorrows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">待入库</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingStockin.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">待处理</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {myReagentOrders.filter((o) => o.status === 'pending').length + myConsumableOrders.filter((o) => o.status === 'pending').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My Reagent Orders */}
      <Card>
        <CardHeader>
          <CardTitle>试剂订单</CardTitle>
        </CardHeader>
        <CardContent>
          {myReagentOrders.length === 0 ? (
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
                          ? 'bg-yellow-100 text-yellow-800'
                          : order.status === 'approved'
                          ? 'bg-blue-100 text-blue-800'
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

      {/* My Consumable Orders */}
      <Card>
        <CardHeader>
          <CardTitle>耗材订单</CardTitle>
        </CardHeader>
        <CardContent>
          {myConsumableOrders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">暂无耗材订单</p>
          ) : (
            <div className="space-y-4">
              {myConsumableOrders.slice((consumablePage - 1) * consumablePageSize, consumablePage * consumablePageSize).map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:bg-muted gap-3"
                >
                  <div>
                    <p className="font-medium">{order.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateTime(order.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <span
                      className={cn(
                        'px-3 py-1 text-sm rounded-full',
                        order.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : order.status === 'approved'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-muted text-foreground'
                      )}
                    >
                      {order.status === 'pending'
                        ? '待审批'
                        : order.status === 'approved'
                        ? '已审批'
                        : order.status}
                    </span>
                    {order.status === 'approved' && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleConfirmReceive(order.id)}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        确认收货
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {Math.ceil(myConsumableOrders.length / consumablePageSize) > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <PaginationInfo currentPage={consumablePage} pageSize={consumablePageSize} total={myConsumableOrders.length} />
                  <Pagination
                    currentPage={consumablePage}
                    totalPages={Math.ceil(myConsumableOrders.length / consumablePageSize)}
                    pageSize={consumablePageSize}
                    onPageChange={setConsumablePage}
                    onPageSizeChange={() => {}}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Borrows */}
      <Card>
        <CardHeader>
          <CardTitle>当前借用</CardTitle>
        </CardHeader>
        <CardContent>
          {myBorrows.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">暂无借用</p>
          ) : (
            <div className="space-y-4">
              {myBorrows.slice((borrowPage - 1) * borrowPageSize, borrowPage * borrowPageSize).map((item) => (
                <div
                  key={item.inventory_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:bg-muted gap-3"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      CAS: {item.cas_number} • {item.remaining_quantity} {item.unit}
                    </p>
                  </div>
                  <Button onClick={() => openReturnModal(item)} className="w-full sm:w-auto">
                    归还
                  </Button>
                </div>
              ))}
              {Math.ceil(myBorrows.length / borrowPageSize) > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <PaginationInfo currentPage={borrowPage} pageSize={borrowPageSize} total={myBorrows.length} />
                  <Pagination
                    currentPage={borrowPage}
                    totalPages={Math.ceil(myBorrows.length / borrowPageSize)}
                    pageSize={borrowPageSize}
                    onPageChange={setBorrowPage}
                    onPageSizeChange={() => {}}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Stockin */}
      <Card>
        <CardHeader>
          <CardTitle>待入库位置分配</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingStockin.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">无待入库物品</p>
          ) : (
            <div className="space-y-4">
              {pendingStockin.map((item) => (
                <div
                  key={item.inventory_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:bg-muted gap-3"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      CAS: {item.cas_number} • {item.initial_quantity} {item.unit}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => openStockinModal(item)} className="w-full sm:w-auto">
                    分配位置
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
            
            {/* 归还方式切换 */}
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
                <span className="text-red-500">*</span>
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
                  className={cn("flex-1", returnError && "border-red-500")}
                />
                <span className="text-muted-foreground text-sm min-w-[40px]">{returnUnit}</span>
              </div>
              {returnError && (
                <p className="text-sm text-red-500 mt-1">{returnError}</p>
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
                  存放位置 <span className="text-red-500">*</span>
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
