import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { SortingState, ColumnFiltersState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useNavigate } from 'react-router-dom'
import { inventoryAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { Pagination, PaginationInfo } from '@/components/ui/pagination'
import { formatDate, cn } from '@/lib/utils'
import {
  Search,
  Package,
  AlertTriangle,
  Loader2,
  ArrowUpFromLine,
  Import,
  Plus,
  X,
  Pencil,
  Trash2
} from 'lucide-react'

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
}

interface InventoryItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  location: string | null
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

// Status styles - extracted as constants to avoid recreation
const STATUS_STYLES: Record<string, string> = {
  in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  borrowed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  consumed: 'bg-muted text-muted-foreground',
}

const STATUS_LABELS: Record<string, string> = {
  in_stock: '在库',
  borrowed: '借用',
  consumed: '用完',
}

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
      return <span className="bg-yellow-200">{text}</span>
    }
    return <>{text}</>
  }
  
  // 普通搜索：直接高亮
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200">{part}</span>
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
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0"
        title="编辑"
        onClick={(e) => {
          e.stopPropagation()
          setIsConfirming(false) // 点击编辑时取消确认状态
          onEdit()
        }}
      >
        <Pencil className="w-3 h-3" />
      </Button>
      {item.status === 'in_stock' && (
        <Button
          size="sm"
          className={cn(
            "h-7 text-xs px-2",
            isConfirming 
              ? "bg-red-600 hover:bg-red-700" 
              : "bg-blue-600 hover:bg-blue-700",
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
  const navigate = useNavigate()
  const [data, setData] = useState<InventoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0) // 库存总数（不搜索时的总数）
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  // Expanded row state - use object for faster lookups
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

  // Toggle row expansion
  const toggleRowExpansion = (id: number) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }
  const [editFormData, setEditFormData] = useState({
    name: '',
    english_name: '',
    alias: '',
    specification: '',
    category: '',
    location: '',
    cas_number: '',
    remaining_quantity: 0,
    initial_quantity: 0,
    unit: 'ml',
    brand: '',
    status: '',
    is_hazardous: false,
    notes: ''
  })

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
    setEditFormData(prev => ({ ...prev, location: value }))
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
  const [showManualAdd, setShowManualAdd] = useState(false)
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
    location: '',
    is_hazardous: false,
    notes: ''
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // 手动入库对话框关闭处理函数 - 关闭时清空表单数据和错误
  const handleManualAddModalClose = (open: boolean) => {
    setShowManualAdd(open)
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
        location: '',
        is_hazardous: false,
        notes: ''
      })
    }
  }

  // Debounced search for API calls - separate display filter from API filter
  // 优化：增加防抖延迟 + 添加请求版本号防止竞态条件
  const [displayFilter, setDisplayFilter] = useState('')
  const [apiFilter, setApiFilter] = useState('')
  const [searchField, setSearchField] = useState('all') // 搜索字段
  const [fuzzySearch, setFuzzySearch] = useState(false) // 模糊搜索
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestVersionRef = useRef(0) // 请求版本号，用于防止竞态条件

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
        setPage(1) // Reset to page 1 on search
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
    
    // 只在没有数据时显示加载状态，有数据时保持旧数据可见
    if (data.length === 0) {
      setLoading(true)
    }
    // Clear expanded rows when loading new data
    setExpandedRows({})
    try {
      const params: InventoryListParams = {
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }
      if (statusFilter !== 'all') params.status_filter = statusFilter
      if (apiFilter) {
        params.search = apiFilter
        if (searchField !== 'all') params.search_field = searchField
        if (fuzzySearch) params.fuzzy = true
      }

      const response = await inventoryAPI.list(params)
      
      // 检查是否为最新请求，防止旧请求覆盖新数据
      if (requestVersion !== requestVersionRef.current) {
        console.log('Request canceled:', requestVersion, 'current:', requestVersionRef.current)
        return
      }
      
      const result = response.data
      setData(result.data || [])
      setTotal(result.total || 0)
      
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
  }, [page, pageSize, statusFilter, apiFilter, searchField, fuzzySearch, data.length])

  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  const totalPages = Math.ceil(total / pageSize)

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setPage(1)
  }

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  const handleEditSave = async () => {
    if (!editingItem) return
    try {
      // 如果剩余量为0，自动设置状态为用完
      const status = editFormData.remaining_quantity === 0 ? 'consumed' : 
                     (editFormData.remaining_quantity < editFormData.initial_quantity ? 'in_stock' : 'in_stock')
      
      await inventoryAPI.update(editingItem.id, {
        name: editFormData.name || undefined,
        english_name: editFormData.english_name || undefined,
        category: editFormData.category || undefined,
        location: editFormData.location || undefined,
        remaining_quantity: editFormData.remaining_quantity,
        brand: editFormData.brand || undefined,
        status: status,
        notes: editFormData.notes || undefined
      })
      setShowEditModal(false)
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
        setShowEditModal(false)
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
    setShowEditModal(open)
    if (!open) {
      setDeleteConfirm(false)
    }
  }

  // Memoized edit handler - defined before columns
  const handleEditClick = useCallback((item: InventoryItem) => {
    setEditingItem(item)
    setDeleteConfirm(false)
    setEditFormData({
      name: item.name || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      specification: item.specification || '',
      category: item.category || '',
      location: item.location || '',
      cas_number: item.cas_number || '',
      remaining_quantity: item.remaining_quantity,
      initial_quantity: item.initial_quantity,
      unit: item.unit || 'ml',
      brand: item.brand || '',
      status: item.status || '',
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setShowEditModal(true)
  }, [])

  // Use displayFilter for highlighting, but only update table after API returns
  const columns = useMemo(() => [
    // CAS号 - 放最前面
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 100,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 名称（之前是中文名）
    columnHelper.accessor('name', {
      header: '名称',
      size: 160,
      cell: info => (
        <div className="flex items-center gap-1 break-all">
          {info.row.original.is_hazardous && (
            <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0" />
          )}
          <span>
            <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
          </span>
        </div>
      ),
    }),
    // 分类
    columnHelper.accessor('category', {
      header: '分类',
      size: 60,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 库存位置
    columnHelper.accessor('location', {
      header: '位置',
      size: 70,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 剩余量/规格（合并显示）
    columnHelper.accessor('remaining_quantity', {
      header: '剩余量/规格',
      size: 100,
      cell: info => {
        const remaining = info.getValue()
        const initial = info.row.original.initial_quantity
        const unit = info.row.original.unit
        const percentage = initial > 0 ? (remaining / initial) * 100 : 0
        return (
          <div className="break-all">
            <span className={cn(
              percentage < 20 && 'text-red-600 font-medium'
            )}>
              {remaining}/{initial} {unit}
            </span>
            {percentage < 20 && (
              <div className="w-14 h-1 bg-destructive/20 rounded mt-0.5">
                <div
                  className="h-full bg-destructive rounded"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            )}
          </div>
        )
      },
    }),
    // 品牌
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 50,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={displayFilter} fuzzy={fuzzySearch} />
        </span>
      ),
    }),
    // 状态
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      cell: info => {
        const status = info.getValue()
        return (
          <span className={cn(
            'px-2 py-0.5 text-xs rounded-full font-medium whitespace-nowrap',
            STATUS_STYLES[status] || 'bg-muted'
          )}>
            {STATUS_LABELS[status] || status}
          </span>
        )
      },
    }),
    // 操作
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 80,
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
  ], [displayFilter, fuzzySearch, handleEditClick, loadInventory])

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // 移除 getFilteredRowModel - 搜索在服务器端完成，不需要客户端过滤
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
    },
  })

  // Memoized validation function
  const validateManualAddForm = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    if (!formData.cas_number.trim()) errors.cas_number = 'CAS号不能为空'
    if (!/^\d{2,7}-\d{2}-\d$/.test(formData.cas_number)) {
      errors.cas_number = 'CAS号格式无效 (如: 64-17-5)'
    }
    if (!formData.name.trim()) errors.name = '名称不能为空'
    if (!formData.location.trim()) errors.location = '位置不能为空'
    if (!formData.specification.trim()) errors.specification = '规格不能为空'
    if (formData.quantity_bottles < 1) errors.quantity_bottles = '瓶数必须大于0'
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
    setFormData(prev => ({ ...prev, location: value }))
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
        location: formData.location || undefined,
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
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold title-placeholder">库存管理</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowManualAdd(true)}>
            <Plus className="w-4 h-4 mr-2" />
            手动入库
          </Button>
          <Button variant="outline" onClick={() => navigate('/import')}>
            <Import className="w-4 h-4 mr-2" />
            批量导入
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>

      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={handleEditModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑库存</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 text-lg">
            {/* 第一行：名称（占2列）、CAS号（1列） */}
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={editFormData.name}
                onChange={(e) => handleEditNameChange(e.target.value)}
                className="h-8"
                placeholder="如: 乙醇"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                CAS号
              </label>
              <Input
                value={editFormData.cas_number}
                disabled
                className="h-8 bg-muted"
              />
            </div>

            {/* 第二行：英文名称（占2列）、别名（1列） */}
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">英文名称</label>
              <Input
                value={editFormData.english_name || ''}
                onChange={(e) => handleEditEnglishNameChange(e.target.value)}
                className="h-8"
                placeholder="如: Ethanol"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">别名</label>
              <Input
                value={editFormData.alias || ''}
                onChange={(e) => handleEditAliasChange(e.target.value)}
                className="h-8"
                placeholder="如: 酒精"
              />
            </div>

            {/* 第三行：位置（1列）、剩余量（1列）、规格（1列） */}
            <div>
              <label className="block text-sm font-medium mb-1">库存位置</label>
              <Input
                value={editFormData.location || ''}
                onChange={(e) => handleEditLocationChange(e.target.value)}
                className="h-8"
                placeholder="如: A-1-1 柜"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                剩余量 <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={editFormData.remaining_quantity}
                onChange={(e) => handleEditRemainingQuantityChange(parseFloat(e.target.value) || 0)}
                className="h-8"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                规格 <span className="text-red-500">*</span>
              </label>
              <Input
                value={editFormData.specification || ''}
                onChange={(e) => handleEditSpecificationChange(e.target.value)}
                className="h-8"
                placeholder="如: 500ml"
              />
            </div>

            {/* 第四行：品牌、分类、危险品 */}
            <div>
              <label className="block text-sm font-medium mb-1">品牌</label>
              <Input
                value={editFormData.brand || ''}
                onChange={(e) => handleEditBrandChange(e.target.value)}
                className="h-8"
                placeholder="如: Sigma"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">分类</label>
              <Input
                value={editFormData.category || ''}
                onChange={(e) => handleEditCategoryChange(e.target.value)}
                className="h-8"
                placeholder="如: 有机试剂"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit_is_hazardous"
                checked={editFormData.is_hazardous}
                onChange={(e) => handleEditHazardousChange(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="edit_is_hazardous" className="text-sm flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                危险品
              </label>
            </div>

            {/* 备注 */}
            <div className="col-span-3">
              <label className="block text-sm font-medium mb-1">备注</label>
              <textarea
                value={editFormData.notes || ''}
                onChange={(e) => handleEditNotesChange(e.target.value)}
                className="w-full h-16 px-3 py-2 border border-input rounded-md bg-background text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="其他说明..."
              />
            </div>
          </div>
          <div className="flex gap-2 pt-3">
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                className="text-sm"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                {deleteConfirm ? '确认删除' : '删除'}
              </Button>
              {deleteConfirm && (
                <span className="text-xs text-red-500">再次点击确认删除</span>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowEditModal(false)}
                className="text-sm"
              >
                取消
              </Button>
              <Button onClick={handleEditSave} className="text-sm">
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Add Modal */}
      <Dialog open={showManualAdd} onOpenChange={handleManualAddModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动入库</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualAdd}>
            <div className="grid grid-cols-3 gap-3 text-lg">
              {/* 第一行：试剂名称（占2列）、CAS号（1列） */}
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">
                  试剂名称 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="如: 乙醇"
                  className={cn("h-8", formErrors.name && 'border-red-500')}
                />
                {formErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  CAS号 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.cas_number}
                  onChange={(e) => handleCasNumberChange(e.target.value)}
                  placeholder="如: 64-17-5"
                  className={cn("h-8", formErrors.cas_number && 'border-red-500')}
                />
                {formErrors.cas_number && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.cas_number}</p>
                )}
              </div>

              {/* 第二行：英文名称（占2列）、别名（1列） */}
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">
                  英文名称
                </label>
                <Input
                  value={formData.english_name || ''}
                  onChange={(e) => handleEnglishNameChange(e.target.value)}
                  placeholder="如: Ethanol"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">别名</label>
                <Input
                  value={formData.alias}
                  onChange={(e) => handleAliasChange(e.target.value)}
                  placeholder="如: 酒精"
                  className="h-8"
                />
              </div>

              {/* 第三行：位置（1列）、规格（1列）、瓶数（1列） */}
              <div>
                <label className="block text-sm font-medium mb-1">存放位置</label>
                <Input
                  value={formData.location}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  placeholder="如: A-1-1 柜"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  规格 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.specification}
                  onChange={(e) => handleSpecificationChange(e.target.value)}
                  placeholder="如: 500ml, 1L"
                  className={cn("h-8", formErrors.specification && 'border-red-500')}
                />
                {formErrors.specification && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.specification}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  瓶数 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity_bottles}
                  onChange={(e) => handleQuantityBottlesChange(parseInt(e.target.value) || 1)}
                  className={cn("h-8", formErrors.quantity_bottles && 'border-red-500')}
                />
                {formErrors.quantity_bottles && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.quantity_bottles}</p>
                )}
              </div>

              {/* 第四行：品牌、分类、危险品选择 */}
              <div>
                <label className="block text-sm font-medium mb-1">品牌</label>
                <Input
                  value={formData.brand}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  placeholder="如: Sigma"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">分类</label>
                <Input
                  value={formData.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  placeholder="如: 有机试剂"
                  className="h-8"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_hazardous"
                  checked={formData.is_hazardous}
                  onChange={(e) => handleHazardousChange(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="is_hazardous" className="text-sm flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </label>
              </div>

              {/* 备注保持不变 */}
              <div className="col-span-3">
                <label className="block text-sm font-medium mb-1">备注</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  className="w-full h-16 px-3 py-2 border border-input rounded-md bg-background text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleManualAddModalClose(false)}
                  className="text-sm"
                >
                  取消
                </Button>
                <Button type="submit" disabled={submitting} className="text-sm">
                  {submitting ? '入库中...' : '确认入库'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex gap-3 items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索名称、CAS号、位置..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm w-full"
              />
              {globalFilter && (
                <button
                  onClick={() => setGlobalFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {/* 模糊搜索开关 - 只有在有搜索词时才触发重新加载 */}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={fuzzySearch}
                onChange={(e) => {
                  setFuzzySearch(e.target.checked)
                  // 只有在有搜索词时才重置页码并重新加载
                  if (apiFilter) {
                    setPage(1)
                  }
                }}
                className="w-4 h-4 rounded"
              />
              <span className="text-muted-foreground whitespace-nowrap">模糊搜索</span>
            </label>
            {/* 搜索字段选择器 */}
            <select
              value={searchField}
              onChange={(e) => {
                setSearchField(e.target.value)
                setPage(1)
              }}
              className="h-9 px-2 pr-6 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-ring"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.3rem center',
                backgroundSize: '1rem'
              }}
            >
              <option value="all">全部</option>
              <option value="name">名称</option>
              <option value="cas_number">CAS号</option>
              <option value="location">位置</option>
              <option value="brand">品牌</option>
              <option value="category">分类</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="h-9 px-3 pr-8 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-ring"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.5rem center',
                backgroundSize: '1rem'
              }}
            >
              <option value="all">全部状态</option>
              <option value="in_stock">在库</option>
              <option value="borrowed">借出</option>
              <option value="consumed">已用完</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            库存列表 ({globalFilter ? `${total}/${grandTotal}` : `${grandTotal}`})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* 有数据时在角落显示加载指示器，保持数据可见 */}
          {loading && data.length > 0 && (
            <div className="flex justify-end mb-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full min-w-[600px] md:min-w-[820px]" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} className="border-b bg-muted/30">
                          {headerGroup.headers.map(header => (
                            <th 
                              key={header.id} 
                              className="h-10 px-2 font-semibold text-foreground text-left align-middle text-sm"
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
                        <React.Fragment key={row.id}>
                          <tr 
                            className="border-b border-border hover:bg-muted/50 cursor-pointer"
                            onClick={() => toggleRowExpansion(row.original.id)}
                          >
                            {row.getVisibleCells().map(cell => (
                              <td 
                                key={cell.id} 
                                className="p-2 align-middle text-sm"
                                style={{ width: cell.column.getSize() }}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            ))}
                          </tr>
                          {expandedRows[row.original.id] && (
                            <tr key={`${row.id}-expanded`} className="border-b border-border bg-muted/20">
                              <td colSpan={row.getVisibleCells().length} className="p-2 text-sm">
                                <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                                  <div>
                                    <span className="font-medium">英文名称：</span>
                                    {row.original.english_name || '-'}
                                  </div>
                                  <div>
                                    <span className="font-medium">别名：</span>
                                    {row.original.alias || '-'}
                                  </div>
                                  <div>
                                    <span className="font-medium">入库时间：</span>
                                    {formatDate(row.original.created_at)}
                                  </div>
                                  <div>
                                    <span className="font-medium">入库用户：</span>
                                    {row.original.created_by_name || '-'}
                                  </div>
                                  <div>
                                    <span className="font-medium">上次借用：</span>
                                    {row.original.borrower_name 
                                      ? `${row.original.borrower_name} (未归还)` 
                                      : (row.original.last_borrower_name ? `${row.original.last_borrower_name} (已归还)` : '-')}
                                  </div>
                                  <div>
                                    <span className="font-medium">备注：</span>
                                    {row.original.notes || '-'}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
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
