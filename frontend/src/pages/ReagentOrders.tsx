import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { reagentOrderAPI, inventoryAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { useAuthStore } from '@/store/useStore'

interface ReagentOrder {
  id: number
  cas_number: string
  name: string
  english_name?: string
  alias?: string
  category?: string
  brand?: string
  specification: string
  quantity: number
  price?: number
  order_reason: string
  is_hazardous: boolean
  image_path?: string
  notes?: string
  applicant_id: number
  applicant_name?: string
  status: string
  created_at: string
  updated_at: string
}

interface CASWarningInfo {
  cas_number: string
  has_warning: boolean
  inventory: {
    total_remaining: number
    items_count: number
  }
  pending_orders: {
    total_quantity: number
    orders_count: number
  }
}

import {
  REAGENT_STATUS_MAP as STATUS_MAPPING,
  REAGENT_STATUS_STYLE as STATUS_CLASS_MAPPING,
  ORDER_REASON_MAP as REASON_MAPPING,
} from '@/lib/constants'

export function ReagentOrdersPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [orders, setOrders] = useState<ReagentOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [casWarning, setCasWarning] = useState<CASWarningInfo | null>(null)
  const [casLoading, setCasLoading] = useState(false)
  
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'admin'

  const [formData, setFormData] = useState({
    cas_number: '',
    name: '',
    english_name: '',
    alias: '',
    category: '',
    brand: '',
    specification: '',
    quantity: 1,
    price: '',
    order_reason: 'none',
    is_hazardous: false,
    notes: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // CAS check with warning
  useEffect(() => {
    if (formData.cas_number.length >= 5) {
      const timer = setTimeout(() => checkCASWarning(formData.cas_number), 500)
      return () => clearTimeout(timer)
    } else {
      setCasWarning(null)
    }
  }, [formData.cas_number])

  const checkCASWarning = async (cas: string) => {
    setCasLoading(true)
    try {
      // Check existing orders
      const response = await reagentOrderAPI.list()
      const allOrders: ReagentOrder[] = response.data.data || []
      const existingOrders = allOrders.filter((o: ReagentOrder) => o.cas_number.replace(/-/g, '') === cas.replace(/-/g, ''))
      
      // Check inventory
      let inventoryInfo = { total_remaining: 0, items_count: 0 }
      try {
        const invResponse = await inventoryAPI.checkCAS(cas)
        if (invResponse.data) {
          inventoryInfo = {
            total_remaining: invResponse.data.remaining_quantity || 0,
            items_count: invResponse.data.items?.length || 0
          }
        }
      } catch (e) {
        // No inventory found, ignore
      }
      
      if (existingOrders.length > 0 || inventoryInfo.items_count > 0) {
        setCasWarning({
          cas_number: cas,
          has_warning: true,
          inventory: inventoryInfo,
          pending_orders: { total_quantity: existingOrders.reduce((sum: number, o: ReagentOrder) => sum + o.quantity, 0), orders_count: existingOrders.length }
        })
      } else {
        setCasWarning(null)
      }
    } catch (error) {
      console.error('CAS check error:', error)
    } finally {
      setCasLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [page, pageSize])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const response = await reagentOrderAPI.list({
        skip: (page - 1) * pageSize,
        limit: pageSize,
      })
      const result = response.data
      setOrders(result.data || [])
      setTotal(result.total || 0)
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = '名称不能为空'
    if (!formData.cas_number.trim()) newErrors.cas_number = 'CAS号不能为空'
    if (!/^\d{2,7}-\d{2}-\d$/.test(formData.cas_number)) {
      newErrors.cas_number = 'CAS号格式无效 (如: 64-17-5)'
    }
    if (!formData.specification.trim()) newErrors.specification = '规格不能为空'
    if (formData.quantity <= 0) newErrors.quantity = '数量必须大于0'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    try {
      await reagentOrderAPI.create({
        ...formData,
        category: formData.category || undefined,
        brand: formData.brand || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
      })
      toast.success('试剂订单创建成功')
      setFormData({
        cas_number: '',
        name: '',
        english_name: '',
        alias: '',
        category: '',
        brand: '',
        specification: '',
        quantity: 1,
        price: '',
        order_reason: 'none',
        is_hazardous: false,
        notes: '',
      })
      setCasWarning(null)
      setActiveTab('list')
      loadOrders()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '创建失败')
    }
  }

  const handleApprove = async (id: number) => {
    try {
      await reagentOrderAPI.approve(id)
      toast.success('审批通过')
      loadOrders()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleReject = async (id: number) => {
    try {
      await reagentOrderAPI.reject(id, '管理员驳回')
      toast.success('已驳回')
      loadOrders()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleConfirmArrival = async (id: number) => {
    try {
      const result = await reagentOrderAPI.confirmArrival(id)
      toast.success(result.data.message || '确认成功')
      loadOrders()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleStockIn = async (id: number) => {
    try {
      const result = await reagentOrderAPI.stockIn(id)
      toast.success(`入库成功！创建了 ${result.data.items_created} 个库存条目`)
      loadOrders()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '入库失败')
    }
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">试剂订购</h1>
        <div className="space-x-2">
          <Button variant={activeTab === 'list' ? 'default' : 'outline'} onClick={() => setActiveTab('list')}>
            订单列表
          </Button>
          <Button variant={activeTab === 'create' ? 'default' : 'outline'} onClick={() => setActiveTab('create')}>
            创建订单
          </Button>
        </div>
      </div>

      {activeTab === 'create' && (
        <Card>
          <CardHeader>
            <CardTitle>创建试剂订单</CardTitle>
            <CardDescription>
              填写以下信息申请订购试剂。系统会自动检查 CAS 号库存情况。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {/* CAS Number */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    CAS号 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.cas_number}
                    onChange={(e) => updateFormField('cas_number', e.target.value)}
                    placeholder="如: 64-17-5"
                    className={errors.cas_number ? 'border-red-500' : ''}
                  />
                  {errors.cas_number && <p className="text-sm text-red-500 mt-1">{errors.cas_number}</p>}
                  {casWarning && casWarning.has_warning && (
                    <p className="text-sm text-orange-500 mt-1">
                      ⚠️ 注意：
                      {casWarning.inventory.items_count > 0 && `库中有 ${casWarning.inventory.items_count} 项库存 (${casWarning.inventory.total_remaining}) `}
                      {casWarning.pending_orders.orders_count > 0 && `${casWarning.pending_orders.orders_count} 个相关订单待处理`}
                    </p>
                  )}
                  {casLoading && <p className="text-sm text-gray-500 mt-1">检查中...</p>}
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    中文名称 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => updateFormField('name', e.target.value)}
                    placeholder="如: 乙醇"
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name}</p>}
                </div>

                {/* English Name */}
                <div>
                  <label className="block text-sm font-medium mb-1">英文名称</label>
                  <Input
                    value={formData.english_name}
                    onChange={(e) => updateFormField('english_name', e.target.value)}
                    placeholder="如: Ethanol"
                  />
                </div>

                {/* Alias */}
                <div>
                  <label className="block text-sm font-medium mb-1">别名</label>
                  <Input
                    value={formData.alias}
                    onChange={(e) => updateFormField('alias', e.target.value)}
                    placeholder="如: 酒精"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium mb-1">级别/规格</label>
                  <Input
                    value={formData.category}
                    onChange={(e) => updateFormField('category', e.target.value)}
                    placeholder="如: 分析纯、实验级"
                  />
                </div>

                {/* Brand */}
                <div>
                  <label className="block text-sm font-medium mb-1">品牌</label>
                  <Input
                    value={formData.brand}
                    onChange={(e) => updateFormField('brand', e.target.value)}
                    placeholder="如: Sigma、国药"
                  />
                </div>

                {/* Specification */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    规格 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.specification}
                    onChange={(e) => updateFormField('specification', e.target.value)}
                    placeholder="如: 500ml"
                    className={errors.specification ? 'border-red-500' : ''}
                  />
                  {errors.specification && <p className="text-sm text-red-500 mt-1">{errors.specification}</p>}
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
                    onChange={(e) => updateFormField('quantity', parseInt(e.target.value))}
                    className={errors.quantity ? 'border-red-500' : ''}
                  />
                  {errors.quantity && <p className="text-sm text-red-500 mt-1">{errors.quantity}</p>}
                </div>

                {/* Price */}
                <div>
                  <label className="block text-sm font-medium mb-1">价格 (元)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => updateFormField('price', e.target.value)}
                    placeholder="如: 150.00"
                  />
                </div>

                {/* Order Reason */}
                <div>
                  <label className="block text-sm font-medium mb-1">订购原因</label>
                  <select
                    value={formData.order_reason}
                    onChange={(e) => updateFormField('order_reason', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="none">没有</option>
                    <option value="running_out">快用完</option>
                    <option value="empty">用完</option>
                    <option value="common_public">常用或公用</option>
                    <option value="not_found">找不到</option>
                    <option value="reorder">重新下单</option>
                  </select>
                </div>

                {/* Is Hazardous */}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_hazardous"
                    checked={formData.is_hazardous}
                    onChange={(e) => updateFormField('is_hazardous', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="is_hazardous" className="text-sm font-medium">危险品</label>
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">备注</label>
                  <Input
                    value={formData.notes}
                    onChange={(e) => updateFormField('notes', e.target.value)}
                    placeholder="其他说明..."
                  />
                </div>
              </div>

              <Button type="submit">提交订单</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle>试剂订单列表</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center py-4">加载中...</p>
            ) : orders.length === 0 ? (
              <p className="text-center py-4 text-gray-500">暂无订单</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{order.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          CAS: {order.cas_number} • {order.specification} × {order.quantity}
                          {order.price && ` • ¥${order.price}`}
                          {order.english_name && ` • ${order.english_name}`}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          申请人: {order.applicant_name || order.applicant_id} • {new Date(order.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${STATUS_CLASS_MAPPING[order.status]}`}>
                          {STATUS_MAPPING[order.status]}
                        </span>
                        <div className="flex gap-1">
                          {isAdmin && order.status === 'pending' && (
                            <>
                              <Button size="sm" onClick={() => handleApprove(order.id)}>审批</Button>
                              <Button size="sm" variant="destructive" onClick={() => handleReject(order.id)}>驳回</Button>
                            </>
                          )}
                          {order.status === 'approved' && (
                            <Button size="sm" onClick={() => handleConfirmArrival(order.id)}>确认到货</Button>
                          )}
                          {order.status === 'arrived' && (
                            <Button
                              size="sm"
                              disabled={order.order_reason === 'common_public'}
                              title={order.order_reason === 'common_public' ? '常用/公用试剂无需入库，请使用确认到货' : undefined}
                              onClick={() => handleStockIn(order.id)}
                            >
                              一键入库
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <PaginationInfo currentPage={page} pageSize={pageSize} total={total} />
                    <Pagination
                      currentPage={page}
                      totalPages={totalPages}
                      pageSize={pageSize}
                      onPageChange={setPage}
                      onPageSizeChange={handlePageSizeChange}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )

  function updateFormField(field: string, value: any) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }
}
