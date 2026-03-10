/**
 * 库存管理页面
 * 功能：库存列表展示、搜索筛选、手动入库、编辑、删除、借用、导出
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
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { QuantityIndicator } from '@/components/ui/QuantityIndicator'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { DataTable } from '@/components/ui/DataTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/lib/toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'

// 工具与API
import { inventoryAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import { InventoryFormSchema, parseSpecification } from '@/lib/validationSchemas'
import type { InventoryFormData } from '@/lib/validationSchemas'

// 图标
import {
  Search,
  Package,
  Loader2,
  ArrowUpFromLine,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'

// ============================================================================
// 类型扩展与定义
// ============================================================================

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean
    onEdit: (item: TData) => void
    onBorrowSuccess: () => void
  }
}

interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

interface InventoryItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number
  remaining_quantity: number
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
  borrower_id?: number | null
  borrower_name?: string | null
  last_borrower_id?: number | null
  last_borrower_name?: string | null
}

const columnHelper = createColumnHelper<InventoryItem>()

// ============================================================================
// 表单统一配置
// ============================================================================

const defaultInventoryValues = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  specification: '',
  category: '',
  brand: '',
  storage_location: '',
  is_hazardous: false,
  notes: '',
  quantity_bottles: 1,
  initial_quantity: 0,
  remaining_quantity: 0
}

const getInventoryFormFields = (isEdit: boolean, initialQuantity?: number) => {
  // 编辑模式下显示：剩余量 + 规格（只读）；添加模式下显示：瓶数 + 规格
  const quantityFields = isEdit && initialQuantity !== undefined
    ? [
        { name: 'remaining_quantity' as const, label: '剩余量', type: 'input' as const, required: true, placeholder: '如: 100' },
        { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
      ]
    : [
        { name: 'quantity_bottles' as const, label: '瓶数', type: 'input' as const, required: true, placeholder: '如: 1' },
        { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
      ]

  console.log('📋 表单字段配置:', { isEdit, initialQuantity, quantityFields })

  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇' },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: !isEdit, readOnly: isEdit, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'storage_location' as const, label: '存放位置', type: 'input' as const, placeholder: '如: A-1-1 柜' },
    ...quantityFields,
    { name: 'brand' as const, label: '品牌', type: 'input' as const, placeholder: '如: Sigma' },
    { name: 'category' as const, label: '分类', type: 'input' as const, placeholder: '如: 有机试剂' },
    {
      name: 'is_hazardous' as const,
      label: '危险品',
      type: 'checkbox' as const,
      checkboxLabel: (
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          危险品
        </span>
      )
    },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, placeholder: '其他说明...' },
  ]
}

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

export function InventoryPage() {
  // ---------------------------------------------------------------------------
  // 状态管理
  // ---------------------------------------------------------------------------
  const queryClient = useQueryClient()

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try { return JSON.parse(localStorage.getItem('inventory-table-col-sizes') || '{}') } catch { return {} }
  })
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(false)

  // 优化 1：使用节流/防抖降低 localStorage 写入频率
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('inventory-table-col-sizes', JSON.stringify(columnSizing))
    }, 500)
    return () => clearTimeout(timer)
  }, [columnSizing])

  const toggleExpandAll = useCallback(() => setIsAllExpanded(prev => !prev), [])

  const sortingRef = useRef<SortingState>([])

  // 优化 2：分离输入框状态与接口查询状态，防抖 300ms 避免网络请求风暴
  const [searchInput, setSearchInput] = useState('')
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)

  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  // ---------------------------------------------------------------------------
  // 数据查询 (API)
  // ---------------------------------------------------------------------------
  const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam?: number }) => {
    const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
    const sort = currentSorting[0]

    // [DEBUG] 诊断日志：记录排序发送时的状态
    console.log('[QUERY_DEBUG] statusFilter=', statusFilter, 'sorting=', sorting, 'sort=', sort)

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

    const response = await inventoryAPI.list(params as any)
    return response.data
  }, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])

  const {
    data: allData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['inventory', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // [DEBUG] 诊断日志：记录轮询时的页面状态
      console.log('[Inventory] refetch triggered, pages loaded:', allPages.length, 'total items:', lastPage.total)
      // 无限滚动：只要还有数据就继续加载
      const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
      if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
      return null
    },
    placeholderData: keepPreviousData,
    // refetchInterval: 10000, // [FIXME] 反模式：无限查询不应使用全局轮询，会导致请求爆炸
  })

  // 同步 searchInput 到 globalFilter 并防抖
  const tableRef = useRef<Table<InventoryItem> | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globalFilter !== searchInput) {
        // 不再调用 tableRef.current.resetExpanded()，保持展开全部状态
        setGlobalFilter(searchInput)
        // 筛选/搜索/排序时重置单行展开状态，但保持展开全部状态
        if (tableRef.current) {
          const wasAllExpanded = isAllExpanded
          tableRef.current.resetExpanded()
          if (wasAllExpanded) {
            tableRef.current.toggleAllRowsExpanded(true)
          }
        }
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, globalFilter, isAllExpanded])

  // 刷新库存数据
  const loadInventory = useCallback(async () => {
    // 使缓存失效，后端已清除服务器缓存，会获取最新数据
    await queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }, [queryClient])
  const data = useMemo(() => allData?.pages.flatMap(page => page.data) ?? [], [allData])
  const total = allData?.pages[0]?.total ?? 0

  const grandTotalRef = useRef(0)

  // 当无筛选条件时（状态为全部且无搜索词），更新总数
  const isNoFilter = !globalFilter && (!statusFilter || statusFilter === 'all')
  useEffect(() => {
    if (isNoFilter && total > 0) {
      grandTotalRef.current = total
    }
  }, [total, isNoFilter])

  // 判断是否有筛选条件（搜索或状态筛选）
  const hasFilter = globalFilter || (statusFilter && statusFilter !== 'all')
  // 有筛选条件时显示 "符合条件/总数"，无筛选条件时只显示总数
  const displayCount = hasFilter ? `${total}/${grandTotalRef.current}` : `${total}`

  // ---------------------------------------------------------------------------
  // 优化 3：表单实例合并 (DRY)
  // ---------------------------------------------------------------------------
  // 使用统一的表单验证规则（所有字段可选），在提交时根据模式做额外验证
  const form = useForm<InventoryFormData>({
    resolver: valibotResolver(InventoryFormSchema) as any,
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultInventoryValues)
    setDialogState('add')
  }, [form, setDialogState])

  const handleEditClick = useCallback((item: InventoryItem) => {
    setEditingItem(item)
    setDeleteConfirm(false)
    form.reset({
      name: item.name || '',
      cas_number: item.cas_number || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      specification: item.specification || '',
      category: item.category || '',
      brand: item.brand || '',
      storage_location: item.storage_location || '',
      quantity_bottles: 1,
      initial_quantity: item.initial_quantity,
      remaining_quantity: item.remaining_quantity,
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [setDialogState, form])

  const [isSubmitting, setIsSubmitting] = useState(false)

  // 表单提交处理 - 使用 Valibot Schema 自动验证
  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      console.log('✅ 表单验证通过，提交数据:', formData)

      // 编辑模式：验证剩余量（先转换为数字）
      if (dialogState === 'edit' && editingItem) {
        const remainingVal = formData.remaining_quantity
        const remaining = typeof remainingVal === 'number' ? remainingVal : parseFloat(String(remainingVal || '0'))
        
        // 根据用户填写的规格动态计算新的 initial_quantity
        let initial = editingItem.initial_quantity // 默认使用旧值
        if (formData.specification) {
          const specValue = parseSpecification(formData.specification)
          if (specValue !== null) {
            initial = specValue // 规格数值就是初始量
          }
        }
        
        if (isNaN(remaining)) {
          form.setError('remaining_quantity', { message: '剩余量必须是有效数字' })
          return
        }
        if (remaining > initial) {
          form.setError('remaining_quantity', { message: `剩余量不能超过初始量 (${initial})` })
          return
        }
      }

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          const status = formData.remaining_quantity === 0 ? 'consumed' : 'in_stock'
          await inventoryAPI.update(editingItem.id, {
            name: formData.name || undefined,
            english_name: formData.english_name || undefined,
            category: formData.category || undefined,
            storage_location: formData.storage_location || undefined,
            remaining_quantity: formData.remaining_quantity,
            brand: formData.brand || undefined,
            status: status,
            notes: formData.notes || undefined
          })
          // 刷新数据后再弹出 toast
          await loadInventory()
          toast.success('库存信息已更新')
        } else if (dialogState === 'add') {
          // 添加模式下，specification 和 quantity_bottles 必定存在（因为验证已通过）
          const spec = formData.specification as string
          const bottles = formData.quantity_bottles as number
          await inventoryAPI.manualAdd({
            cas_number: formData.cas_number,
            name: formData.name,
            english_name: formData.english_name || undefined,
            alias: formData.alias || undefined,
            specification: spec,
            quantity_bottles: bottles,
            brand: formData.brand || undefined,
            category: formData.category || undefined,
            storage_location: formData.storage_location || undefined,
            is_hazardous: formData.is_hazardous,
            notes: formData.notes || undefined
          })
        }
        // 先刷新数据，再弹出 toast，确保数据已加载完成
        await loadInventory()
        if (dialogState === 'add') {
          toast.success('手动入库成功！')
        }
        setDialogState(null)
      } catch (err) {
        const error = err as { response?: { data?: { detail?: string | ValidationError[] | unknown } } }
        const errorDetail = error.response?.data?.detail
        if (dialogState === 'add' && Array.isArray(errorDetail)) {
          errorDetail.forEach((e: ValidationError) => {
            if (e.loc && e.loc[1]) form.setError(e.loc[1] as keyof InventoryFormData, { message: e.msg || '验证错误' })
          })
        } else {
          toast.error(typeof errorDetail === 'string' ? errorDetail : '操作失败')
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    // 验证失败时的回调 - 仅在字段下方显示错误，不弹 toast
    (errors) => {
      console.log('❌ 表单验证失败:', errors)
    }
  )

  const handleDeleteClick = async () => {
    if (!editingItem) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
    } else {
      try {
        await inventoryAPI.delete(editingItem.id)
        setDialogState(null)
        // 刷新数据（等待刷新完成）
        await loadInventory()
        toast.success('库存已删除')
      } catch (error) {
        const err = error as { response?: { data?: { detail?: string } } }
        toast.error(err.response?.data?.detail || '删除失败')
      }
    }
  }

  const handleExport = useCallback(async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // ---------------------------------------------------------------------------
  // 表格列配置
  // ---------------------------------------------------------------------------
  const columns = useMemo(() => [
    columnHelper.accessor('cas_number', {
      header: 'CAS号', size: 120, minSize: 100, maxSize: 200,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={info.getValue() || ''}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('name', {
      header: '名称', size: 250, minSize: 200, maxSize: 500,
      cell: info => (
        <div className="flex items-center gap-1.5 break-all">
          <HazardousIcon isHazardous={info.row.original.is_hazardous} />
          <span>
            <HighlightText
              text={info.getValue() || ''}
              highlight={info.table.getState().globalFilter}
              fuzzy={info.table.options.meta?.fuzzySearch}
            />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('storage_location', {
      id: 'storage_location', header: '位置', size: 100, minSize: 80, maxSize: 150,
      sortDescFirst: false, sortingFn: 'text',
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={info.row.original.storage_location || '-'}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
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
    columnHelper.accessor('remaining_quantity', {
      id: 'remaining_percent', header: '剩余/规格', size: 120, minSize: 120, maxSize: 150,
      cell: info => (
        <QuantityIndicator
          remaining={info.getValue()}
          initial={info.row.original.initial_quantity}
          specification={info.row.original.specification}
        />
      ),
    }),
    columnHelper.accessor('status', {
      header: '状态', size: 80, minSize: 80, maxSize: 120,
      cell: info => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.display({
      id: 'actions', header: '操作', size: 120, minSize: 120, maxSize: 150,
      cell: info => {
        const meta = info.table.options.meta
        return (
          <ActionButtons
            item={info.row.original}
            onEdit={meta!.onEdit}
            onBorrowSuccess={meta!.onBorrowSuccess}
          />
        )
      },
    }),
  ], [])

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
      // 排序时重置单行展开状态，但保持展开全部状态
      if (tableRef.current) {
        // 先保存当前展开全部状态
        const wasAllExpanded = isAllExpanded
        // 重置所有展开状态
        tableRef.current.resetExpanded()
        // 恢复展开全部状态
        if (wasAllExpanded) {
          tableRef.current.toggleAllRowsExpanded(true)
        }
      }
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
      onBorrowSuccess: loadInventory,
    }
  })

  // 挂载 ref 以便在 useEffect 中重置展开状态
  useEffect(() => { tableRef.current = table }, [table])

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">库存管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动入库
          </Button>
          <Button variant="morden" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>

      {/* 搜索过滤区域 */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索名称、CAS号、位置..."
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
              <SelectItem value="storage_location">位置</SelectItem>
              <SelectItem value="brand">品牌</SelectItem>
              <SelectItem value="category">分类</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(val) => { 
            setStatusFilter(val)
            // 筛选时重置单行展开状态，但保持展开全部状态
            if (tableRef.current) {
              const wasAllExpanded = isAllExpanded
              tableRef.current.resetExpanded()
              if (wasAllExpanded) {
                tableRef.current.toggleAllRowsExpanded(true)
              }
            }
          }}>
            <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="in_stock">在库</SelectItem>
              <SelectItem value="not_in_stock">没有</SelectItem>
              <SelectItem value="borrowed">借出</SelectItem>
              <SelectItem value="consumed">已用完</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 统一复用弹窗（新增 & 编辑） */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogState(null); form.reset(); setDeleteConfirm(false) }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑库存' : '手动入库'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={getInventoryFormFields(dialogState === 'edit', editingItem?.initial_quantity)}
            />
            <div className="flex flex-wrap justify-between items-center gap-3 mt-8">
              {/* 仅在编辑模式且有项目时显示删除按钮 */}
              {dialogState === 'edit' && editingItem && (
                <div className="flex items-center gap-2 order-1">
                  <Button variant="destructive" size="lg" type="button" onClick={handleDeleteClick}>
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    {deleteConfirm ? '确认删除' : '删除'}
                  </Button>
                  {deleteConfirm && <span className="text-sm text-destructive">再次点击确认删除</span>}
                </div>
              )}
              <div className="flex gap-2 order-2 ml-auto">
                <Button variant="morden" size="lg" type="button" onClick={() => setDialogState(null)}>
                  取消
                </Button>
                <LoadingButton type="submit" size="lg" isLoading={isSubmitting}>
                  {dialogState === 'edit' ? '保存' : '确认入库'}
                </LoadingButton>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5" />
            库存列表 <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
            <Button variant="morden" size="lg" onClick={toggleExpandAll} className="ml-auto flex font-normal">
              {isAllExpanded ? <><ChevronsDownUp className="size-4 mr-1.5" />收起全部</> : <><ChevronsUpDown className="size-4 mr-1.5" />展开全部</>}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {globalFilter && statusFilter && statusFilter !== 'all'
                ? `"${globalFilter}"的"${statusFilter === 'in_stock' ? '在库' : statusFilter === 'not_in_stock' ? '没有' : statusFilter === 'borrowed' ? '借出' : '已用完'}"记录`
                : globalFilter
                  ? `未找到匹配"${globalFilter}"的记录`
                  : hasFilter
                    ? '未找到符合条件的记录'
                    : '暂无库存数据，请先入库'}
            </div>
          ) : (
            <div className="px-6">
              <DataTable
                table={table}
                renderExpandedRow={(item) => (
                  <div className="p-3 flex flex-col md:flex-row gap-4 border-b-1 border-border">
                    {/* 左侧：分子结构式 - 桌面端显示，移动端隐藏 */}
                    <div className="hidden md:block flex-shrink-0">
                      <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
                    </div>
                    {/* 右侧：信息网格 - 保持原有的 grid-cols-2 md:grid-cols-3 布局 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
                      <div><span>英文名称：</span>{item.english_name || '-'}</div>
                      <div><span>别名：</span>{item.alias || '-'}</div>
                      <div><span>入库时间：</span>{formatDate(item.created_at)}</div>
                      <div><span>入库用户：</span>{item.created_by_name || '-'}</div>
                      <div><span>上次借用：</span>{item.borrower_name ? `${item.borrower_name} (未归还)` : (item.last_borrower_name ? `${item.last_borrower_name} (已归还)` : '-')}</div>
                      <div><span>备注：</span>{item.notes || '-'}</div>
                    </div>
                  </div>
                )}
                scrollHeight="calc(100vh - 112px - 16px)"
                enableExpandAll={true}
                expandAllStorageKey="inventory-table-expand-all"
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

// ============================================================================
// 优化 4：表格操作按钮组件（通过 React.memo + custom isEqual 阻断多余渲染）
// ============================================================================

const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onBorrowSuccess
}: {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onBorrowSuccess: () => void
}) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLoading) return
    if (!isConfirming) {
      setIsConfirming(true)
    } else {
      setIsLoading(true)
      try {
        await inventoryAPI.borrow(item.id)
        // 先刷新数据，再弹出 toast
        await onBorrowSuccess()
        toast.success('借用成功')
      } catch (error) {
        const err = error as { response?: { status?: number; data?: { detail?: string } } }
        toast[err.response?.status === 409 ? 'warning' : 'error'](err.response?.data?.detail || '借用失败')
        setIsConfirming(false)
        setIsLoading(false)
      }
    }
  }

  const handleBlur = () => { if (isConfirming && !isLoading) setIsConfirming(false) }

  // 借用状态显示借用者信息（与借出状态标签颜色一致）
  if (item.status === 'borrowed') {
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <span className="text-blue-800 dark:text-blue-200" title={`借用者: ${item.borrower_name || '未知'}`}>
          {item.borrower_name ? `${item.borrower_name}借用` : '借用中'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="morden" size="sm" className="h-8 w-8 p-0" title="编辑" onClick={(e) => { e.stopPropagation(); setIsConfirming(false); onEdit(item) }}>
        <Pencil className="w-3.5 h-3.5" />
      </Button>

      {item.status === 'in_stock' && (
        <LoadingButton
          size="sm"
          className={cn(
            "h-8 text-sm/4 px-3 border-0",
            isConfirming
              ? isLoading
                ? "text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none"
              : "bg-primary hover:bg-primary/80"
          )}
          onClick={handleClick}
          onBlur={handleBlur}
          isLoading={isLoading}
        >
          {isConfirming ? '确认' : '借用'}
        </LoadingButton>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // 只在 ID、状态或借用者变化时重新渲染这个单元格的操作区域，避免全表 Diff
  return prevProps.item.id === nextProps.item.id &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.borrower_name === nextProps.item.borrower_name
})