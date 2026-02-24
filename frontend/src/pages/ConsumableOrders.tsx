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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { consumableOrderAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { useAuthStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import { AxiosError } from 'axios'
import {
  ShoppingCart,
  Plus,
  Loader2,
  X,
  AlertTriangle,
  Package,
  Search
} from 'lucide-react'

interface ConsumableOrder {
  id: number
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

// 订单状态映射
const STATUS_MAPPING: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  completed: '已完成',
  rejected: '已驳回'
}

// 状态样式 - 使用语义化颜色，支持暗黑模式
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

const columnHelper = createColumnHelper<ConsumableOrder>()

export function ConsumableOrdersPage() {
  const [orders, setOrders] = useState<ConsumableOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'admin'

  const [formData, setFormData] = useState({
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

  // Load orders
  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }
      const response = await consumableOrderAPI.list(params)
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
      await consumableOrderAPI.create({
        ...formData,
        category: formData.category || undefined,
        brand: formData.brand || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
      })
      toast.success('耗材订单创建成功')
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
  }

  const handleCloseDialog = (open: boolean) => {
    setShowCreateDialog(open)
    if (!open) {
      resetForm()
    }
  }

  const handleApprove = async (id: number) => {
    try {
      await consumableOrderAPI.approve(id)
      toast.success('审批通过')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleReject = async (id: number) => {
    try {
      await consumableOrderAPI.reject(id, '管理员驳回')
      toast.success('已驳回')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  const handleComplete = async (id: number) => {
    try {
      await consumableOrderAPI.complete(id)
      toast.success('耗材订单已完成')
      loadOrders()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  // Table columns
  const columns = useMemo(() => [
    // 名称
    columnHelper.accessor('name', {
      header: '名称',
      size: 160,
      cell: info => (
        <div className="flex items-center gap-1.5">
          {info.row.original.is_hazardous && (
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          )}
          <span className="font-medium">{info.getValue()}</span>
        </div>
      ),
    }),
    // 英文名称
    columnHelper.accessor('english_name', {
      header: '英文名称',
      size: 120,
      cell: info => info.getValue() || '-',
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
    // 品牌
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 80,
      cell: info => info.getValue() || '-',
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
      size: 160,
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
                onClick={() => handleComplete(order.id)}
              >
                确认完成
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
        <h1 className="text-3xl font-bold tracking-tight">耗材订购</h1>
        <Button onClick={() => setShowCreateDialog(true)} size="lg">
          <Plus className="w-4 h-4 mr-1.5" />
          创建订单
        </Button>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索耗材名称..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 pr-8 h-10 text-base w-full"
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

      {/* Create Order Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              创建耗材订单
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateOrder}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 中文名称 */}
              <div className="col-span-1 sm:col-span-2">
                <Label htmlFor="create_name" className={LABEL_STYLES.base}>
                  中文名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="如: 一次性手套"
                  className={cn(INPUT_STYLES.lg, formErrors.name && 'border-destructive')}
                />
                {formErrors.name && (
                  <p className="text-xs text-destructive mt-1">{formErrors.name}</p>
                )}
              </div>

              {/* 英文名称 */}
              <div>
                <Label htmlFor="create_english_name" className={LABEL_STYLES.base}>英文名称</Label>
                <Input
                  id="create_english_name"
                  value={formData.english_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, english_name: e.target.value }))}
                  placeholder="如: Disposable Gloves"
                  className={INPUT_STYLES.lg}
                />
              </div>

              {/* 别名 */}
              <div>
                <Label htmlFor="create_alias" className={LABEL_STYLES.base}>别名</Label>
                <Input
                  id="create_alias"
                  value={formData.alias}
                  onChange={(e) => setFormData(prev => ({ ...prev, alias: e.target.value }))}
                  placeholder="如: 手套"
                  className={INPUT_STYLES.lg}
                />
              </div>

              {/* 分类 */}
              <div>
                <Label htmlFor="create_category" className={LABEL_STYLES.base}>分类</Label>
                <Input
                  id="create_category"
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="如: 手套、试管"
                  className={INPUT_STYLES.lg}
                />
              </div>

              {/* 品牌 */}
              <div>
                <Label htmlFor="create_brand" className={LABEL_STYLES.base}>品牌</Label>
                <Input
                  id="create_brand"
                  value={formData.brand}
                  onChange={(e) => setFormData(prev => ({ ...prev, brand: e.target.value }))}
                  placeholder="如: 3M、Corning"
                  className={INPUT_STYLES.lg}
                />
              </div>

              {/* 规格 */}
              <div>
                <Label htmlFor="create_specification" className={LABEL_STYLES.base}>
                  规格 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_specification"
                  value={formData.specification}
                  onChange={(e) => setFormData(prev => ({ ...prev, specification: e.target.value }))}
                  placeholder="如: 100只/盒"
                  className={cn(INPUT_STYLES.lg, formErrors.specification && 'border-destructive')}
                />
                {formErrors.specification && (
                  <p className="text-xs text-destructive mt-1">{formErrors.specification}</p>
                )}
              </div>

              {/* 数量 */}
              <div>
                <Label htmlFor="create_quantity" className={LABEL_STYLES.base}>
                  数量 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="create_quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  className={cn(INPUT_STYLES.lg, formErrors.quantity && 'border-destructive')}
                />
                {formErrors.quantity && (
                  <p className="text-xs text-destructive mt-1">{formErrors.quantity}</p>
                )}
              </div>

              {/* 价格 */}
              <div>
                <Label htmlFor="create_price" className={LABEL_STYLES.base}>价格 (元)</Label>
                <Input
                  id="create_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="如: 25.00"
                  className={INPUT_STYLES.lg}
                />
              </div>

              {/* 订购原因 */}
              <div>
                <Label htmlFor="create_order_reason" className={LABEL_STYLES.base}>订购原因</Label>
                <Select
                  value={formData.order_reason}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, order_reason: value }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="选择订购原因" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">没有</SelectItem>
                    <SelectItem value="running_out">快用完</SelectItem>
                    <SelectItem value="empty">用完</SelectItem>
                    <SelectItem value="common_public">常用或公用</SelectItem>
                    <SelectItem value="not_found">找不到</SelectItem>
                    <SelectItem value="reorder">重新下单</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 危险品 */}
              <div className="flex items-center gap-2 h-9">
                <Checkbox
                  id="create_is_hazardous"
                  checked={formData.is_hazardous}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_hazardous: checked === true }))}
                />
                <Label htmlFor="create_is_hazardous" className="flex items-center gap-1 cursor-pointer mb-0">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </Label>
              </div>

              {/* 备注 */}
              <div className="col-span-1 sm:col-span-3">
                <Label htmlFor="create_notes" className={LABEL_STYLES.base}>备注</Label>
                <Input
                  id="create_notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className={cn("w-full", INPUT_STYLES.lg)}
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-3 border-t">
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="morden"
                  size="lg"
                  className="text-base"
                  onClick={() => handleCloseDialog(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={submitting} size="lg">
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      提交中...
                    </>
                  ) : (
                    '提交订单'
                  )}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5" />
            耗材订单列表 <span className="text-muted-foreground font-normal">(&thinsp;{total}&thinsp;)</span>
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
              <div className="px-6 rounded-md overflow-auto">
                <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id} className="border-b-2 border-border">
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
                        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-none"
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
                <div className="px-6 flex items-center justify-between pt-4">
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
