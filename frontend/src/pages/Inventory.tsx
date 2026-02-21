import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
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
  ArrowUpDown,
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
}

const columnHelper = createColumnHelper<InventoryItem>()

// Highlight component for search results
function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight || !text) return <>{text}</>
  const parts = text.split(new RegExp(`(${highlight})`, 'gi'))
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
}

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

  useEffect(() => {
    loadInventory()
  }, [page, pageSize, statusFilter, globalFilter])

  const loadInventory = async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = {
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }
      if (statusFilter !== 'all') params.status_filter = statusFilter
      if (globalFilter) params.search = globalFilter

      const response = await inventoryAPI.list(params)
      const result = response.data
      setData(result.data || [])
      setTotal(result.total || 0)
      
      // 如果没有搜索条件且状态为全部，更新库存总数
      if (!globalFilter && statusFilter === 'all') {
        setGrandTotal(result.total || 0)
      }
    } catch (error) {
      console.error('Failed to load inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setPage(1)
  }

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  // Handle edit
  const handleEditClick = (item: InventoryItem) => {
    setEditingItem(item)
    setDeleteConfirm(false) // 重置删除确认状态
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
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '更新失败')
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
      } catch (error: any) {
        toast.error(error.response?.data?.detail || '删除失败')
      }
    }
  }

  const handleEditModalClose = (open: boolean) => {
    setShowEditModal(open)
    if (!open) {
      setDeleteConfirm(false)
    }
  }

  const columns = useMemo(() => [
    // CAS号 - 放最前面
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 100,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || ''} highlight={globalFilter} />
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
            <HighlightText text={info.getValue() || ''} highlight={globalFilter} />
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
          <HighlightText text={info.getValue() || '-'} highlight={globalFilter} />
        </span>
      ),
    }),
    // 库存位置
    columnHelper.accessor('location', {
      header: '位置',
      size: 70,
      cell: info => (
        <span className="break-all">
          <HighlightText text={info.getValue() || '-'} highlight={globalFilter} />
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
          <HighlightText text={info.getValue() || '-'} highlight={globalFilter} />
        </span>
      ),
    }),
    // 入库时间
    columnHelper.accessor('created_at', {
      header: '入库时间',
      size: 80,
      cell: info => <span className="break-all">{formatDate(info.getValue())}</span>,
    }),
    // 状态
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      cell: info => {
        const status = info.getValue()
        const styles: Record<string, string> = {
          in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
          borrowed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
          consumed: 'bg-muted text-muted-foreground',
        }
        const labels: Record<string, string> = {
          in_stock: '在库',
          borrowed: '借用',
          consumed: '用完',
        }
        return (
          <span className={cn(
            'px-2 py-0.5 text-xs rounded-full font-medium whitespace-nowrap',
            styles[status] || 'bg-muted'
          )}>
            {labels[status] || status}
          </span>
        )
      },
    }),
    // 备注
    columnHelper.accessor('notes', {
      header: '备注',
      size: 80,
      cell: info => (
        <span className="break-all text-muted-foreground" title={info.getValue() || ''}>
          <HighlightText text={info.getValue() || '-'} highlight={globalFilter} />
        </span>
      ),
    }),
    // 操作
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 80,
      cell: info => {
        const item = info.row.original
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              title="编辑"
              onClick={() => handleEditClick(item)}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            {item.status === 'in_stock' && (
              <Button
                size="sm"
                className="h-7 text-xs px-2 bg-blue-600 hover:bg-blue-700"
                onClick={async () => {
                  await inventoryAPI.borrow(item.id)
                  loadInventory()
                }}
              >
                借用
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [data, globalFilter])

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
  })

  // Manual add form handlers
  const validateManualAddForm = (): boolean => {
    const errors: Record<string, string> = {}
    if (!formData.cas_number.trim()) errors.cas_number = 'CAS号不能为空'
    if (!/^\d{2,7}-\d{2}-\d$/.test(formData.cas_number)) {
      errors.cas_number = 'CAS号格式无效 (如: 64-17-5)'
    }
    if (!formData.name.trim()) errors.name = '名称不能为空'
    if (!formData.specification.trim()) errors.specification = '规格不能为空'
    if (formData.quantity_bottles < 1) errors.quantity_bottles = '瓶数必须大于0'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleManualAdd = async (e: React.FormEvent) => {
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
      setShowManualAdd(false)
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
      loadInventory()
      toast.success('手动入库成功！')
    } catch (error: any) {
      // 处理后端返回的验证错误，显示在对应输入框下方
      const errorDetail = error.response?.data?.detail
      if (errorDetail) {
        // 如果是数组格式的错误信息（FastAPI 默认格式）
        if (Array.isArray(errorDetail)) {
          const newErrors: Record<string, string> = {}
          errorDetail.forEach((err: any) => {
            if (err.loc && err.loc[1]) {
              const field = err.loc[1] as string
              newErrors[field] = err.msg
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
      toast.error(error.response?.data?.detail || '入库失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
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
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '导出失败')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">库存管理</h1>
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
          <div className="grid grid-cols-3 gap-3 text-sm">
            {/* 第一行：CAS号（占3列） */}
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">
                CAS号
              </label>
              <Input
                value={editFormData.cas_number}
                disabled
                className="h-8 bg-muted"
              />
            </div>

            {/* 第二行：名称（占2列）、别名（占1列） */}
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">
                名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                className="h-8"
                placeholder="如: 乙醇"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">别名</label>
              <Input
                value={editFormData.alias || ''}
                onChange={(e) => setEditFormData({ ...editFormData, alias: e.target.value })}
                className="h-8"
                placeholder="如: 酒精"
              />
            </div>

            {/* 第三行：英文名称（占2列）、规格（占1列） */}
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">英文名称</label>
              <Input
                value={editFormData.english_name || ''}
                onChange={(e) => setEditFormData({ ...editFormData, english_name: e.target.value })}
                className="h-8"
                placeholder="如: Ethanol"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">规格</label>
              <Input
                value={editFormData.specification || ''}
                onChange={(e) => setEditFormData({ ...editFormData, specification: e.target.value })}
                className="h-8"
                placeholder="如: 500ml"
              />
            </div>

            {/* 第四行：剩余量、分类、品牌 */}
            <div>
              <label className="block text-xs font-medium mb-1">
                剩余量 <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={editFormData.remaining_quantity}
                onChange={(e) => setEditFormData({ ...editFormData, remaining_quantity: parseFloat(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">分类</label>
              <Input
                value={editFormData.category || ''}
                onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                className="h-8"
                placeholder="如: 有机试剂"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">品牌</label>
              <Input
                value={editFormData.brand || ''}
                onChange={(e) => setEditFormData({ ...editFormData, brand: e.target.value })}
                className="h-8"
                placeholder="如: Sigma"
              />
            </div>

            {/* 库存位置 */}
            <div>
              <label className="block text-xs font-medium mb-1">库存位置</label>
              <Input
                value={editFormData.location || ''}
                onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                className="h-8"
                placeholder="如: A-1-1 柜"
              />
            </div>

            {/* 危险品 */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit_is_hazardous"
                checked={editFormData.is_hazardous}
                onChange={(e) => setEditFormData({ ...editFormData, is_hazardous: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="edit_is_hazardous" className="text-xs flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                危险品
              </label>
            </div>

            {/* 备注 */}
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">备注</label>
              <textarea
                value={editFormData.notes || ''}
                onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                className="w-full h-16 px-2 py-1 border rounded-md bg-background text-sm resize-none"
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
      <Dialog open={showManualAdd} onOpenChange={setShowManualAdd}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动入库</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualAdd} className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="col-span-3">
                <label className="block text-xs font-medium mb-1">
                  CAS号 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.cas_number}
                  onChange={(e) => setFormData({ ...formData, cas_number: e.target.value })}
                  placeholder="如: 64-17-5"
                  className={cn("h-8", formErrors.cas_number && 'border-red-500')}
                />
                {formErrors.cas_number && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.cas_number}</p>
                )}
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1">
                  试剂名称 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="如: 乙醇"
                  className={cn("h-8", formErrors.name && 'border-red-500')}
                />
                {formErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  英文名称
                </label>
                <Input
                  value={formData.english_name || ''}
                  onChange={(e) => setFormData({ ...formData, english_name: e.target.value })}
                  placeholder="如: Ethanol"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  规格 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.specification}
                  onChange={(e) => setFormData({ ...formData, specification: e.target.value })}
                  placeholder="如: 500ml, 1L"
                  className={cn("h-8", formErrors.specification && 'border-red-500')}
                />
                {formErrors.specification && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.specification}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">别名</label>
                <Input
                  value={formData.alias}
                  onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                  placeholder="如: 酒精"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  瓶数 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity_bottles}
                  onChange={(e) => setFormData({ ...formData, quantity_bottles: parseInt(e.target.value) || 1 })}
                  className={cn("h-8", formErrors.quantity_bottles && 'border-red-500')}
                />
                {formErrors.quantity_bottles && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.quantity_bottles}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">品牌</label>
                <Input
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  placeholder="如: Sigma"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">分类</label>
                <Input
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="如: 有机试剂"
                  className="h-8"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">存放位置</label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="如: A-1-1 柜"
                  className="h-8"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_hazardous"
                  checked={formData.is_hazardous}
                  onChange={(e) => setFormData({ ...formData, is_hazardous: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="is_hazardous" className="text-xs flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </label>
              </div>

              <div className="col-span-3">
                <label className="block text-xs font-medium mb-1">备注</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full h-16 px-2 py-1 border rounded-md bg-background text-sm resize-none"
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowManualAdd(false)}
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
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索名称、CAS号、位置..."
                value={globalFilter}
                onChange={(e) => { setGlobalFilter(e.target.value); setPage(1) }}
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
          {loading ? (
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
                <table className="w-full" style={{ minWidth: '820px', tableLayout: 'fixed' }}>
                    <thead>
                      {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} className="border-b bg-muted/30">
                          {headerGroup.headers.map(header => (
                            <th 
                              key={header.id} 
                              className="h-10 px-2 font-semibold text-foreground text-left align-middle"
                              style={{ width: header.getSize(), fontSize: '13px' }}
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
                        <tr key={row.id} className="border-b border-border hover:bg-muted/50">
                          {row.getVisibleCells().map(cell => (
                            <td 
                              key={cell.id} 
                              className="p-2 align-middle"
                              style={{ width: cell.column.getSize(), fontSize: '13px' }}
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
