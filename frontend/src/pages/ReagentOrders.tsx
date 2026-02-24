import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { reagentOrderAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { useAuthStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import { AxiosError } from 'axios'
import {
  ShoppingCart,
  Plus,
  Loader2,
  Check,
  X,
  AlertTriangle,
  Package,
  Search
} from 'lucide-react'

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

// 订单状态映射 - 按任务要求
const STATUS_MAPPING: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  arrived: '已到货',
  stocked: '已入库',
  rejected: '已驳回'
}

// 状态样式 - 使用语义化颜色，支持暗黑模式
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  arrived: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  stocked: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

const columnHelper = createColumnHelper<ReagentOrder>()

export function ReagentOrdersPage() {
  const [orders, setOrders] = useState<ReagentOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // CAS check with warning - debounced
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
      
      // Check inventory (no direct API available)
      const inventoryInfo = { total_remaining: 0, items_count: 0 }
      
      if (existingOrders.length > 0) {
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

  // Load orders
  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }
      const response = await reagentOrderAPI.list(params)
      const result = response.data
      setOrders(result.data || [])
      setTotal(result.total || 0)
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

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
    setFormErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    setSubmitting(true)
    try {
      await reagentOrderAPI.create({
        ...formData,
        category: formData.category || undefined,
        brand: formData.brand || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
      })
      toast.success('试剂订单创建成功')
      setShowCreateDialog(false)
      resetForm()
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
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
    setFormErrors({})
    setCasWarning(null)
  }

  const handleCloseDialog = (open: boolean) => {
    setShowCreateDialog(open)
    if (!open) {
      resetForm()
    }
  }

  const handleApprove = async (id: number) => {
    try {
      await reagentOrderAPI.approve(id)
      toast.success('审批通过')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleReject = async (id: number) => {
    try {
      await reagentOrderAPI.reject(id, '管理员驳回')
      toast.success('已驳回')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleConfirmArrival = async (id: number) => {
    try {
      const result = await reagentOrderAPI.confirmArrival(id)
      toast.success(result.data.message || '确认成功')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleStockIn = async (id: number) => {
    try {
      const result = await reagentOrderAPI.stockIn(id)
      toast.success(`入库成功！创建了 ${result.data.items_created} 个库存条目`)
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '入库失败')
    }
  }

  // Table columns
  const columns = useMemo(() => [
    // CAS号
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 100,
      cell: info => (
        <span className="break-all font-mono text-sm">{info.getValue()}</span>
      ),
    }),
    // 名称
    columnHelper.accessor('name', {
      header: '名称',
      size: 140,
      cell: info => (
        <div className="flex items-center gap-1.5">
          {info.row.original.is_hazardous && (
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          )}
          <span className="font-medium">{info.getValue()}</span>
        </div>
      ),
    }),
    // 规格
    columnHelper.accessor('specification', {
      header: '规格',
      size: 80,
      cell: info => <span className="break-all">{info.getValue()}</span>,
    }),
    // 数量
    columnHelper.accessor('quantity', {
      header: '数量',
      size: 60,
      cell: info => <span>×{info.getValue()}</span>,
    }),
    // 价格
    columnHelper.accessor('price', {
      header: '价格',
      size: 80,
      cell: info => info.getValue() ? `¥${info.getValue()}` : '-',
    }),
    // 申请人
    columnHelper.accessor('applicant_name', {
      header: '申请人',
      size: 80,
      cell: info => info.getValue() || '-',
    }),
    // 状态
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      cell: info => {
        const status = info.getValue()
        return (
          <span className={cn(
            'px-2.5 py-1 text-xs rounded-full font-medium whitespace-nowrap',
            STATUS_STYLES[status] || 'bg-muted'
          )}>
            {STATUS_MAPPING[status] || status}
          </span>
        )
      },
    }),
    // 操作
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: info => {
        const order = info.row.original
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {isAdmin && order.status === 'pending' && (
              <>
                <Button 
                  size="sm" 
                  variant="default"
                  className="h-7 text-xs px-2"
                  onClick={() => handleApprove(order.id)}
                >
                  审批
                </Button>
                <Button 
                  size="sm" 
                  variant="destructive"
                  className="h-7 text-xs px-2"
                  onClick={() => handleReject(order.id)}
                >
                  驳回
                </Button>
              </>
            )}
            {order.status === 'approved' && (
              <Button 
                size="sm" 
                variant="secondary"
                className="h-7 text-xs px-2"
                onClick={() => handleConfirmArrival(order.id)}
              >
                确认到货
              </Button>
            )}
            {order.status === 'arrived' && (
              <Button 
                size="sm" 
                variant="outline"
                className="h-7 text-xs px-2"
                disabled={order.order_reason === 'common_public'}
                title={order.order_reason === 'common_public' ? '常用/公用试剂无需入库' : undefined}
                onClick={() => handleStockIn(order.id)}
              >
                一键入库
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [isAdmin])

  const table = useReactTable({
    data: orders,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">试剂订购</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          创建订单
        </Button>
      </div>

      {/* Create Order Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              创建试剂订单
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateOrder}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* CAS号 - 占满第一行 */}
              <div className="col-span-1 sm:col-span-3">
                <Label htmlFor="create_cas" className="mb-1.5 block">
                  CAS号 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_cas"
                  value={formData.cas_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, cas_number: e.target.value }))}
                  placeholder="如: 64-17-5"
                  className={cn("h-9", formErrors.cas_number && 'border-destructive')}
                />
                {formErrors.cas_number && (
                  <p className="text-xs text-destructive mt-1">{formErrors.cas_number}</p>
                )}
                {casWarning && casWarning.has_warning && (
                  <p className="text-sm text-orange-500 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    注意：
                    {casWarning.pending_orders.orders_count > 0 && 
                      `${casWarning.pending_orders.orders_count} 个相关订单待处理 (共 ${casWarning.pending_orders.total_quantity})`}
                  </p>
                )}
                {casLoading && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    检查中...
                  </p>
                )}
              </div>

              {/* 中文名称 */}
              <div className="col-span-1 sm:col-span-2">
                <Label htmlFor="create_name" className="mb-1.5 block">
                  中文名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="如: 乙醇"
                  className={cn("h-9", formErrors.name && 'border-destructive')}
                />
                {formErrors.name && (
                  <p className="text-xs text-destructive mt-1">{formErrors.name}</p>
                )}
              </div>

              {/* 英文名称 */}
              <div>
                <Label htmlFor="create_english_name" className="mb-1.5 block">英文名称</Label>
                <Input
                  id="create_english_name"
                  value={formData.english_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, english_name: e.target.value }))}
                  placeholder="如: Ethanol"
                  className="h-9"
                />
              </div>

              {/* 别名 */}
              <div>
                <Label htmlFor="create_alias" className="mb-1.5 block">别名</Label>
                <Input
                  id="create_alias"
                  value={formData.alias}
                  onChange={(e) => setFormData(prev => ({ ...prev, alias: e.target.value }))}
                  placeholder="如: 酒精"
                  className="h-9"
                />
              </div>

              {/* 级别/规格 */}
              <div>
                <Label htmlFor="create_category" className="mb-1.5 block">级别/规格</Label>
                <Input
                  id="create_category"
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="如: 分析纯"
                  className="h-9"
                />
              </div>

              {/* 品牌 */}
              <div>
                <Label htmlFor="create_brand" className="mb-1.5 block">品牌</Label>
                <Input
                  id="create_brand"
                  value={formData.brand}
                  onChange={(e) => setFormData(prev => ({ ...prev, brand: e.target.value }))}
                  placeholder="如: Sigma"
                  className="h-9"
                />
              </div>

              {/* 规格 */}
              <div>
                <Label htmlFor="create_specification" className="mb-1.5 block">
                  规格 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_specification"
                  value={formData.specification}
                  onChange={(e) => setFormData(prev => ({ ...prev, specification: e.target.value }))}
                  placeholder="如: 500ml"
                  className={cn("h-9", formErrors.specification && 'border-destructive')}
                />
                {formErrors.specification && (
                  <p className="text-xs text-destructive mt-1">{formErrors.specification}</p>
                )}
              </div>

              {/* 数量 */}
              <div>
                <Label htmlFor="create_quantity" className="mb-1.5 block">
                  数量 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  className={cn("h-9", formErrors.quantity && 'border-destructive')}
                />
                {formErrors.quantity && (
                  <p className="text-xs text-destructive mt-1">{formErrors.quantity}</p>
                )}
              </div>

              {/* 价格 */}
              <div>
                <Label htmlFor="create_price" className="mb-1.5 block">价格 (元)</Label>
                <Input
                  id="create_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="如: 150.00"
                  className="h-9"
                />
              </div>

              {/* 订购原因 */}
              <div>
                <Label htmlFor="create_order_reason" className="mb-1.5 block">订购原因</Label>
                <select
                  id="create_order_reason"
                  value={formData.order_reason}
                  onChange={(e) => setFormData(prev => ({ ...prev, order_reason: e.target.value }))}
                  className="h-9 w-full px-3 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1rem'
                  }}
                >
                  <option value="none">没有</option>
                  <option value="running_out">快用完</option>
                  <option value="empty">用完</option>
                  <option value="common_public">常用或公用</option>
                  <option value="not_found">找不到</option>
                  <option value="reorder">重新下单</option>
                </select>
              </div>

              {/* 危险品 */}
              <div className="flex items-center gap-2 h-9">
                <input
                  type="checkbox"
                  id="create_is_hazardous"
                  checked={formData.is_hazardous}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_hazardous: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <Label htmlFor="create_is_hazardous" className="flex items-center gap-1 cursor-pointer mb-0">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </Label>
              </div>

              {/* 备注 */}
              <div className="col-span-1 sm:col-span-3">
                <Label htmlFor="create_notes" className="mb-1.5 block">备注</Label>
                <textarea
                  id="create_notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full h-20 px-3 py-2 border border-input rounded-md bg-background text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-3 border-t">
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCloseDialog(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={submitting} size="sm">
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      提交中...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-1.5" />
                      提交订单
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索试剂名称、CAS号..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm w-full"
              />
              {globalFilter && (
                <button
                  onClick={() => setGlobalFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5" />
            试剂订单列表 <span className="text-muted-foreground font-normal">({total})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无订单
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-auto">
                <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id} className="border-b bg-muted/30">
                        {headerGroup.headers.map(header => (
                          <th 
                            key={header.id} 
                            className="h-11 px-3 font-semibold text-foreground text-left align-middle text-sm"
                            style={{ width: header.getSize() }}
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
                    {table.getRowModel().rows.map(row => (
                      <tr 
                        key={row.id} 
                        className="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        {row.getVisibleCells().map(cell => (
                          <td 
                            key={cell.id} 
                            className="p-3 align-middle text-sm"
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
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 px-4 pb-4">
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
