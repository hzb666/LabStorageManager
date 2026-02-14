import React, { useState, useEffect, useMemo } from 'react'
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
import { inventoryAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import {
  Search,
  ArrowUpDown,
  Package,
  AlertTriangle,
  Loader2,
  Download,
  Upload,
  Plus,
  X
} from 'lucide-react'

interface InventoryItem {
  id: number
  internal_code: string
  cas_number: string
  name: string
  location: string | null
  initial_quantity: number
  remaining_quantity: number
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
}

const columnHelper = createColumnHelper<InventoryItem>()

export function InventoryPage() {
  const [data, setData] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Manual add modal
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    cas_number: '',
    name: '',
    alias: '',
    specification: '',
    initial_quantity: 1,
    quantity_bottles: 1,
    location: '',
    is_hazardous: false,
    notes: ''
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    loadInventory()
  }, [])

  const loadInventory = async () => {
    try {
      const response = await inventoryAPI.list()
      setData(response.data || [])
    } catch (error) {
      console.error('Failed to load inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredData = useMemo(() => {
    if (statusFilter === 'all') return data
    return data.filter(item => item.status === statusFilter)
  }, [data, statusFilter])

  const columns = useMemo(() => [
    columnHelper.accessor('internal_code', {
      header: '编号',
      cell: info => <span className="font-mono text-sm">{info.getValue()}</span>,
    }),
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      cell: info => (
        <div className="flex items-center gap-1">
          {info.row.original.is_hazardous && (
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          )}
          <span>{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor('location', {
      header: '位置',
      cell: info => info.getValue() || '-',
    }),
    columnHelper.accessor('remaining_quantity', {
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="p-0 hover:bg-transparent"
          >
            剩余量
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: info => {
        const remaining = info.getValue()
        const initial = info.row.original.initial_quantity
        const percentage = (remaining / initial) * 100
        return (
          <div>
            <span className={cn(
              percentage < 20 && 'text-red-500 font-medium'
            )}>
              {remaining} {info.row.original.unit}
            </span>
            {percentage < 20 && (
              <div className="w-16 h-1 bg-red-200 rounded mt-1">
                <div
                  className="h-full bg-red-500 rounded"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor('status', {
      header: '状态',
      cell: info => {
        const status = info.getValue()
        const styles: Record<string, string> = {
          in_stock: 'bg-green-100 text-green-800',
          borrowed: 'bg-blue-100 text-blue-800',
          consumed: 'bg-gray-100 text-gray-800',
        }
        const labels: Record<string, string> = {
          in_stock: '在库',
          borrowed: '借出',
          consumed: '已用完',
        }
        return (
          <span className={cn(
            'px-2 py-1 text-xs rounded-full',
            styles[status] || 'bg-gray-100'
          )}>
            {labels[status] || status}
          </span>
        )
      },
    }),
    columnHelper.accessor('created_at', {
      header: '入库时间',
      cell: info => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      cell: info => {
        const item = info.row.original
        if (item.status === 'in_stock') {
          return (
            <Button
              size="sm"
              onClick={async () => {
                await inventoryAPI.borrow(item.id)
                loadInventory()
              }}
            >
              借用
            </Button>
          )
        }
        return null
      },
    }),
  ], [data])

  const table = useReactTable({
    data: filteredData,
    columns,
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
    if (formData.initial_quantity < 0.1) errors.initial_quantity = '数量必须大于0'
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
        alias: formData.alias || undefined,
        specification: formData.specification,
        initial_quantity: formData.initial_quantity,
        quantity_bottles: formData.quantity_bottles,
        location: formData.location || undefined,
        is_hazardous: formData.is_hazardous,
        notes: formData.notes || undefined
      })
      setShowManualAdd(false)
      setFormData({
        cas_number: '',
        name: '',
        alias: '',
        specification: '',
        initial_quantity: 1,
        quantity_bottles: 1,
        location: '',
        is_hazardous: false,
        notes: ''
      })
      loadInventory()
      alert('手动入库成功！')
    } catch (error: any) {
      alert(error.response?.data?.detail || '入库失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      const { data, filename } = response.data
      
      // Create and download CSV file
      const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      alert(error.response?.data?.detail || '导出失败')
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
          <Button variant="outline" onClick={() => window.location.href = '/import'}>
            <Upload className="w-4 h-4 mr-2" />
            批量导入
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>

      {/* Manual Add Modal */}
      <Dialog open={showManualAdd} onOpenChange={setShowManualAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>手动入库</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualAdd} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  CAS号 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.cas_number}
                  onChange={(e) => setFormData({ ...formData, cas_number: e.target.value })}
                  placeholder="如: 64-17-5"
                  className={formErrors.cas_number ? 'border-red-500' : ''}
                />
                {formErrors.cas_number && (
                  <p className="text-sm text-red-500 mt-1">{formErrors.cas_number}</p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  试剂名称 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="如: 乙醇 (Ethanol)"
                  className={formErrors.name ? 'border-red-500' : ''}
                />
                {formErrors.name && (
                  <p className="text-sm text-red-500 mt-1">{formErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  规格 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={formData.specification}
                  onChange={(e) => setFormData({ ...formData, specification: e.target.value })}
                  placeholder="如: 500ml, 1L"
                  className={formErrors.specification ? 'border-red-500' : ''}
                />
                {formErrors.specification && (
                  <p className="text-sm text-red-500 mt-1">{formErrors.specification}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">别名</label>
                <Input
                  value={formData.alias}
                  onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                  placeholder="如: 酒精"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  每瓶含量 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.initial_quantity}
                  onChange={(e) => setFormData({ ...formData, initial_quantity: parseFloat(e.target.value) || 0 })}
                  className={formErrors.initial_quantity ? 'border-red-500' : ''}
                />
                {formErrors.initial_quantity && (
                  <p className="text-sm text-red-500 mt-1">{formErrors.initial_quantity}</p>
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
                  onChange={(e) => setFormData({ ...formData, quantity_bottles: parseInt(e.target.value) || 1 })}
                  className={formErrors.quantity_bottles ? 'border-red-500' : ''}
                />
                {formErrors.quantity_bottles && (
                  <p className="text-sm text-red-500 mt-1">{formErrors.quantity_bottles}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">存放位置</label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="如: A-1-1 柜"
                />
              </div>

              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="is_hazardous"
                  checked={formData.is_hazardous}
                  onChange={(e) => setFormData({ ...formData, is_hazardous: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="is_hazardous" className="text-sm flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  危险品
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">备注</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full h-20 px-3 py-2 border rounded-md bg-background resize-none"
                  placeholder="其他说明..."
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button type="submit" disabled={submitting}>
                {submitting ? '入库中...' : '确认入库'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowManualAdd(false)}
              >
                取消
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索 CAS号、名称、编号..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 border rounded-md bg-background"
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
            库存列表 ({filteredData.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无库存数据
            </div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b bg-muted/50">
                      {headerGroup.headers.map(header => (
                        <th key={header.id} className="h-10 px-4 text-left align-middle font-medium">
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
                    <tr key={row.id} className="border-b hover:bg-muted/50">
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="p-4 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
