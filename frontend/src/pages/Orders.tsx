import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { orderAPI, inventoryAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import { 
  Search, 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  Loader2,
  Plus,
  X
} from 'lucide-react'

interface CASInventoryInfo {
  exists_in_inventory: boolean
  total_remaining: number
  in_stock_count: number
  borrowed_count: number
}

// New CAS Warning interface for duplicate order warning
interface CASWarningInfo {
  cas_number: string
  has_warning: boolean
  inventory: {
    total_remaining: number
    items_count: number
    details: Array<{
      id: number
      internal_code: string
      location: string | null
      remaining_quantity: number
      unit: string
      status: string
      borrower_id: number | null
    }>
  }
  pending_orders: {
    total_quantity: number
    orders_count: number
    details: Array<{
      id: number
      quantity: number
      status: string
      order_reason: string
      applicant_id: number
      created_at: string
    }>
  }
}

interface OrderFormData {
  name: string
  cas_number: string
  specification: string
  quantity: number
  type: 'reagent' | 'consumable'
  order_reason: 'experiment' | 'teaching' | 'common_public' | 'maintenance'
  location?: string
  notes?: string
  is_hazardous: boolean
}

interface OrderItem {
  id: number
  order_id?: number
  name: string
  cas_number: string
  specification: string
  quantity: number
  type: string
  order_reason: string
  status: string
  is_hazardous: boolean
  location?: string
  notes?: string
  created_at: string
}

export function OrdersPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [casInfo, setCasInfo] = useState<CASInventoryInfo | null>(null)
  const [casWarning, setCasWarning] = useState<CASWarningInfo | null>(null)
  const [casLoading, setCasLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState<OrderFormData>({
    name: '',
    cas_number: '',
    specification: '',
    quantity: 1,
    type: 'reagent',
    order_reason: 'experiment',
    location: '',
    notes: '',
    is_hazardous: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Arrival confirmation modal state
  const [showArrivalModal, setShowArrivalModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null)
  const [arrivalNotes, setArrivalNotes] = useState('')
  const [arrivalLoading, setArrivalLoading] = useState(false)

  // CAS check with warning
  useEffect(() => {
    if (formData.cas_number.length >= 5) {
      const timer = setTimeout(() => checkCASWarning(formData.cas_number), 500)
      return () => clearTimeout(timer)
    } else {
      setCasInfo(null)
      setCasWarning(null)
    }
  }, [formData.cas_number])

  const checkCASWarning = async (cas: string) => {
    setCasLoading(true)
    try {
      const response = await orderAPI.checkCasWarning(cas)
      const warning = response.data
      setCasWarning(warning)
      // Also set the simple casInfo for backward compatibility
      setCasInfo({
        exists_in_inventory: warning.inventory.items_count > 0,
        total_remaining: warning.inventory.total_remaining,
        in_stock_count: warning.inventory.details.filter((i: any) => i.status === 'in_stock').length,
        borrowed_count: warning.inventory.details.filter((i: any) => i.status === 'borrowed').length
      })
    } catch {
      setCasWarning(null)
      setCasInfo(null)
    } finally {
      setCasLoading(false)
    }
  }

  const loadOrders = async () => {
    try {
      const response = await orderAPI.list()
      setOrders(response.data || [])
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = '名称不能为空'
    if (!formData.cas_number.trim()) newErrors.cas_number = 'CAS号不能为空'
    if (!/^\d{2,7}-\d{2}-\d$/.test(formData.cas_number)) {
      newErrors.cas_number = 'CAS号格式无效 (如: 64-17-5)'
    }
    if (!formData.specification.trim()) newErrors.specification = '规格不能为空'
    if (formData.quantity < 1) newErrors.quantity = '数量必须大于0'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return
    
    setSubmitting(true)
    try {
      await orderAPI.create(formData)
      setSubmitSuccess(true)
      setFormData({
        name: '',
        cas_number: '',
        specification: '',
        quantity: 1,
        type: 'reagent',
        order_reason: 'experiment',
        location: '',
        notes: '',
        is_hazardous: false,
      })
      setCasInfo(null)
      setActiveTab('list')
      loadOrders()
      setTimeout(() => setSubmitSuccess(false), 3000)
    } catch (error: any) {
      alert(error.response?.data?.detail || '创建订单失败')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-blue-100 text-blue-800',
      ARRIVED: 'bg-green-100 text-green-800',
      STOCKED: 'bg-gray-100 text-gray-800',
      REJECTED: 'bg-red-100 text-red-800',
    }
    const labels: Record<string, string> = {
      PENDING: '待审批',
      APPROVED: '已审批',
      ARRIVED: '已到货',
      STOCKED: '已入库',
      REJECTED: '已驳回',
    }
    return (
      <span className={cn('px-2 py-1 text-xs rounded-full', styles[status] || 'bg-gray-100')}>
        {labels[status] || status}
      </span>
    )
  }

  const updateFormField = (field: keyof OrderFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // Arrival modal handlers
  const openArrivalModal = (order: OrderItem) => {
    setSelectedOrder(order)
    setArrivalNotes('')
    setShowArrivalModal(true)
  }

  const handleConfirmArrival = async () => {
    if (!selectedOrder) return
    setArrivalLoading(true)
    try {
      const response = await orderAPI.confirmArrival(selectedOrder.id, arrivalNotes || undefined)
      setShowArrivalModal(false)
      setSelectedOrder(null)
      loadOrders()
      
      // 入库提醒：如果是试剂且非 common_public，显示入库提示
      const message = response.data?.message || ''
      if (message.includes('已到货待入库')) {
        // TODO: 建议安装 sonner 替换为 toast 通知
        console.log('试剂已到货，请及时完成入库操作')
      }
    } catch (error: any) {
      alert(error.response?.data?.detail || '确认到货失败')
    } finally {
      setArrivalLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">订单管理</h1>
        <Button onClick={() => setActiveTab('create')}>
          <Plus className="w-4 h-4 mr-2" />
          新建申请
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b">
        <button
          className={cn(
            'px-4 py-2 border-b-2 transition-colors',
            activeTab === 'list'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          )}
          onClick={() => setActiveTab('list')}
        >
          所有订单
        </button>
        <button
          className={cn(
            'px-4 py-2 border-b-2 transition-colors',
            activeTab === 'create'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          )}
          onClick={() => setActiveTab('create')}
        >
          新建订单
        </button>
      </div>

      {/* Create Order Form */}
      {activeTab === 'create' && (
        <Card>
          <CardHeader>
            <CardTitle>新建试剂订购申请</CardTitle>
            <CardDescription>
              填写以下信息申请订购试剂或耗材。系统会自动检查 CAS 号库存情况。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitSuccess && (
              <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                订单创建成功！
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                {/* CAS Number */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    CAS号 <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Input
                      value={formData.cas_number}
                      onChange={(e) => updateFormField('cas_number', e.target.value)}
                      placeholder="如: 64-17-5"
                      className={errors.cas_number ? 'border-red-500' : ''}
                    />
                    {casLoading && (
                      <Loader2 className="absolute right-3 top-3 w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                    {casInfo && !casLoading && (
                      <div className={cn(
                        'absolute right-3 top-3 flex items-center gap-1',
                        casInfo.exists_in_inventory ? 'text-green-600' : 'text-muted-foreground'
                      )}>
                        {casInfo.exists_in_inventory ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                      </div>
                    )}
                  </div>
                  {errors.cas_number && (
                    <p className="text-sm text-red-500 mt-1">{errors.cas_number}</p>
                  )}
                  
                  {casWarning && casWarning.has_warning && (
                    <div className="mt-2 p-3 rounded-lg text-sm bg-orange-50 text-orange-700">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium">重复订购预警</span>
                      </div>
                      
                      {/* Inventory info */}
                      {casWarning.inventory.items_count > 0 && (
                        <div className="mb-2">
                          <div className="text-xs uppercase text-orange-600 mb-1">库存信息</div>
                          <div className="pl-2 border-l-2 border-orange-200 text-xs">
                            <div>剩余总量: {casWarning.inventory.total_remaining}</div>
                            <div className="mt-1">
                              {casWarning.inventory.details.slice(0, 3).map((item: any) => (
                                <div key={item.id} className="text-xs">
                                  编号: {item.internal_code} | 
                                  位置: {item.location || '未设置'} | 
                                  剩余: {item.remaining_quantity} | 
                                  状态: {item.status === 'borrowed' ? '已借出' : '在库'}
                                </div>
                              ))}
                              {casWarning.inventory.items_count > 3 && (
                                <div className="text-xs text-orange-500">
                                  ...还有 {casWarning.inventory.items_count - 3} 条记录
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Pending orders info */}
                      {casWarning.pending_orders.orders_count > 0 && (
                        <div>
                          <div className="text-xs uppercase text-orange-600 mb-1">待入库订单</div>
                          <div className="pl-2 border-l-2 border-orange-200 text-xs">
                            <div>待入库总量: {casWarning.pending_orders.total_quantity}</div>
                            <div className="mt-1">
                              {casWarning.pending_orders.details.slice(0, 2).map((order: any) => (
                                <div key={order.id} className="text-xs">
                                  订单 #{order.id} | 数量: {order.quantity} | 状态: {order.status}
                                </div>
                              ))}
                              {casWarning.pending_orders.orders_count > 2 && (
                                <div className="text-xs text-orange-500">
                                  ...还有 {casWarning.pending_orders.orders_count - 2} 个订单
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {casInfo && !casWarning?.has_warning && (
                    <div className={cn(
                      'mt-2 p-3 rounded-lg text-sm',
                      casInfo.exists_in_inventory
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-gray-50 text-gray-600'
                    )}>
                      {casInfo.exists_in_inventory ? (
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          <span>
                            库存中存在此试剂，剩余总量: <strong>{casInfo.total_remaining}</strong>
                            ({casInfo.in_stock_count} 在库, {casInfo.borrowed_count} 借出)
                          </span>
                        </div>
                      ) : (
                        <span>库存中暂无此试剂，可以新建订单</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    试剂名称 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => updateFormField('name', e.target.value)}
                    placeholder="如: 乙醇 (Ethanol)"
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-500 mt-1">{errors.name}</p>
                  )}
                </div>

                {/* Specification */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    规格 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.specification}
                    onChange={(e) => updateFormField('specification', e.target.value)}
                    placeholder="如: 500ml, 1L"
                    className={errors.specification ? 'border-red-500' : ''}
                  />
                  {errors.specification && (
                    <p className="text-sm text-red-500 mt-1">{errors.specification}</p>
                  )}
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    数量 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.quantity}
                    onChange={(e) => updateFormField('quantity', parseInt(e.target.value) || 1)}
                    className={errors.quantity ? 'border-red-500' : ''}
                  />
                  {errors.quantity && (
                    <p className="text-sm text-red-500 mt-1">{errors.quantity}</p>
                  )}
                </div>

                {/* Type */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    类型 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => updateFormField('type', e.target.value)}
                    className="w-full h-10 px-3 border rounded-md bg-background"
                  >
                    <option value="reagent">试剂 (Reagent)</option>
                    <option value="consumable">耗材 (Consumable)</option>
                  </select>
                </div>

                {/* Order Reason */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    用途 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.order_reason}
                    onChange={(e) => updateFormField('order_reason', e.target.value)}
                    className="w-full h-10 px-3 border rounded-md bg-background"
                  >
                    <option value="experiment">实验 (Experiment)</option>
                    <option value="teaching">教学 (Teaching)</option>
                    <option value="common_public">公共常用 (Common Public)</option>
                    <option value="maintenance">维护 (Maintenance)</option>
                  </select>
                </div>

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium mb-1">存放位置</label>
                  <Input
                    value={formData.location}
                    onChange={(e) => updateFormField('location', e.target.value)}
                    placeholder="如: A-1-1 柜"
                  />
                </div>

                {/* Hazardous */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_hazardous"
                    checked={formData.is_hazardous}
                    onChange={(e) => updateFormField('is_hazardous', e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <label htmlFor="is_hazardous" className="text-sm flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    危险品
                  </label>
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">备注</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => updateFormField('notes', e.target.value)}
                    className="w-full h-20 px-3 py-2 border rounded-md bg-background resize-none"
                    placeholder="其他说明..."
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t">
                <Button type="submit" disabled={submitting}>
                  {submitting ? '提交中...' : '提交申请'}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setFormData({
                      name: '',
                      cas_number: '',
                      specification: '',
                      quantity: 1,
                      type: 'reagent',
                      order_reason: 'experiment',
                      location: '',
                      notes: '',
                      is_hazardous: false,
                    })
                    setCasInfo(null)
                    setErrors({})
                  }}
                >
                  重置
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Orders List */}
      {activeTab === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle>所有订单</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">加载中...</div>
            ) : orders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                暂无订单
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {order.is_hazardous && (
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                        )}
                        <span className="font-medium">{order.name}</span>
                        {getStatusBadge(order.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        CAS: {order.cas_number} • {order.specification} × {order.quantity}
                        {order.location && ` • 位置: ${order.location}`}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        用途: {order.order_reason} • {formatDate(order.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {order.status === 'PENDING' && (
                        <Button variant="outline" size="sm">
                          取消
                        </Button>
                      )}
                      {order.status === 'APPROVED' && (
                        <Button 
                          size="sm" 
                          onClick={() => openArrivalModal(order)}
                        >
                          确认到货
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Arrival Confirmation Modal */}
      {showArrivalModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">确认到货</h2>
              <button
                onClick={() => setShowArrivalModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="font-medium">{selectedOrder.name}</p>
                <p className="text-sm text-muted-foreground">
                  CAS: {selectedOrder.cas_number} • {selectedOrder.specification} × {selectedOrder.quantity}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">备注 (可选)</label>
                <textarea
                  value={arrivalNotes}
                  onChange={(e) => setArrivalNotes(e.target.value)}
                  className="w-full h-20 px-3 py-2 border rounded-md bg-background resize-none"
                  placeholder="到货备注..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleConfirmArrival}
                  disabled={arrivalLoading}
                  className="flex-1"
                >
                  {arrivalLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    '确认到货'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowArrivalModal(false)}
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
