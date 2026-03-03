/**
 * 耗材订单页面
 * 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、完成
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
import { StatusBadge } from '@/components/ui/StatusBadge'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { DataTable } from '@/components/ui/DataTable'
import { toast } from '@/components/ui/Toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'

// 工具与API
import { consumableOrderAPI } from '@/api/client'
import { formatDate } from '@/lib/utils'
import { ConsumableOrderSchema } from '@/lib/validationSchemas'
import type { ConsumableOrderFormData } from '@/lib/validationSchemas'
import {
  getConsumableOrderFormFields,
  defaultConsumableOrderValues
} from '@/lib/formConfigs'

// 图标
import {
  Search,
  Loader2,
  X,
  Plus,
  Pencil,
  ShoppingCart,
  ArrowUpFromLine,
  ChevronsDownUp,
  ChevronsUpDown,
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

interface ConsumableOrder {
  id: number
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  specification: string
  unit: string | null
  quantity: number
  price: number | null
  image_path: string | null
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
  status: string
  created_at: string
  updated_at: string
}

const columnHelper = createColumnHelper<ConsumableOrder>()

// ============================================================================
// 辅助组件
// ============================================================================

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

// ============================================================================
// 主组件
// ============================================================================

export function ConsumableOrdersPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'admin'

  // 表格状态
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('consumable-orders-table-col-sizes') || '{}')
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

  // 优化：使用节流/防抖降低 localStorage 写入频率
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('consumable-orders-table-col-sizes', JSON.stringify(columnSizing))
    }, 500)
    return () => clearTimeout(timer)
  }, [columnSizing])

  const toggleExpandAll = useCallback(() => setIsAllExpanded(prev => !prev), [])

  const sortingRef = useRef<SortingState>([])

  // 优化：分离输入框状态与接口查询状态，防抖 300ms 避免网络请求风暴
  const [searchInput, setSearchInput] = useState('')
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)

  // Dialog 状态
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [editingItem, setEditingItem] = useState<ConsumableOrder | null>(null)

  const tableRef = useRef<Table<ConsumableOrder> | null>(null)

  // 同步 searchInput 到 globalFilter 并防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globalFilter !== searchInput) {
        setGlobalFilter(searchInput)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, globalFilter])

  // 数据查询 (API)
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

    const response = await consumableOrderAPI.list(params as any)
    return response.data
  }, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])

  // 不限制最大页数，支持无限滚动

  const {
    data: allData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['consumable-orders', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // 无限滚动：只要还有数据就继续加载
      const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
      if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
      return null
    },
    placeholderData: keepPreviousData,
    // refetchInterval: 10000, // [FIXME] 反模式：无限查询不应使用全局轮询
  })

  const data = useMemo(() => allData?.pages.flatMap(page => page.data) ?? [], [allData])
  const total = allData?.pages[0]?.total ?? 0

  const [grandTotal, setGrandTotal] = useState(0)
  const grandTotalRef = useRef(0)

  useEffect(() => {
    if (!globalFilter && total > 0) {
      grandTotalRef.current = total
      setGrandTotal(total)
    }
  }, [total, globalFilter])

  const displayCount = globalFilter ? `${total}/${grandTotalRef.current}` : `${grandTotal}`

  // 表单实例
  const form = useForm<ConsumableOrderFormData>({
    resolver: valibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  // 加载数据
  const loadOrders = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['consumable-orders'] })
  }, [queryClient])

  // 点击添加按钮
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    form.reset(defaultConsumableOrderValues)
    setDialogState('add')
  }, [form, setDialogState])

  // 点击编辑按钮
  const handleEditClick = useCallback((item: ConsumableOrder) => {
    setEditingItem(item)
    form.reset({
      name: item.name || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      category: item.category || '',
      brand: item.brand || '',
      specification: item.specification || '',
      unit: item.unit || '',
      quantity: item.quantity || 1,
      price: item.price || undefined,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [form, setDialogState])

  const [isSubmitting, setIsSubmitting] = useState(false)

  // 表单提交
  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      console.log('✅ 耗材订单表单验证通过:', formData)

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          await consumableOrderAPI.update(editingItem.id, {
            name: formData.name,
            english_name: formData.english_name || undefined,
            alias: formData.alias || undefined,
            category: formData.category || undefined,
            brand: formData.brand || undefined,
            specification: formData.specification || undefined,
            unit: formData.unit || undefined,
            quantity: formData.quantity,
            price: formData.price,
            notes: formData.notes || undefined
          })
        } else if (dialogState === 'add') {
          await consumableOrderAPI.create({
            name: formData.name,
            specification: formData.specification,
            unit: formData.unit || undefined,
            quantity: formData.quantity,
            category: formData.category || undefined,
            brand: formData.brand || undefined,
            price: formData.price ? parseFloat(String(formData.price)) : undefined,
            notes: formData.notes || undefined,
          })
        }
        // 先刷新数据，再弹出 toast，确保数据已加载完成
        await loadOrders()
        if (dialogState === 'edit') {
          toast.success('订单信息已更新')
        } else if (dialogState === 'add') {
          toast.success('耗材订单创建成功')
        }
        setDialogState(null)
      } catch (err) {
        const error = err as { response?: { data?: { detail?: string | ValidationError[] | unknown } } }
        const errorDetail = error.response?.data?.detail
        if (dialogState === 'add' && Array.isArray(errorDetail)) {
          errorDetail.forEach((e: ValidationError) => {
            if (e.loc && e.loc[1]) form.setError(e.loc[1] as keyof ConsumableOrderFormData, { message: e.msg || '验证错误' })
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
      await consumableOrderAPI.approve(id)
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
      await consumableOrderAPI.reject(id, '管理员驳回')
      // 先刷新数据，再弹出 toast
      await loadOrders()
      toast.success('已驳回')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '操作失败')
    }
  }, [loadOrders])

  // 确认完成
  const handleComplete = useCallback(async (id: number) => {
    try {
      await consumableOrderAPI.complete(id)
      // 先刷新数据，再弹出 toast
      await loadOrders()
      toast.success('耗材订单已完成')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '操作失败')
    }
  }, [loadOrders])

  // 导出功能
  const handleExport = useCallback(async () => {
    try {
      const response = await consumableOrderAPI.exportOrders()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `consumable_orders_export_${new Date().toISOString().slice(0, 10)}.csv`
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
    columnHelper.accessor('name', {
      header: '名称', size: 180, minSize: 150, maxSize: 300,
      cell: info => (
        <div className="flex items-center gap-1.5">
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
    columnHelper.accessor('category', {
      header: '分类', size: 100, minSize: 80, maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={info.getValue() || '-'}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('brand', {
      header: '品牌', size: 100, minSize: 80, maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={info.getValue() || '-'}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('specification', {
      header: '规格', size: 100, minSize: 80, maxSize: 150,
      cell: info => <span className="break-all">{info.getValue()}</span>,
    }),
    columnHelper.accessor('quantity', {
      header: '数量', size: 60, minSize: 50, maxSize: 100,
      cell: info => <span>×{info.getValue()}</span>,
    }),
    columnHelper.accessor('price', {
      header: '价格', size: 80, minSize: 60, maxSize: 120,
      cell: info => info.getValue() ? `¥${info.getValue()}` : '-',
    }),
    columnHelper.accessor('applicant_name', {
      header: '申请人', size: 80, minSize: 60, maxSize: 120,
      cell: info => info.getValue() || '-',
    }),
    columnHelper.accessor('status', {
      header: '状态', size: 80, minSize: 60, maxSize: 120,
      cell: info => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.display({
      id: 'actions', header: '操作', size: 160, minSize: 120, maxSize: 200,
      cell: info => {
        const order = info.row.original
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="morden"
              size="sm"
              className="h-7 w-8 p-0"
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
                onClick={() => handleComplete(order.id)}
              >
                确认完成
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [isAdmin, handleEditClick, handleApprove, handleReject, handleComplete])

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
        <h1 className="text-3xl font-bold text-primary">耗材订购</h1>
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

      {/* 搜索过滤区域 */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索名称、分类、品牌..."
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
              <SelectItem value="category">分类</SelectItem>
              <SelectItem value="brand">品牌</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val) }}>
            <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待审批</SelectItem>
              <SelectItem value="approved">已审批</SelectItem>
              <SelectItem value="rejected">已驳回</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 创建/编辑对话框 */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogState(null); form.reset() }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={getConsumableOrderFormFields(dialogState === 'edit')}
            />
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
            <ShoppingCart className="w-5 h-5" />
            耗材订单列表 <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
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
                  <div className="p-3 flex flex-col md:flex-row gap-4 border-b-1 border-border">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 flex-1">
                      <div><span className="font-medium">英文名称：</span>{item.english_name || '-'}</div>
                      <div><span className="font-medium">别名：</span>{item.alias || '-'}</div>
                      <div><span className="font-medium">品牌：</span>{item.brand || '-'}</div>
                      <div><span className="font-medium">单位：</span>{item.unit || '-'}</div>
                      <div><span className="font-medium">申购时间：</span>{formatDate(item.created_at)}</div>
                      <div><span className="font-medium">申请人：</span>{item.applicant_name || '-'}</div>
                      <div className="col-span-2"><span className="font-medium">备注：</span>{item.notes || '-'}</div>
                    </div>
                  </div>
                )}
                scrollHeight="calc(100vh - 112px - 16px)"
                enableExpandAll={true}
                expandAllStorageKey="consumable-orders-table-expand-all"
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
