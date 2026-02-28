import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState, ColumnSizingState } from '@tanstack/react-table'
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { inventoryAPI } from '@/api/client'
import { toast } from '@/components/ui/Toast'
import { DataTable } from '@/components/ui/DataTable'
import { formatDate, cn } from '@/lib/utils'
import { validateCASNumber, validateRequired, validateSpecification, validatePositiveNumber, validateNonNegativeNumber } from '@/lib/inputValidation'
import useDialogState from '@/hooks/useDialogState'
import {
  Search,
  Package,
  AlertTriangle,
  Loader2,
  ArrowUpFromLine,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  X,
  Pencil,
  Trash2,
} from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { QuantityIndicator } from '@/components/ui/QuantityIndicator'
import { LoadingButton } from '@/components/ui/LoadingButton' // 确保路径正确

// 后端验证错误类型
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

const HighlightText = React.memo(function HighlightText({ text, highlight, fuzzy }: { text: string; highlight: string; fuzzy?: boolean }) {
  const regex = React.useMemo(() => new RegExp(`(${highlight})`, 'gi'), [highlight])

  if (!highlight || !text) return <>{text}</>

  if (fuzzy) {
    const normalizedHighlight = highlight
      .replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D]+/g, '')
      .replace(/-/g, '')
      .replace(/_/g, '')
    const normalizedText = text
      .replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D]+/g, '')
      .replace(/-/g, '')
      .replace(/_/g, '')

    if (normalizedText.toLowerCase().includes(normalizedHighlight.toLowerCase())) {
      return <span className="bg-yellow-200 dark:bg-yellow-800/50">{text}</span>
    }
    return <>{text}</>
  }

  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 dark:bg-yellow-800/50">{part}</span>
        ) : (
          part
        )
      )}
    </>
  )
})

const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onBorrowSuccess
}: {
  item: InventoryItem
  onEdit: (item: InventoryItem) => void
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

        // ✅ 成功分支：
        // 1. 先触发父组件更新数据 (确保它开始 loading 或 fetch)
        // 2. 不要在这里写 setIsConfirming(false)
        // 3. 让按钮保持在 Loading 状态，直到父组件把这一行 item 删掉
        onBorrowSuccess()

        toast.success('借用成功')

      } catch (error) {
        // ❌ 失败分支：
        // 只有失败了，我们才需要把按钮变回“借用”或者保持“确认”让用户重试
        const err = error as { response?: { status?: number; data?: { detail?: string } } }
        // 409 冲突使用 warning 样式，其他错误使用 error 样式
        if (err.response?.status === 409) {
          toast.warning(err.response?.data?.detail || '该物品已被他人借用，请刷新后重试')
        } else {
          toast.error(err.response?.data?.detail || '借用失败')
        }

        // 如果你希望失败后用户能重新点击，这里可以设为 false
        setIsConfirming(false)

        // 只有在失败时才关闭 Loading，因为成功时我们要让它一直 Load 到消失
        setIsLoading(false)
      }
      // 注意：去掉了 finally 里的 setIsLoading(false)
      // 这样成功时按钮会一直转圈直到消失，不会闪烁
    }
  }

  const handleBlur = () => {
    if (isConfirming && !isLoading) {
      setIsConfirming(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="morden"
        size="sm"
        className="h-8 w-8 p-0"
        title="编辑"
        onClick={(e) => {
          e.stopPropagation()
          setIsConfirming(false)
          onEdit(item)
        }}
      >
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      {item.status === 'in_stock' && (
        <LoadingButton
          size="sm"
          className={cn(
            "h-8 text-sm/4 px-3 border-0",
            isConfirming
              ? isLoading
                ? "text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none" // 保持红色 Hover 色
                : "bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none"
              : "bg-primary hover:bg-primary/80"
          )}
          onClick={handleClick}
          onBlur={handleBlur}
          isLoading={isLoading}
        // 💡 不传 loadingText，或者传 loadingText=""
        >
          {isConfirming ? '确认' : '借用'}
        </LoadingButton>
      )}
    </div>
  )
})

export function InventoryPage() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const saved = localStorage.getItem('inventory-table-col-sizes')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('inventory-table-expand-all')
      return saved === 'expanded'
    } catch {
      return false
    }
  })

  useEffect(() => {
    localStorage.setItem('inventory-table-expand-all', isAllExpanded ? 'expanded' : 'collapsed')
  }, [isAllExpanded])

  const toggleExpandAll = useCallback(() => {
    setIsAllExpanded(prev => !prev)
  }, [])

  const tableHeight = "calc(100vh - 112px - 16px)"

  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)
  const sortingRef = useRef<SortingState>([])

  // 【核心改造】：查询函数采用基于 skip / limit 的物理偏移逻辑
  const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam: number }) => {
    const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
    const sort = currentSorting[0]

    // 构建传递给后端的参数
    const params: Record<string, unknown> = {
      skip: pageParam, // <--- 传递偏移量
      limit: 50,       // 每次固定拉取 50 条
    }

    if (statusFilter !== 'all') {
      params.status_filter = statusFilter
    }
    if (globalFilter) {
      params.search = globalFilter
      if (searchField !== 'all') {
        params.search_field = searchField
      }
      if (fuzzySearch) {
        params.fuzzy = true
      }
    }
    if (sort) {
      params.sort_by = sort.id
      params.sort_order = sort.desc ? 'desc' : 'asc'
    }

    const response = await inventoryAPI.list(params as any)
    // 返回格式需要包含 data 数组和 total 总数
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
    // 【核心改造】：初始偏移量为 0
    initialPageParam: 0,
    // 【核心改造】：智能计算下一次的 offset 偏移量
    getNextPageParam: (lastPage, allPages) => {
      // 计算目前所有页面累加起来的数据总条数
      const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0);

      // 如果当前已加载的数量小于后端返回的真实总数 total，说明还有下一页
      if (currentLoadedCount < (lastPage.total || 0)) {
        return currentLoadedCount; // 返回的值将作为下一次请求的 pageParam (即 skip)
      }

      return null; // 返回 null 表示没有更多数据了
    },
    placeholderData: keepPreviousData,
    // 【轮询配置】：10秒自动刷新所有已加载的页
    refetchInterval: 10000,
    refetchPage: (page, index) => index >= 0,
  })

  const loadInventory = useCallback(() => {
    refetch()
  }, [refetch])

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

  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  const [editFormData, setEditFormData] = useState({
    name: '', english_name: '', alias: '', specification: '', category: '',
    storage_location: '', cas_number: '', remaining_quantity: 0, initial_quantity: 0,
    unit: 'ml', brand: '', status: '', is_hazardous: false, notes: ''
  })
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({})

  const handleEditNameChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, name: value })), [])
  const handleEditEnglishNameChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, english_name: value })), [])
  const handleEditAliasChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, alias: value })), [])
  const handleEditSpecificationChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, specification: value })), [])
  const handleEditCategoryChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, category: value })), [])
  const handleEditLocationChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, storage_location: value })), [])
  const handleEditRemainingQuantityChange = useCallback((value: number) => setEditFormData(prev => ({ ...prev, remaining_quantity: value })), [])
  const handleEditBrandChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, brand: value })), [])
  const handleEditHazardousChange = useCallback((checked: boolean) => setEditFormData(prev => ({ ...prev, is_hazardous: checked })), [])
  const handleEditNotesChange = useCallback((value: string) => setEditFormData(prev => ({ ...prev, notes: value })), [])

  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    cas_number: '', name: '', english_name: '', alias: '', specification: '',
    quantity_bottles: 1, brand: '', category: '', storage_location: '', is_hazardous: false, notes: ''
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const handleManualAddModalClose = (open: boolean) => {
    setDialogState(open ? 'add' : null)
    if (!open) {
      setFormErrors({})
      setFormData({
        cas_number: '', name: '', english_name: '', alias: '', specification: '',
        quantity_bottles: 1, brand: '', category: '', storage_location: '', is_hazardous: false, notes: ''
      })
    }
  }

  const collapseAllRowsRef = useRef<() => void>(() => { })
  const [displayFilter, setDisplayFilter] = useState('')

  useEffect(() => {
    setDisplayFilter(globalFilter)
  }, [globalFilter])

  useEffect(() => {
    localStorage.setItem('inventory-table-col-sizes', JSON.stringify(columnSizing))
  }, [columnSizing])

  const handleStatusFilterChange = (value: string) => {
    collapseAllRowsRef.current()
    setStatusFilter(value)
  }

  const validateEditForm = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    const nameValidation = validateRequired(editFormData.name, '名称')
    if (!nameValidation.isValid) errors.name = nameValidation.error || '名称不能为空'

    const specValidation = validateRequired(editFormData.specification, '规格')
    if (!specValidation.isValid) {
      errors.specification = specValidation.error || '规格不能为空'
    } else {
      const specFormatValidation = validateSpecification(editFormData.specification)
      if (!specFormatValidation.isValid) errors.specification = specFormatValidation.error || '规格格式无效'
    }

    const remainingValidation = validateNonNegativeNumber(editFormData.remaining_quantity, '剩余量')
    if (!remainingValidation.isValid) {
      errors.remaining_quantity = remainingValidation.error || '剩余量不能为负数'
    } else if (editFormData.remaining_quantity > editFormData.initial_quantity) {
      errors.remaining_quantity = '剩余量不能超过初始量'
    }

    setEditFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [editFormData])

  const handleEditSave = async () => {
    if (!editingItem) return
    if (!validateEditForm()) return

    try {
      const status = editFormData.remaining_quantity === 0 ? 'consumed' : 'in_stock'
      await inventoryAPI.update(editingItem.id, {
        name: editFormData.name || undefined,
        english_name: editFormData.english_name || undefined,
        category: editFormData.category || undefined,
        storage_location: editFormData.storage_location || undefined,
        remaining_quantity: editFormData.remaining_quantity,
        brand: editFormData.brand || undefined,
        status: status,
        notes: editFormData.notes || undefined
      })
      setDialogState(null)
      setEditFormErrors({})
      loadInventory()
      toast.success('库存信息已更新')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '更新失败')
    }
  }

  const handleDeleteClick = async () => {
    if (!editingItem) return

    if (!deleteConfirm) {
      setDeleteConfirm(true)
    } else {
      try {
        await inventoryAPI.delete(editingItem.id)
        setDialogState(null)
        setDeleteConfirm(false)
        loadInventory()
        toast.success('库存已删除')
      } catch (error) {
        const err = error as { response?: { data?: { detail?: string } } }
        toast.error(err.response?.data?.detail || '删除失败')
      }
    }
  }

  const handleEditModalClose = (open: boolean) => {
    setDialogState(open ? 'edit' : null)
    if (!open) {
      setDeleteConfirm(false)
      setEditFormErrors({})
    }
  }

  const handleEditClick = useCallback((item: InventoryItem) => {
    setEditingItem(item)
    setDeleteConfirm(false)
    setEditFormErrors({})
    setEditFormData({
      name: item.name || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      specification: item.specification || '',
      category: item.category || '',
      storage_location: item.storage_location || '',
      cas_number: item.cas_number || '',
      remaining_quantity: item.remaining_quantity,
      initial_quantity: item.initial_quantity,
      unit: item.unit || 'ml',
      brand: item.brand || '',
      status: item.status || '',
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [setDialogState])

  const columns = useMemo(() => [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
      minSize: 100,
      maxSize: 200,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 250,
      minSize: 200,
      maxSize: 500,
      cell: info => (
        <div className="flex items-center gap-1.5 break-all">
          <HazardousIcon isHazardous={info.row.original.is_hazardous} />
          <span>
            <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('category', {
      header: '分类',
      size: 100,
      minSize: 80,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    columnHelper.accessor('storage_location', {
      id: 'storage_location',
      header: '位置',
      size: 100,
      minSize: 80,
      maxSize: 150,
      sortDescFirst: false,
      sortingFn: 'text',
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.row.original.storage_location || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 100,
      minSize: 80,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    columnHelper.accessor('remaining_quantity', {
      id: 'remaining_percent',
      header: '剩余/规格',
      size: 140,
      minSize: 120,
      maxSize: 200,
      cell: info => {
        const remaining = info.getValue()
        const initial = info.row.original.initial_quantity
        const unit = info.row.original.unit
        return (
          <QuantityIndicator
            remaining={remaining}
            initial={initial}
            unit={unit}
          />
        )
      },
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      minSize: 80,
      maxSize: 120,
      cell: info => {
        const status = info.getValue()
        return <StatusBadge status={status} />
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      minSize: 100,
      maxSize: 150,
      cell: info => {
        const item = info.row.original
        return (
          <ActionButtons
            item={item}
            onEdit={handleEditClick}
            onBorrowSuccess={loadInventory}
          />
        )
      },
    }),
  ], [displayFilter, handleEditClick, loadInventory, fuzzySearch])

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getSortedRowModel: undefined,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    onColumnSizingChange: setColumnSizing,
    manualSorting: true,
    onSortingChange: (updater) => {
      collapseAllRowsRef.current()
      setSorting(prev => {
        const newSorting = typeof updater === 'function' ? updater(prev) : updater
        sortingRef.current = newSorting
        return newSorting
      })
    },
    state: {
      sorting,
      columnSizing,
    },
  })

  collapseAllRowsRef.current = () => {
    setIsAllExpanded(false)
    table.resetExpanded()
  }

  const validateManualAddForm = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    const casValidation = validateCASNumber(formData.cas_number)
    if (!casValidation.isValid) errors.cas_number = casValidation.error || 'CAS号格式无效'

    const nameValidation = validateRequired(formData.name, '试剂名称')
    if (!nameValidation.isValid) errors.name = nameValidation.error || '试剂名称不能为空'

    const specValidation = validateRequired(formData.specification, '规格')
    if (!specValidation.isValid) {
      errors.specification = specValidation.error || '规格不能为空'
    } else {
      const specFormatValidation = validateSpecification(formData.specification)
      if (!specFormatValidation.isValid) errors.specification = specFormatValidation.error || '规格格式无效'
    }

    const quantityValidation = validatePositiveNumber(formData.quantity_bottles, '瓶数')
    if (!quantityValidation.isValid) errors.quantity_bottles = quantityValidation.error || '瓶数必须大于0'

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  const handleCasNumberChange = useCallback((value: string) => setFormData(prev => ({ ...prev, cas_number: value })), [])
  const handleNameChange = useCallback((value: string) => setFormData(prev => ({ ...prev, name: value })), [])
  const handleEnglishNameChange = useCallback((value: string) => setFormData(prev => ({ ...prev, english_name: value })), [])
  const handleAliasChange = useCallback((value: string) => setFormData(prev => ({ ...prev, alias: value })), [])
  const handleSpecificationChange = useCallback((value: string) => setFormData(prev => ({ ...prev, specification: value })), [])
  const handleQuantityBottlesChange = useCallback((value: number) => setFormData(prev => ({ ...prev, quantity_bottles: value })), [])
  const handleBrandChange = useCallback((value: string) => setFormData(prev => ({ ...prev, brand: value })), [])
  const handleCategoryChange = useCallback((value: string) => setFormData(prev => ({ ...prev, category: value })), [])
  const handleLocationChange = useCallback((value: string) => setFormData(prev => ({ ...prev, storage_location: value })), [])
  const handleHazardousChange = useCallback((checked: boolean) => setFormData(prev => ({ ...prev, is_hazardous: checked })), [])
  const handleNotesChange = useCallback((value: string) => setFormData(prev => ({ ...prev, notes: value })), [])

  const handleManualAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateManualAddForm()) return

    setSubmitting(true)
    try {
      await inventoryAPI.manualAdd({
        cas_number: formData.cas_number,
        name: formData.name,
        english_name: formData.english_name || undefined,
        alias: formData.alias || undefined,
        specification: formData.specification,
        quantity_bottles: formData.quantity_bottles,
        brand: formData.brand || undefined,
        category: formData.category || undefined,
        storage_location: formData.storage_location || undefined,
        is_hazardous: formData.is_hazardous,
        notes: formData.notes || undefined
      })
      handleManualAddModalClose(false)
      loadInventory()
      toast.success('手动入库成功！')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string | ValidationError[] | unknown } } }
      const errorDetail = err.response?.data?.detail
      if (errorDetail) {
        if (Array.isArray(errorDetail)) {
          const newErrors: Record<string, string> = {}
          errorDetail.forEach((err: ValidationError) => {
            if (err.loc && err.loc[1]) {
              const field = err.loc[1] as string
              newErrors[field] = err.msg || '验证错误'
            }
          })
          if (Object.keys(newErrors).length > 0) {
            setFormErrors(newErrors)
            return
          }
        } else if (typeof errorDetail === 'string') {
          const fieldMatch = errorDetail.match(/([a-z_]+):/i)
          if (fieldMatch) {
            const field = fieldMatch[1].toLowerCase()
            setFormErrors({ [field]: errorDetail })
            return
          }
        }
      }
      toast.error(String(err.response?.data?.detail) || '入库失败')
    } finally {
      setSubmitting(false)
    }
  }, [formData, validateManualAddForm, loadInventory])

  const handleExport = useCallback(async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      const csvData = response.data

      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || '导出失败')
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">库存管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialogState('add')} size="lg">
            <Plus className="w-4 h-4 mr-1.5" />
            手动入库
          </Button>
          <Button variant="morden" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" />
            导出
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索名称、CAS号、位置..."
            value={globalFilter}
            onChange={(e) => {
              collapseAllRowsRef.current()
              setGlobalFilter(e.target.value)
            }}
            className="pl-9 pr-8 text-base w-full inline-flex leading-none"
          />
          {globalFilter && (
            <button
              onClick={() => {
                collapseAllRowsRef.current()
                setGlobalFilter('')
              }}
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
              onCheckedChange={(checked: boolean | string) => {
                startTransition(() => {
                  collapseAllRowsRef.current()
                  setFuzzySearch(checked === true)
                })
              }}
            />
            <span className="text-base pr-2">模糊搜索</span>
          </label>
          <Select
            value={searchField}
            onValueChange={(value) => {
              collapseAllRowsRef.current()
              setSearchField(value)
            }}
          >
            <SelectTrigger className="w-30 min-h-10">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="name">名称</SelectItem>
              <SelectItem value="cas_number">CAS号</SelectItem>
              <SelectItem value="storage_location">位置</SelectItem>
              <SelectItem value="brand">品牌</SelectItem>
              <SelectItem value="category">分类</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => handleStatusFilterChange(value)}
          >
            <SelectTrigger className="w-30 min-h-10">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="in_stock">在库</SelectItem>
              <SelectItem value="borrowed">借出</SelectItem>
              <SelectItem value="consumed">已用完</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Edit Modal (保持不变) */}
      <Dialog open={dialogState === 'edit'} onOpenChange={handleEditModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl pb-4">编辑库存</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="col-span-1 sm:col-span-2">
              <Label htmlFor="edit_name" className={LABEL_STYLES.base}>
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit_name"
                value={editFormData.name}
                onChange={(e) => handleEditNameChange(e.target.value)}
                className={cn(INPUT_STYLES.lg, editFormErrors.name && 'border-destructive')}
                placeholder="如: 乙醇"
              />
              {editFormErrors.name && (
                <p className="text-sm text-destructive mt-1">{editFormErrors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="edit_cas" className={LABEL_STYLES.base}>
                CAS号（不可编辑）
              </Label>
              <Input
                id="edit_cas"
                value={editFormData.cas_number}
                readOnly
                className={cn(INPUT_STYLES.lg, "bg-accent dark:bg-input/50 border-0 dark:border-0")}
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <Label htmlFor="edit_english_name" className={LABEL_STYLES.base}>英文名称</Label>
              <Input
                id="edit_english_name"
                value={editFormData.english_name || ''}
                onChange={(e) => handleEditEnglishNameChange(e.target.value)}
                className={INPUT_STYLES.lg}
                placeholder="如: Ethanol"
              />
            </div>
            <div>
              <Label htmlFor="edit_alias" className={LABEL_STYLES.base}>别名</Label>
              <Input
                id="edit_alias"
                value={editFormData.alias || ''}
                onChange={(e) => handleEditAliasChange(e.target.value)}
                className={INPUT_STYLES.lg}
                placeholder="如: 酒精"
              />
            </div>

            <div>
              <Label htmlFor="edit_storage_location" className={LABEL_STYLES.base}>库存位置</Label>
              <Input
                id="edit_storage_location"
                value={editFormData.storage_location || ''}
                onChange={(e) => handleEditLocationChange(e.target.value)}
                className={INPUT_STYLES.lg}
                placeholder="如: A-1-1 柜"
              />
            </div>
            <div>
              <Label htmlFor="edit_remaining" className={LABEL_STYLES.base}>
                剩余量 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit_remaining"
                type="number"
                value={editFormData.remaining_quantity}
                onChange={(e) => handleEditRemainingQuantityChange(parseFloat(e.target.value) || 0)}
                className={cn(INPUT_STYLES.lg, editFormErrors.remaining_quantity && 'border-destructive')}
              />
              {editFormErrors.remaining_quantity && (
                <p className="text-sm text-destructive mt-1">{editFormErrors.remaining_quantity}</p>
              )}
            </div>
            <div>
              <Label htmlFor="edit_spec" className={LABEL_STYLES.base}>
                规格 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit_spec"
                value={editFormData.specification || ''}
                onChange={(e) => handleEditSpecificationChange(e.target.value)}
                className={cn(INPUT_STYLES.lg, editFormErrors.specification && 'border-destructive')}
                placeholder="如: 500ml"
              />
              {editFormErrors.specification && (
                <p className="text-sm text-destructive mt-1">{editFormErrors.specification}</p>
              )}
            </div>

            <div>
              <Label htmlFor="edit_brand" className={LABEL_STYLES.base}>品牌</Label>
              <Input
                id="edit_brand"
                value={editFormData.brand || ''}
                onChange={(e) => handleEditBrandChange(e.target.value)}
                className={INPUT_STYLES.lg}
                placeholder="如: Sigma"
              />
            </div>
            <div>
              <Label htmlFor="edit_category" className={LABEL_STYLES.base}>分类</Label>
              <Input
                id="edit_category"
                value={editFormData.category || ''}
                onChange={(e) => handleEditCategoryChange(e.target.value)}
                className={INPUT_STYLES.lg}
                placeholder="如: 有机试剂"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit_is_hazardous"
                checked={editFormData.is_hazardous}
                onCheckedChange={(checked) => handleEditHazardousChange(checked === true)}
              />
              <Label htmlFor="edit_is_hazardous" className="flex items-center gap-1 cursor-pointer mb-0 text-base">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                危险品
              </Label>
            </div>

            <div className="col-span-1 sm:col-span-3">
              <Label htmlFor="edit_notes" className={LABEL_STYLES.base}>备注</Label>
              <Input
                id="edit_notes"
                value={editFormData.notes || ''}
                onChange={(e) => handleEditNotesChange(e.target.value)}
                className={cn("w-full", INPUT_STYLES.lg)}
                placeholder="其他说明..."
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-10">
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="lg" onClick={handleDeleteClick}>
                <Trash2 className="w-4 h-4 mr-1.5" />
                {deleteConfirm ? '确认删除' : '删除'}
              </Button>
              {deleteConfirm && (
                <span className="text-sm text-destructive">再次点击确认删除</span>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="morden" size="lg" onClick={() => setDialogState(null)}>
                取消
              </Button>
              <Button onClick={handleEditSave} size="lg">
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Add Modal (保持不变) */}
      <Dialog open={dialogState === 'add'} onOpenChange={handleManualAddModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动入库</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualAdd}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="col-span-1 sm:col-span-2">
                <Label htmlFor="add_name" className={LABEL_STYLES.base}>
                  试剂名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="add_name"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="如: 乙醇"
                  className={cn(INPUT_STYLES.lg, formErrors.name && 'border-destructive')}
                />
                {formErrors.name && (
                  <p className="text-sm text-destructive mt-1">{formErrors.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="add_cas" className={LABEL_STYLES.base}>
                  CAS号 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="add_cas"
                  value={formData.cas_number}
                  onChange={(e) => handleCasNumberChange(e.target.value)}
                  placeholder="如: 64-17-5"
                  className={cn(INPUT_STYLES.lg, formErrors.cas_number && 'border-destructive')}
                />
                {formErrors.cas_number && (
                  <p className="text-sm text-destructive mt-1">{formErrors.cas_number}</p>
                )}
              </div>

              <div className="col-span-1 sm:col-span-2">
                <Label htmlFor="add_english_name" className={LABEL_STYLES.base}>
                  英文名称
                </Label>
                <Input
                  id="add_english_name"
                  value={formData.english_name || ''}
                  onChange={(e) => handleEnglishNameChange(e.target.value)}
                  placeholder="如: Ethanol"
                  className={INPUT_STYLES.lg}
                />
              </div>

              <div>
                <Label htmlFor="add_alias" className={LABEL_STYLES.base}>别名</Label>
                <Input
                  id="add_alias"
                  value={formData.alias}
                  onChange={(e) => handleAliasChange(e.target.value)}
                  placeholder="如: 酒精"
                  className={INPUT_STYLES.lg}
                />
              </div>

              <div>
                <Label htmlFor="add_storage_location" className={LABEL_STYLES.base}>存放位置</Label>
                <Input
                  id="add_storage_location"
                  value={formData.storage_location}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  placeholder="如: A-1-1 柜"
                  className={INPUT_STYLES.lg}
                />
              </div>

              <div>
                <Label htmlFor="add_spec" className={LABEL_STYLES.base}>
                  规格 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="add_spec"
                  value={formData.specification}
                  onChange={(e) => handleSpecificationChange(e.target.value)}
                  placeholder="如: 500ml, 1L"
                  className={cn(INPUT_STYLES.lg, formErrors.specification && 'border-destructive')}
                />
                {formErrors.specification && (
                  <p className="text-sm text-destructive mt-1">{formErrors.specification}</p>
                )}
              </div>

              <div>
                <Label htmlFor="add_quantity" className={LABEL_STYLES.base}>
                  瓶数 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="add_quantity"
                  type="number"
                  min="1"
                  value={formData.quantity_bottles}
                  onChange={(e) => handleQuantityBottlesChange(parseInt(e.target.value) || 1)}
                  className={cn(INPUT_STYLES.lg, formErrors.quantity_bottles && 'border-destructive')}
                />
                {formErrors.quantity_bottles && (
                  <p className="text-sm text-destructive mt-1">{formErrors.quantity_bottles}</p>
                )}
              </div>

              <div>
                <Label htmlFor="add_brand" className={LABEL_STYLES.base}>品牌</Label>
                <Input
                  id="add_brand"
                  value={formData.brand}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  placeholder="如: Sigma"
                  className={cn(INPUT_STYLES.lg, "text-base")}
                />
              </div>

              <div>
                <Label htmlFor="add_category" className={LABEL_STYLES.base}>分类</Label>
                <Input
                  id="add_category"
                  value={formData.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  placeholder="如: 有机试剂"
                  className={INPUT_STYLES.lg}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_hazardous"
                  checked={formData.is_hazardous}
                  onCheckedChange={(checked) => handleHazardousChange(checked === true)}
                />
                <Label htmlFor="is_hazardous" className="flex items-center gap-1 cursor-pointer mb-0 text-base">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </Label>
              </div>

              <div className="col-span-1 sm:col-span-3">
                <Label htmlFor="add_notes" className={LABEL_STYLES.base}>备注</Label>
                <Input
                  id="add_notes"
                  value={formData.notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  className={cn("w-full", INPUT_STYLES.lg)}
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-10">
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="morden"
                  size="lg"
                  onClick={() => handleManualAddModalClose(false)}
                >
                  取消
                </Button>
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? '入库中...' : '确认入库'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5" />
            库存列表 <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
            <Button
              variant="morden"
              size="lg"
              onClick={toggleExpandAll}
              className="ml-auto flex font-normal"
            >
              {isAllExpanded ? (
                <>
                  <ChevronsDownUp className="size-4 mr-1.5" />
                  收起全部
                </>
              ) : (
                <>
                  <ChevronsUpDown className="size-4 mr-1.5" />
                  展开全部
                </>
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length > 0 && (
            <div className="flex justify-end mb-2">
              <div className="flex items-center gap-2 text-base text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>加载中...</span>
              </div>
            </div>
          )}
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无库存数据
            </div>
          ) : (
            <>
              <div className="px-6">
                <DataTable
                  table={table}
                  renderExpandedRow={(item) => (
                    <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 border-b-1 border-border ">
                      <div>
                        <span className="font-medium">英文名称：</span>
                        {item.english_name || '-'}
                      </div>
                      <div>
                        <span className="font-medium">别名：</span>
                        {item.alias || '-'}
                      </div>
                      <div>
                        <span className="font-medium">入库时间：</span>
                        {formatDate(item.created_at)}
                      </div>
                      <div>
                        <span className="font-medium">入库用户：</span>
                        {item.created_by_name || '-'}
                      </div>
                      <div>
                        <span className="font-medium">上次借用：</span>
                        {item.borrower_name
                          ? `${item.borrower_name} (未归还)`
                          : (item.last_borrower_name ? `${item.last_borrower_name} (已归还)` : '-')}
                      </div>
                      <div>
                        <span className="font-medium">备注：</span>
                        {item.notes || '-'}
                      </div>
                    </div>
                  )}
                  scrollHeight={tableHeight}
                  enableExpandAll={true}
                  expandAllStorageKey="inventory-table-expand-all"
                  noteField="notes"
                  isAllExpanded={isAllExpanded}
                  onToggleExpandAll={toggleExpandAll}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                  total={total}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}