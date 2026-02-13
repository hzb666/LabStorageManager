import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { orderAPI, inventoryAPI } from '@/api/client'
import { formatDateTime } from '@/lib/utils'
import { Package, ShoppingCart, ArrowRightLeft, AlertCircle } from 'lucide-react'

interface MyOrder {
  id: number
  name: string
  cas_number: string
  status: string
  created_at: string
}

interface MyBorrow {
  inventory_id: number
  internal_code: string
  name: string
  cas_number: string
  remaining_quantity: number
  unit: string
  borrow_time: string
}

interface PendingStockin {
  inventory_id: number
  internal_code: string
  name: string
  cas_number: string
  initial_quantity: number
  unit: string
  stockin_time: string
}

export function Dashboard() {
  const [myOrders, setMyOrders] = useState<MyOrder[]>([])
  const [myBorrows, setMyBorrows] = useState<MyBorrow[]>([])
  const [pendingStockin, setPendingStockin] = useState<PendingStockin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const [ordersRes, borrowsRes, stockinRes] = await Promise.all([
        orderAPI.getMyOrders(),
        inventoryAPI.getMyBorrows(),
        inventoryAPI.getPendingStockin(),
      ])
      setMyOrders(ordersRes.data.data || [])
      setMyBorrows(borrowsRes.data.data || [])
      setPendingStockin(stockinRes.data.data || [])
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleReturn = async (item: MyBorrow) => {
    const qty = window.prompt(`请输入 "${item.name}" 的剩余数量 (当前: ${item.remaining_quantity} ${item.unit}):`)
    if (qty === null) return
    const quantity = parseFloat(qty)
    if (isNaN(quantity) || quantity < 0) {
      alert('请输入有效的数量')
      return
    }
    try {
      await inventoryAPI.return(item.inventory_id, { remaining_quantity: quantity, unit: item.unit })
      loadDashboardData()
      alert('归还成功')
    } catch (error: any) {
      alert(error.response?.data?.detail || '归还失败')
    }
  }

  if (loading) {
    return <div className="text-center py-8">加载中...</div>
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
              {myOrders.filter((o) => o.status === 'PENDING').length}
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
            <p className="text-muted-foreground">暂无订单</p>
          ) : (
            <div className="space-y-4">
              {myOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{order.name}</p>
                    <p className="text-sm text-muted-foreground">
                      CAS: {order.cas_number} • {formatDateTime(order.created_at)}
                    </p>
                  </div>
                    <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 text-sm rounded-full ${
                        order.status === 'PENDING'
                          ? 'bg-yellow-100 text-yellow-800'
                          : order.status === 'APPROVED'
                          ? 'bg-blue-100 text-blue-800'
                          : order.status === 'ARRIVED'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {order.status === 'PENDING'
                        ? '待审批'
                        : order.status === 'APPROVED'
                        ? '已审批'
                        : order.status === 'ARRIVED'
                        ? '已到货'
                        : order.status}
                    </span>
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
            <p className="text-muted-foreground">暂无借用</p>
          ) : (
            <div className="space-y-4">
              {myBorrows.map((item) => (
                <div
                  key={item.inventory_id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      编号: {item.internal_code} • {item.remaining_quantity} {item.unit}
                    </p>
                  </div>
                  <Button onClick={() => handleReturn(item)}>
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
            <p className="text-muted-foreground">无待入库物品</p>
          ) : (
            <div className="space-y-4">
              {pendingStockin.map((item) => (
                <div
                  key={item.inventory_id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      编号: {item.internal_code} • {item.initial_quantity} {item.unit}
                    </p>
                  </div>
                  <Button variant="outline">分配位置</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
