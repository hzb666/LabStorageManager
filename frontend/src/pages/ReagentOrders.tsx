/**
 * 试剂订单页面
 * 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、入库
 * 参考 Inventory 页面实现，使用 DataTable + BaseForm + Valibot
 */
import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState, ColumnSizingState, RowData, Table } from '@tanstack/react-table'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { StatusBadge, ORDER_REASON_LABELS } from '@/components/ui/StatusBadge'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { DataTable } from '@/components/ui/DataTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/components/ui/Toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'

// 工具与API
import { reagentOrderAPI } from '@/api/client'
import { formatDate } from '@/lib/utils'
import { ReagentOrderSchema } from '@/lib/validationSchemas'
import type { ReagentOrderFormData } from '@/lib/validationSchemas'
import { 
  getReagentOrderFormFields, 
  defaultReagentOrderValues 
} from '@/lib/formConfigs'

// 图标
import {
  Search,
  Loader2,
  X,
  Plus,
  Pencil,
  FlaskConical,
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowUpFromLine,
} from 'lucide-react'

// 类型扩展
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean
    onEdit: (item: TData) => void
  }
}

interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

interface ReagentOrder {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  specification: string
  initial_quantity: number | null
  unit: string | null
  quantity: number
  price: number | null
  order_reason: string
  is_hazardous: boolean
  image_path: string | null
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
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

// 搜索高亮组件
const HighlightText = React.memo(function HighlightText({
  text, highlight, fuzzy
}: { text: string; highlight?: string; fuzzy?: boolean }) {
  const regex = React.useMemo(() => new RegExp(`(${highlight})`, 'gi'), [highlight])
  if (!highlight || !text) return <>{text}</>

  if (fuzzy) {
    const normalizedHighlight = highlight.replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D_.-]+/g, '')
    const normalizedText = text.replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D_.-]+/g, '')
    if (normalizedText.toLowerCase().includes(normalizedHighlight.toLowerCase())) {
      return <span className="bg-amber-200 dark:bg-amber-800/50">{text}</span>
    }
    return <>{text}</>
  }

  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-amber-200 dark:bg-amber-800/50">{part}</span>
        ) : part
      )}
    </>
  )
})

const columnHelper = createColumnHelper<ReagentOrder>()

// ============================================================================
// 主组件
// ============================================================================

export function ReagentOrdersPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'admin'

  // 表格状态
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('reagent-orders-table-col-sizes') || '{}')
      // 过滤掉宽度为0的列（防止旧数据导致列消失）
      const filtered: ColumnSizingState = {}
      for (const [key, size] of Object.entries(saved)) {
        if (typeof size === 'number' && size > 0) {
          filtered[key] = size
        }
      }
      return Object.keys(filtered).length > 0 ? filtered : {}
    } catch { return {} }
  })
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // 搜索过滤状态
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)
  const sortingRef = useRef<SortingState>([])

  // 总数统计
  const [grandTotal, setGrandTotal] = useState(0)
  const grandTotalRef = useRef(0)

  // Dialog 状态
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [editingItem, setEditingItem] = useState<ReagentOrder | null>(null)
  const [casWarning, setCasWarning] = useState<CASWarningInfo | null>(null)
  const [casLoading, setCasLoading] = useState(false)

  const tableRef = useRef<Table<ReagentOrder> | null>(null)

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globalFilter !== searchInput) {
        // 不再调用 tableRef.current.resetExpanded()，保持展开全部状态
        setGlobalFilter(searchInput)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, globalFilter])

  // 保存列宽
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('reagent-orders-table-col-sizes', JSON.stringify(columnSizing))
    }, 500)
    return () => clearTimeout(timer)
  }, [columnSizing])

  const toggleExpandAll = useCallback(() => setIsAllExpanded(prev => !prev), [])

  // CAS 检查（防抖）
  const checkCASWarning = useCallback(async (cas: string) => {
    if (cas.length < 5) {
      setCasWarning(null)
      return
    }
    setCasLoading(true)
    try {
      const response = await reagentOrderAPI.list()
      const allOrders: ReagentOrder[] = response.data.data || []
      const existingOrders = allOrders.filter(
        (o: ReagentOrder) => o.cas_number.replace(/-/g, '') === cas.replace(/-/g, '')
      )
      if (existingOrders.length > 0) {
        setCasWarning({
          cas_number: cas,
          has_warning: true,
          inventory: { total_remaining: 0, items_count: 0 },
          pending_orders: {
            total_quantity: existingOrders.reduce((sum: number, o: ReagentOrder) => sum + o.quantity, 0),
            orders_count: existingOrders.length
          }
        })
      } else {
        setCasWarning(null)
      }
    } catch (error) {
      console.error('CAS check error:', error)
    } finally {
      setCasLoading(false)
    }
  }, [])

  // 数据查询
  const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam: number }) => {
    const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
    const sort = currentSorting[0]

    const params: Record<string, unknown> = { skip: pageParam, limit: 50 }

    if (statusFilter !== 'all') params.status_filter = statusFilter
    if (globalFilter) {
      params.search = globalFilter
      if (searchField !== 'all') params.search_field = searchField
      if (fuzzySearch) params.fuzzy = true
    }
    if (sort) {
      params.sort_by = sort.id
      params.sort_order = sort.desc ? 'desc' : 'asc'
    }

    const response = await reagentOrderAPI.list(params as any)
    return response.data
  }, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])

  const {
    data: allData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['reagent-orders', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
      if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
      return null
    },
    placeholderData: keepPreviousData,
    // refetchInterval: 10000, // [FIXME] 反模式：无限查询不应使用全局轮询
  })

  const data = useMemo(() => allData?.pages.flatMap(page => page.data) ?? [], [allData])
  const total = allData?.pages[0]?.total ?? 0

  // 总数统计
  useEffect(() => {
    if (!globalFilter && total > 0) {
      grandTotalRef.current = total
      setGrandTotal(total)
    }
  }, [total, globalFilter])

  const displayCount = globalFilter ? `${total}/${grandTotalRef.current}` : `${grandTotal}`

  // 表单实例
  const form = useForm<ReagentOrderFormData>({
    resolver: valibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })

  // CAS 号变化时检查警告
  useEffect(() => {
    const subscription = form.watch((value, field) => {
      if (field.name === 'cas_number' && value.cas_number) {
        const timer = setTimeout(() => checkCASWarning(value.cas_number as string), 500)
        return () => clearTimeout(timer)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, checkCASWarning])

  // 加载数据
  const loadOrders = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['reagent-orders'] })
  }, [queryClient])

  // 点击添加按钮
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    form.reset(defaultReagentOrderValues)
    setCasWarning(null)
    setDialogState('add')
  }, [form, setDialogState])

  // 点击编辑按钮
  const handleEditClick = useCallback((item: ReagentOrder) => {
    setEditingItem(item)
    form.reset({
      name: item.name || '',
      cas_number: item.cas_number || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      category: item.category || '',
      brand: item.brand || '',
      specification: item.specification || '',
      quantity: item.quantity || 1,
      price: item.price || undefined,
      order_reason: item.order_reason || 'none',
      is_hazardous: item.is_hazardous || false,
      supplier: '',
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [form, setDialogState])

  const [isSubmitting, setIsSubmitting] = useState(false)

  // 表单提交
  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      console.log('✅ 订单表单验证通过:', formData)

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          await reagentOrderAPI.update(editingItem.id, {
            name: formData.name,
            english_name: formData.english_name || undefined,
            alias: formData.alias || undefined,
            category: formData.category || undefined,
            brand: formData.brand || undefined,
            specification: formData.specification || undefined,
            quantity: formData.quantity,
            price: formData.price,
            order_reason: formData.order_reason,
            is_hazardous: formData.is_hazardous,
            notes: formData.notes || undefined
          })
        } else if (dialogState === 'add') {
          await reagentOrderAPI.create({
            ...formData,
            category: formData.category || undefined,
            brand: formData.brand || undefined,
            price: formData.price ? parseFloat(String(formData.price)) : undefined,
          })
        }
        // 先刷新数据，再弹出 toast，确保数据已加载完成
        await loadOrders()
        if (dialogState === 'edit') {
          toast.success('订单信息已更新')
        } else if (dialogState === 'add') {
          toast.success('试剂订单创建成功')
        }
        setDialogState(null)
      } catch (err) {
        const error = err as { response?: { data?: { detail?: string | ValidationError[] | unknown } } }
        const errorDetail = error.response?.data?.detail
        if (dialogState === 'add' && Array.isArray(errorDetail)) {
          errorDetail.forEach((e: ValidationError) => {
            if (e.loc && e.loc[1]) form.setError(e.loc[1] as keyof ReagentOrderFormData, { message: e.msg || '验证错误' })
          })
        } else {
          toast.error(typeof errorDetail === 'string' ? errorDetail : '操作失败')
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    (errors) => {
      console.log('❌ 表单验证失败:', errors)
    }
  )

  // 审批操作
  const handleApprove = useCallback(async (id: number) => {
    try {
      await reagentOrderAPI.approve(id)
      // 先刷新数据，再弹出 toast
      await loadOrders()
      toast.success('审批通过')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '操作失败')
    }
  }, [loadOrders])

  // 驳回操作
  const handleReject = useCallback(async (id: number) => {
    try {
      await reagentOrderAPI.reject(id, '管理员驳回')
      // 先刷新数据，再弹出 toast
      await loadOrders()
      toast.success('已驳回')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '操作失败')
    }
  }, [loadOrders])

  // 确认到货
  const handleConfirmArrival = useCallback(async (id: number) => {
    try {
      const result = await reagentOrderAPI.confirmArrival(id)
      // 先刷新数据，再弹出 toast
      await loadOrders()
      toast.success(result.data.message || '确认成功')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '操作失败')
    }
  }, [loadOrders])

  // 导出订单
  const handleExport = useCallback(async () => {
    try {
      const response = await reagentOrderAPI.exportOrders()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `reagent_orders_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // 表格列配置
  const columns = useMemo(() => [
    columnHelper.accessor('cas_number', {
      header: 'CAS号', size: 110, minSize: 90, maxSize: 180,
      cell: info => (
        <span className="break-all text-base">
          <HighlightText
            text={info.getValue() || ''}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('name', {
      header: '名称', size: 180, minSize: 150, maxSize: 300,
      cell: info => (
        <div className="flex items-center gap-1.5">
          <HazardousIcon isHazardous={info.row.original.is_hazardous} />
          <span className="font-medium">
            <HighlightText
              text={info.getValue() || ''}
              highlight={info.table.getState().globalFilter}
              fuzzy={info.table.options.meta?.fuzzySearch}
            />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('brand', {
      header: '品牌', size: 90, minSize: 70, maxSize: 150,
      cell: info => <span>{info.getValue() || '-'}</span>,
    }),
    columnHelper.accessor('specification', {
      header: '规格', size: 120, minSize: 80, maxSize: 200,
      cell: info => {
        const order = info.row.original
        const specification = info.getValue()
        const displayText = specification
          ? specification
          : (order.unit ? `${order.initial_quantity} ${order.unit}` : `${order.initial_quantity}`)
        const qty = order.quantity
        if (qty > 1) {
          return <span className="break-all">{qty} × {displayText}</span>
        }
        return <span className="break-all">{displayText || '-'}</span>
      },
    }),
    columnHelper.accessor('price', {
      header: '价格', size: 70, minSize: 60, maxSize: 100,
      cell: info => info.getValue() ? `¥${info.getValue()}` : '-',
    }),
    columnHelper.accessor('order_reason', {
      header: '原因', size: 60, minSize: 50, maxSize: 80,
      cell: info => {
        const reason = info.getValue()
        return <span>{ORDER_REASON_LABELS[reason] || reason}</span>
      },
    }),
    columnHelper.accessor('applicant_name', {
      header: '订购人', size: 70, minSize: 60, maxSize: 100,
      cell: info => <span>{info.getValue() || '-'}</span>,
    }),
    columnHelper.accessor('created_at', {
      header: '时间', size: 80, minSize: 70, maxSize: 120,
      cell: info => <span>{formatDate(info.getValue()).split(' ')[0]}</span>,
    }),
    columnHelper.accessor('status', {
      header: '状态', size: 60, minSize: 50, maxSize: 80,
      cell: info => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.display({
      id: 'actions', header: '操作', size: 140, minSize: 120, maxSize: 200,
      cell: info => {
        const order = info.row.original
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="morden"
              className="h-8 w-8 p-0"
              title="编辑"
              onClick={(e) => { e.stopPropagation(); handleEditClick(order) }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            {isAdmin && order.status === 'pending' && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-sm px-2"
                  onClick={() => handleApprove(order.id)}
                >
                  审批
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-sm px-2"
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
                className="h-7 text-sm px-2"
                onClick={() => handleConfirmArrival(order.id)}
              >
                确认到货
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [isAdmin, handleEditClick, handleApprove, handleReject, handleConfirmArrival])

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    onColumnSizingChange: setColumnSizing,
    manualSorting: true,
    onSortingChange: (updater) => {
      // 不再调用 table.resetExpanded()，保持展开全部状态
      setSorting(prev => {
        const newSorting = typeof updater === 'function' ? updater(prev) : updater
        sortingRef.current = newSorting
        return newSorting
      })
    },
    state: {
      sorting,
      columnSizing,
      globalFilter,
    },
    meta: {
      fuzzySearch,
      onEdit: handleEditClick,
    }
  })

  useEffect(() => { tableRef.current = table }, [table])

  // ============================================================================
  // 渲染
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">试剂订购</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 创建订单
          </Button>
          {isAdmin && (
            <Button variant="morden" size="lg" onClick={handleExport}>
              <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
            </Button>
          )}
        </div>
      </div>

      {/* 搜索区域 */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索试剂名称、CAS号..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 pr-8 text-base w-full inline-flex leading-none"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-between w-full sm:w-auto">
          <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={fuzzySearch}
              onCheckedChange={(checked) => {
                startTransition(() => {
                  // 不再调用 table.resetExpanded()，保持展开全部状态
                  setFuzzySearch(checked === true)
                })
              }}
            />
            <span className="text-base pr-2">模糊搜索</span>
          </label>
          <Select value={searchField} onValueChange={(val) => { setSearchField(val) }}>
            <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="name">名称</SelectItem>
              <SelectItem value="cas_number">CAS号</SelectItem>
              <SelectItem value="brand">品牌</SelectItem>
              <SelectItem value="category">分类</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val) }}>
            <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待审批</SelectItem>
              <SelectItem value="approved">已审批</SelectItem>
              <SelectItem value="arrived">已到货</SelectItem>
              <SelectItem value="stocked">已入库</SelectItem>
              <SelectItem value="rejected">已驳回</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 创建/编辑对话框 */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogState(null); form.reset(); setCasWarning(null) }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={getReagentOrderFormFields(dialogState === 'edit')}
            />
            {/* CAS 警告显示 */}
            {dialogState === 'add' && casWarning && casWarning.has_warning && (
              <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-950 rounded-md">
                <p className="text-sm text-orange-600 dark:text-orange-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  注意：{casWarning.pending_orders.orders_count} 个相关订单待处理 (共 {casWarning.pending_orders.total_quantity})
                </p>
              </div>
            )}
            {casLoading && dialogState === 'add' && (
              <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                检查CAS号...
              </p>
            )}
            <div className="flex justify-end gap-2 mt-8">
              <Button variant="morden" size="lg" type="button" onClick={() => setDialogState(null)}>
                取消
              </Button>
              <LoadingButton type="submit" size="lg" isLoading={isSubmitting}>
                {dialogState === 'edit' ? '保存' : '提交订单'}
              </LoadingButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FlaskConical className="w-5 h-5" />
            试剂订单列表 <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
            <Button variant="morden" size="lg" onClick={toggleExpandAll} className="ml-auto flex font-normal">
              {isAllExpanded ? <><ChevronsDownUp className="size-4 mr-1.5" />收起全部</> : <><ChevronsUpDown className="size-4 mr-1.5" />展开全部</>}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {globalFilter ? `未找到匹配"${globalFilter}"的记录` : '暂无订单'}
            </div>
          ) : (
            <div className="px-6">
              <DataTable
                table={table}
                renderExpandedRow={(item) => (
                  <div className="p-2 flex flex-col md:flex-row gap-4 border-b-1 border-border">
                    {/* 左侧：分子结构式 - 桌面端显示，移动端隐藏 */}
                    <div className="hidden md:block flex-shrink-0">
                      <MoleculeStructure casNumber={item.cas_number} width={120} height={80} />
                    </div>
                    {/* 右侧：信息网格 - 精简版 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 flex-1 m-2">
                      <div><span>英文名：</span>{item.english_name || '-'}</div>
                      <div><span>别名：</span>{item.alias || '-'}</div>
                      <div><span>品牌：</span>{item.brand || '-'}</div>
                      <div className="col-span-2 md:col-span-3"><span>备注：</span>{item.notes || '-'}</div>
                    </div>
                  </div>
                )}
                scrollHeight="calc(100vh - 112px - 16px)"
                enableExpandAll={true}
                expandAllStorageKey="reagent-orders-table-expand-all"
                noteField="notes"
                isAllExpanded={isAllExpanded}
                onToggleExpandAll={toggleExpandAll}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
                total={total}
                searchKeyword={globalFilter}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
