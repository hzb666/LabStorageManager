import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { reagentOrderAPI, inventoryAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { formatDateTime, cn } from '@/lib/utils'
import { Package, ShoppingCart, ArrowRightLeft, AlertCircle, X, Loader2, PackagePlus, CheckCircle } from 'lucide-react'

interface MyBorrowItem {
  inventory_id: number
  internal_code: string
  name: string
  cas_number: string
  remaining_quantity: number
  unit: string
  borrow_time: string
}

interface PendingStockinItem {
  inventory_id: number
  internal_code: string
  name: string
  cas_number: string
  initial_quantity: number
  unit: string
  stockin_time: string
}

interface MyOrder {
  id: number
  name: string
  cas_number: string
  status: string
  created_at: string
}

interface DashboardResponse<T> {
  data: T[]
  total: number
}

export function Dashboard() {
  const [myOrders, setMyOrders] = useState<MyOrder[]>([])
  const [myBorrows, setMyBorrows] = useState<MyBorrowItem[]>([])
  const [pendingStockin, setPendingStockin] = useState<PendingStockinItem[]>([])
  const [loading, setLoading] = useState(true)
  
  // Return Modal state
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnQuantity, setReturnQuantity] = useState('')
  const [returnUnit, setReturnUnit] = useState('')
  const [returnLoading, setReturnLoading] = useState(false)

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
      const [ordersRes, borrowsRes, stockinRes] = await Promise.all([
        reagentOrderAPI.getMyOrders(),
        inventoryAPI.getMyBorrows(),
        inventoryAPI.getPendingStockin(),
      ])

      // Parse myOrders - backend returns { data: { pending: {orders}, approved: {orders}, arrived: {orders} } }
      const ordersData = (ordersRes.data as any)?.data
      if (ordersData && typeof ordersData === 'object') {
        // Flatten the nested structure into a single array, keep backend lowercase status
        const allOrders: MyOrder[] = []
        if (ordersData.pending?.orders) {
          ordersData.pending.orders.forEach((o: any) => {
            allOrders.push({ ...o, status: 'pending', id: o.order_id || o.id })
          })
        }
        if (ordersData.approved?.orders) {
          ordersData.approved.orders.forEach((o: any) => {
            allOrders.push({ ...o, status: 'approved', id: o.order_id || o.id })
          })
        }
        if (ordersData.arrived?.orders) {
          ordersData.arrived.orders.forEach((o: any) => {
            allOrders.push({ ...o, status: 'arrived', id: o.order_id || o.id })
          })
        }
        setMyOrders(allOrders)
      } else {
        setMyOrders([])
      }

      // Parse borrows - backend returns { data: [...], total: ... }
      const borrowsData = (borrowsRes.data as any)?.data
      setMyBorrows(Array.isArray(borrowsData) ? borrowsData : [])

      // Parse pending stockin - backend returns { data: [...], total: ... }
      const stockinData = (stockinRes.data as any)?.data
      setPendingStockin(Array.isArray(stockinData) ? stockinData : [])

    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const openReturnModal = (item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnQuantity(String(item.remaining_quantity))
    setReturnUnit(item.unit)
    setShowReturnModal(true)
  }

  const handleReturn = async () => {
    if (!selectedBorrow) return
    const qty = parseFloat(returnQuantity)
    if (isNaN(qty) || qty < 0) {
      toast.warning('请输入有效的数量')
      return
    }
    setReturnLoading(true)
    try {
      await inventoryAPI.return(selectedBorrow.inventory_id, { remaining_quantity: qty, unit: returnUnit })
      setShowReturnModal(false)
      setSelectedBorrow(null)
      loadDashboardData()
      toast.success('归还成功')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '归还失败')
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
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '操作失败')
    } finally {
      setStockinLoading(false)
    }
  }

  // 处理确认到货（暂不入库）
  const handleConfirmArrival = async (orderId: number) => {
    try {
      await reagentOrderAPI.confirmArrival(orderId)
      loadDashboardData()
      toast.warning('试剂已到货，请及时完成入库操作！')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '操作失败')
    }
  }

  // 处理一键入库
  const handleQuickStockIn = async (orderId: number) => {
    try {
      await reagentOrderAPI.stockIn(orderId)
      loadDashboardData()
      toast.success('入库成功！')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '入库失败')
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
      <h1 className="text-3xl font-bold">仪表盘</h1>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">我的订单</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myOrders.length}</div>
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
            <CardTitle className="text-sm font-medium">待处理订单</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {myOrders.filter((o) => o.status === 'pending').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My Orders */}
      <Card>
        <CardHeader>
          <CardTitle>我的订单进度</CardTitle>
        </CardHeader>
        <CardContent>
          {myOrders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">暂无订单</p>
          ) : (
            <div className="space-y-4">
              {myOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium">{order.name}</p>
                    <p className="text-sm text-muted-foreground">
                      CAS: {order.cas_number} • {formatDateTime(order.created_at)}
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
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
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
                        onClick={() => handleQuickStockIn(order.id)}
                      >
                        <PackagePlus className="w-3 h-3 mr-1" />
                        入库
                      </Button>
                    )}
                  </div>
                </div>
              ))}
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
              {myBorrows.map((item) => (
                <div
                  key={item.inventory_id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      编号: {item.internal_code} • {item.remaining_quantity} {item.unit}
                    </p>
                  </div>
                  <Button onClick={() => openReturnModal(item)}>
                    归还
                  </Button>
                </div>
              ))}
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
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      编号: {item.internal_code} • {item.initial_quantity} {item.unit}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => openStockinModal(item)}>
                    分配位置
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Return Modal */}
      {showReturnModal && selectedBorrow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">归还物品</h2>
              <button
                onClick={() => setShowReturnModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="font-medium">{selectedBorrow.name}</p>
                <p className="text-sm text-muted-foreground">
                  编号: {selectedBorrow.internal_code}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">
                  剩余数量 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  value={returnQuantity}
                  onChange={(e) => setReturnQuantity(e.target.value)}
                  placeholder="输入剩余数量"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">单位</label>
                <select
                  value={returnUnit}
                  onChange={(e) => setReturnUnit(e.target.value)}
                  className="w-full h-10 px-3 border rounded-md bg-background"
                >
                  <option value="ml">毫升 (ml)</option>
                  <option value="L">升 (L)</option>
                  <option value="g">克 (g)</option>
                  <option value="kg">千克 (kg)</option>
                  <option value="个">个</option>
                  <option value="瓶">瓶</option>
                  <option value="盒">盒</option>
                </select>
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
          </div>
        </div>
      )}

      {/* Stockin Location Modal */}
      {showStockinModal && selectedStockin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="font-medium">{selectedStockin.name}</p>
                <p className="text-sm text-muted-foreground">
                  编号: {selectedStockin.internal_code} • {selectedStockin.initial_quantity} {selectedStockin.unit}
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
