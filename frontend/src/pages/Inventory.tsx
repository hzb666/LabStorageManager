import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState, ColumnSizingState } from '@tanstack/react-table'
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
import { useIsMobile } from '@/hooks/useMobile'

// 后端验证错误类型
interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

// API 参数类型
interface InventoryListParams {
  skip?: number
  limit?: number
  search?: string
  search_field?: string
  fuzzy?: boolean
  status_filter?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
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

// Status styles - 使用 StatusBadge 组件

// 状态标签映射 - 使用 StatusBadge 组件中的 STATUS_LABELS

// Highlight component for search results - optimized with memo and regex caching
// 修复：模糊搜索时也正确高亮匹配的内容
// 支持HTML特殊空格字符: &nbsp;(\u00A0), &ensp;(\u2002), &emsp;(\u2003), &thinsp;(\u2009), &zwnj;(\u200C), &zwj;(\u200D)
const HighlightText = React.memo(function HighlightText({ text, highlight, fuzzy }: { text: string; highlight: string; fuzzy?: boolean }) {
  // 早期返回前先创建正则表达式（避免 React Hook 规则违反）
  const regex = React.useMemo(() => new RegExp(`(${highlight})`, 'gi'), [highlight])

  if (!highlight || !text) return <>{text}</>

  // 如果模糊搜索，先检查标准化后是否匹配
  if (fuzzy) {
    // 标准化：移除所有空格类字符、连字符、下划线
    const normalizedHighlight = highlight
      .replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D]+/g, '')  // 移除所有空格字符
      .replace(/-/g, '')
      .replace(/_/g, '')
    const normalizedText = text
      .replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D]+/g, '')  // 移除所有空格字符
      .replace(/-/g, '')
      .replace(/_/g, '')

    if (normalizedText.toLowerCase().includes(normalizedHighlight.toLowerCase())) {
      // 标准化后匹配成功，高亮整个文本
      return <span className="bg-yellow-200 dark:bg-yellow-800/50">{text}</span>
    }
    return <>{text}</>
  }

  // 普通搜索：直接高亮
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

// Action buttons component - defined outside to avoid recreation
// 优化：状态移至组件内部管理，避免父组件重渲染导致的不必要更新
const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onBorrowSuccess
}: {
  item: InventoryItem
  onEdit: () => void
  onBorrowSuccess: () => void
}) {
  // 内部管理确认状态
  const [isConfirming, setIsConfirming] = useState(false)
  // 内部管理loading状态
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (isLoading) return // 防止重复点击

    if (!isConfirming) {
      // 第一次点击 - 进入确认状态
      setIsConfirming(true)
    } else {
      // 第二次点击 - 执行借用
      setIsLoading(true)
      try {
        await inventoryAPI.borrow(item.id)
        toast.success('借用成功')
        setIsConfirming(false)
        onBorrowSuccess() // 借用成功后刷新列表
      } catch (error) {
        const err = error as { response?: { data?: { detail?: string } } }
        toast.error(err.response?.data?.detail || '借用失败')
        setIsConfirming(false)
      } finally {
        setIsLoading(false)
      }
    }
  }

  // 失去焦点时取消确认状态
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
          setIsConfirming(false) // 点击编辑时取消确认状态
          onEdit()
        }}
      >
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      {item.status === 'in_stock' && (
        <Button
          size="sm"
          className={cn(
            "h-8 text-sm/4 px-3",
            isConfirming
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/70 dark:hover:bg-destructive/80"
              : "bg-primary hover:bg-primary/80 border-0",
            isLoading && "opacity-50 cursor-wait"
          )}
          onClick={handleClick}
          onBlur={handleBlur}
          disabled={isLoading}
        >
          {isLoading ? '借用中' : (isConfirming ? '确认' : '借用')}
        </Button>
      )}
    </div>
  )
})

export function InventoryPage() {
  const [data, setData] = useState<InventoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0) // 库存总数（不搜索时的总数）
  const [loading, setLoading] = useState(true)
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
  // 展开/收起状态管理 - 提升到父组件
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('inventory-table-expand-all')
      return saved === 'expanded'
    } catch {
      return false
    }
  })
  // 展开/收起状态持久化到 localStorage
  useEffect(() => {
    localStorage.setItem('inventory-table-expand-all', isAllExpanded ? 'expanded' : 'collapsed')
  }, [isAllExpanded])
  // 展开/收起切换函数
  const toggleExpandAll = useCallback(() => {
    setIsAllExpanded(prev => !prev)
  }, [])
  // 表格容器高度 - 使用 CSS calc 计算
  // 公式: 100vh - 112px (页眉+表头+间距) - 16px (页面 padding-bottom)
  const tableHeight = "calc(100vh - 112px - 16px)"

  // Dialog state - 使用 useDialogState 管理 edit/add 对话框
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()

  // Edit modal state
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  const [editFormData, setEditFormData] = useState({
    name: '',
    english_name: '',
    alias: '',
    specification: '',
    category: '',
    storage_location: '',
    cas_number: '',
    remaining_quantity: 0,
    initial_quantity: 0,
    unit: 'ml',
    brand: '',
    status: '',
    is_hazardous: false,
    notes: ''
  })
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({})

  // Optimized edit form handlers using useCallback
  const handleEditNameChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, name: value }))
  }, [])

  const handleEditEnglishNameChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, english_name: value }))
  }, [])

  const handleEditAliasChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, alias: value }))
  }, [])

  const handleEditSpecificationChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, specification: value }))
  }, [])

  const handleEditCategoryChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, category: value }))
  }, [])

  const handleEditLocationChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, storage_location: value }))
  }, [])

  const handleEditRemainingQuantityChange = useCallback((value: number) => {
    setEditFormData(prev => ({ ...prev, remaining_quantity: value }))
  }, [])

  const handleEditBrandChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, brand: value }))
  }, [])

  const handleEditHazardousChange = useCallback((checked: boolean) => {
    setEditFormData(prev => ({ ...prev, is_hazardous: checked }))
  }, [])

  const handleEditNotesChange = useCallback((value: string) => {
    setEditFormData(prev => ({ ...prev, notes: value }))
  }, [])

  // Manual add modal
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    cas_number: '',
    name: '',
    english_name: '',
    alias: '',
    specification: '',
    quantity_bottles: 1,
    brand: '',
    category: '',
    storage_location: '',
    is_hazardous: false,
    notes: ''
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // 手动入库对话框关闭处理函数 - 关闭时清空表单数据和错误
  const handleManualAddModalClose = (open: boolean) => {
    setDialogState(open ? 'add' : null)
    if (!open) {
      // 关闭时清空表单数据和错误
      setFormErrors({})
      setFormData({
        cas_number: '',
        name: '',
        english_name: '',
        alias: '',
        specification: '',
        quantity_bottles: 1,
        brand: '',
        category: '',
        storage_location: '',
        is_hazardous: false,
        notes: ''
      })
    }
  }

  // 收起所有展开的行的辅助函数 - 如果是展开全部状态则不收起
  const collapseAllRowsRef = useRef<() => void>(() => {})

  // Debounced search for API calls - separate display filter from API filter
  // 优化：增加防抖延迟 + 添加请求版本号防止竞态条件
  const [displayFilter, setDisplayFilter] = useState('')
  const [apiFilter, setApiFilter] = useState('')
  const [searchField, setSearchField] = useState('all') // 搜索字段
  const [fuzzySearch, setFuzzySearch] = useState(false) // 模糊搜索
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestVersionRef = useRef(0) // 请求版本号，用于防止竞态条件
  const sortingRef = useRef<SortingState>([]) // 跟踪排序状态，避免被覆盖

  // Update display filter immediately (for highlighting), but API filter only after debounce
  useEffect(() => {
    setDisplayFilter(globalFilter)

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // 增加当前请求版本号
    const currentVersion = ++requestVersionRef.current

    // 300ms 防抖延迟
    debounceTimerRef.current = setTimeout(() => {
      // 只有当前版本是最新的才发送请求
      if (currentVersion === requestVersionRef.current) {
        setApiFilter(globalFilter)
      }
    }, 300)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [globalFilter])

  // Wrap loadInventory with useCallback to fix dependency warning
  // 使用请求版本号确保只处理最新请求的响应
  const loadInventory = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    console.log('[LOAD] loadInventory called, sorting:', JSON.stringify(sorting))

    // 只在没有数据时显示加载状态，有数据时保持旧数据可见
    if (data.length === 0) {
      setLoading(true)
    }
    try {
      const params: InventoryListParams = {
        // 不使用分页，获取全部数据
      }
      if (statusFilter !== 'all') params.status_filter = statusFilter
      if (apiFilter) {
        params.search = apiFilter
        if (searchField !== 'all') params.search_field = searchField
        if (fuzzySearch) params.fuzzy = true
      }
      // 添加排序参数
      if (sorting.length > 0) {
        params.sort_by = sorting[0].id
        params.sort_order = sorting[0].desc ? 'desc' : 'asc'
        console.log('[SORT DEBUG] Frontend sending:', params.sort_by, params.sort_order, 'full sorting state:', JSON.stringify(sorting))
      }

      const response = await inventoryAPI.list(params)

      // 检查是否为最新请求，防止旧请求覆盖新数据
      if (requestVersion !== requestVersionRef.current) {
        return
      }

      const result = response.data
      setData(result.data || [])
      setTotal(result.total || 0)

      // 同步排序状态到 ref
      sortingRef.current = sorting

      // 如果没有搜索条件且状态为全部，更新库存总数
      if (!apiFilter && statusFilter === 'all') {
        setGrandTotal(result.total || 0)
      }
    } catch (error) {
      console.error('Failed to load inventory:', error)
    } finally {
      // 只有最新请求才更新loading状态
      if (requestVersion === requestVersionRef.current) {
        setLoading(false)
      }
    }
  }, [statusFilter, apiFilter, searchField, fuzzySearch, sorting])

  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  // 列宽持久化到 localStorage
  useEffect(() => {
    localStorage.setItem('inventory-table-col-sizes', JSON.stringify(columnSizing))
  }, [columnSizing])

  // 删除分页相关计算
  // const totalPages = Math.ceil(total / pageSize)

  const handleStatusFilterChange = (value: string) => {
    // 筛选时收起所有展开的行
    collapseAllRowsRef.current()
    setStatusFilter(value)
    // 删除分页重置
  }

  // 编辑表单验证函数 - 使用 inputValidation.ts
  const validateEditForm = useCallback((): boolean => {
    const errors: Record<string, string> = {}

    // 名称验证：必填
    const nameValidation = validateRequired(editFormData.name, '名称')
    if (!nameValidation.isValid) {
      errors.name = nameValidation.error || '名称不能为空'
    }

    // 规格验证：必填 + 格式
    const specValidation = validateRequired(editFormData.specification, '规格')
    if (!specValidation.isValid) {
      errors.specification = specValidation.error || '规格不能为空'
    } else {
      const specFormatValidation = validateSpecification(editFormData.specification)
      if (!specFormatValidation.isValid) {
        errors.specification = specFormatValidation.error || '规格格式无效'
      }
    }

    // 剩余量验证：非负数
    const remainingValidation = validateNonNegativeNumber(editFormData.remaining_quantity, '剩余量')
    if (!remainingValidation.isValid) {
      errors.remaining_quantity = remainingValidation.error || '剩余量不能为负数'
    } else if (editFormData.remaining_quantity > editFormData.initial_quantity) {
      // 额外检查：不能超过初始量
      errors.remaining_quantity = '剩余量不能超过初始量'
    }

    setEditFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [editFormData])

  const handleEditSave = async () => {
    if (!editingItem) return

    // 使用验证函数验证表单
    if (!validateEditForm()) return

    try {
      // 如果剩余量为0，自动设置状态为用完
      const status = editFormData.remaining_quantity === 0 ? 'consumed' :
        (editFormData.remaining_quantity < editFormData.initial_quantity ? 'in_stock' : 'in_stock')

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
      // 第一次点击，进入确认状态
      setDeleteConfirm(true)
    } else {
      // 第二次点击，执行删除
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

  // Memoized edit handler - defined before columns
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
  }, [])
  const isMobile = useIsMobile()
  // Use displayFilter for highlighting, but only update table after API returns
  const columns = useMemo(() => [
    // CAS号 - 放最前面
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: isMobile ? 100 : 150,
      minSize: 100,
      maxSize: 200,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 名称（之前是中文名）
    columnHelper.accessor('name', {
      header: '名称',
      size: isMobile ? 150 : 300,
      minSize: 150,
      maxSize: 400,
      cell: info => (
        <div className="flex items-center gap-1.5 break-all">
          <HazardousIcon isHazardous={info.row.original.is_hazardous} />
          <span>
            <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
          </span>
        </div>
      ),
    }),
    // 分类
    columnHelper.accessor('category', {
      header: '分类',
      size: 120,
      minSize: 100,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 库存位置
    columnHelper.accessor('storage_location', {
      id: 'storage_location',
      header: '位置',
      size: 120,
      minSize: 100,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.row.original.storage_location || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 品牌
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 120,
      minSize: 100,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 剩余量/规格（合并显示）
    columnHelper.accessor('remaining_quantity', {
      id: 'remaining_percent', // 后端支持按百分比排序
      header: '剩余/规格',
      size: 140,
      minSize: 100,
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

    // 状态
    columnHelper.accessor('status', {
      header: '状态',
      size: 100,
      minSize: 100,
      cell: info => {
        const status = info.getValue()
        return <StatusBadge status={status} />
      },
    }),
    // 操作
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      minSize: 100,
      cell: info => {
        const item = info.row.original
        return (
          <ActionButtons
            item={item}
            onEdit={() => handleEditClick(item)}
            onBorrowSuccess={() => loadInventory()}
          />
        )
      },
    }),
  ], [displayFilter, handleEditClick, loadInventory])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    // 禁用客户端排序 - 完全由服务端控制
    getSortedRowModel: undefined,
    // 列宽拖拽配置
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    onColumnSizingChange: setColumnSizing,
    // 服务端排序配置
    manualSorting: true,
    onSortingChange: (updater) => {
      // 点击排序时收起所有展开的行
      collapseAllRowsRef.current()

      // 使用 useRef 来跟踪上一次的排序状态
      const currentSorting = sortingRef.current

      setSorting(prev => {
        let newSorting = typeof updater === 'function' ? updater(prev) : updater

        // 如果 incoming 是空数组（取消排序），检查当前是否正在排序这个列
        if (newSorting.length === 0 && currentSorting.length > 0) {
          const lastSort = currentSorting[0]
          // 如果当前是升序，点击应该变为降序
          if (!lastSort.desc) {
            newSorting = [{ id: lastSort.id, desc: true }]
          }
          // 如果当前是降序，才允许取消
        }

        const prevStr = JSON.stringify(prev)
        const newStr = JSON.stringify(newSorting)
        if (prevStr !== newStr) {
          console.log('[SORT DEBUG] onSortingChange:', newStr, '| prev:', prevStr)
        }

        // 更新 ref
        sortingRef.current = newSorting
        return newSorting
      })
      // sorting 变化时会自动触发 useEffect 调用 loadInventory
    },
    state: {
      sorting,
      columnSizing,
    },
  })

  // 设置 collapseAllRowsRef 的实现 - 如果是展开全部状态则不收起
  collapseAllRowsRef.current = () => {
    // 如果当前是展开全部状态，不收起
    if (isAllExpanded) return
    
    table.getRowModel().rows.forEach(row => {
      if (row.getIsExpanded()) {
        row.toggleExpanded(false)
      }
    })
  }

  // 手动入库表单验证函数 - 使用 inputValidation.ts
  const validateManualAddForm = useCallback((): boolean => {
    const errors: Record<string, string> = {}

    // CAS号验证：必填 + 格式 + 校验码
    const casValidation = validateCASNumber(formData.cas_number)
    if (!casValidation.isValid) {
      errors.cas_number = casValidation.error || 'CAS号格式无效'
    }

    // 名称验证：必填
    const nameValidation = validateRequired(formData.name, '试剂名称')
    if (!nameValidation.isValid) {
      errors.name = nameValidation.error || '试剂名称不能为空'
    }

    // 规格验证：必填 + 格式
    const specValidation = validateRequired(formData.specification, '规格')
    if (!specValidation.isValid) {
      errors.specification = specValidation.error || '规格不能为空'
    } else {
      const specFormatValidation = validateSpecification(formData.specification)
      if (!specFormatValidation.isValid) {
        errors.specification = specFormatValidation.error || '规格格式无效'
      }
    }

    // 瓶数验证：正数
    const quantityValidation = validatePositiveNumber(formData.quantity_bottles, '瓶数')
    if (!quantityValidation.isValid) {
      errors.quantity_bottles = quantityValidation.error || '瓶数必须大于0'
    }

    // 注意：storage_location 已改为非必填

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  // Optimized form field handlers using useCallback
  const handleCasNumberChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, cas_number: value }))
  }, [])

  const handleNameChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, name: value }))
  }, [])

  const handleEnglishNameChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, english_name: value }))
  }, [])

  const handleAliasChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, alias: value }))
  }, [])

  const handleSpecificationChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, specification: value }))
  }, [])

  const handleQuantityBottlesChange = useCallback((value: number) => {
    setFormData(prev => ({ ...prev, quantity_bottles: value }))
  }, [])

  const handleBrandChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, brand: value }))
  }, [])

  const handleCategoryChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, category: value }))
  }, [])

  const handleLocationChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, storage_location: value }))
  }, [])

  const handleHazardousChange = useCallback((checked: boolean) => {
    setFormData(prev => ({ ...prev, is_hazardous: checked }))
  }, [])

  const handleNotesChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, notes: value }))
  }, [])

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
        // 如果是数组格式的错误信息（FastAPI 默认格式）
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
          // 如果是字符串格式，尝试解析字段名
          const fieldMatch = errorDetail.match(/([a-z_]+):/i)
          if (fieldMatch) {
            const field = fieldMatch[1].toLowerCase()
            setFormErrors({ [field]: errorDetail })
            return
          }
        }
      }
      // 如果无法解析，显示 toast
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
              // 搜索时收起所有展开的行
              collapseAllRowsRef.current()
              setGlobalFilter(e.target.value)
            }}
            className="pl-9 pr-8 text-base w-full inline-flex leading-none"
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
        {/* 搜索字段选择器和状态过滤器与模糊搜索开关横向排列 */}
        <div className="flex flex-wrap gap-2 items-center justify-between w-full sm:w-auto">
          {/* 模糊搜索开关 */}
          <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
            <Checkbox
              checked={fuzzySearch}
              onCheckedChange={(checked: boolean | string) => {
                // 使用 startTransition 标记非紧急更新，避免阻塞 UI
                startTransition(() => {
                  setFuzzySearch(checked === true)
                })
              }}
            />
            <span className="text-base pr-2">模糊搜索</span>
          </label>
          {/* 搜索字段选择器 */}
          <Select
            value={searchField}
            onValueChange={(value) => {
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

      {/* Edit Modal */}
      <Dialog open={dialogState === 'edit'} onOpenChange={handleEditModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl pb-4">编辑库存</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* 第一行：名称（占2列）、CAS号（1列） */}
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
            {/* 不可编辑输入框样式 */}
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

            {/* 第二行：英文名称（占2列）、别名（1列） */}
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

            {/* 第三行：位置（1列）、剩余量（1列）、规格（1列） */}
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

            {/* 第四行：品牌、分类、危险品 */}
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

            {/* 备注 */}
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

      {/* Manual Add Modal */}
      <Dialog open={dialogState === 'add'} onOpenChange={handleManualAddModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动入库</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualAdd}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 第一行：试剂名称（占2列）、CAS号（1列） */}
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

              {/* 第二行：英文名称（占2列）、别名（1列） */}
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

              {/* 第三行：位置（1列）、规格（1列）、瓶数（1列） */}
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

              {/* 第四行：品牌、分类、危险品选择 */}
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

              {/* 备注保持不变 */}
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
            库存列表 <span className="text-muted-foreground font-normal">(&thinsp;{globalFilter ? `${total}/${grandTotal}` : `${grandTotal}`}&thinsp;)</span>
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
          {/* 有数据时在角落显示加载指示器 */}
          {loading && data.length > 0 && (
            <div className="flex justify-end mb-2">
              <div className="flex items-center gap-2 text-base text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>加载中...</span>
              </div>
            </div>
          )}
          {loading && data.length === 0 ? (
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
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

