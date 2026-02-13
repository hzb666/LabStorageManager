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
import { inventoryAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import { 
  Search, 
  ArrowUpDown, 
  Package, 
  AlertTriangle,
  Loader2,
  Download,
  Upload
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">库存管理</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.href = '/import'}>
            <Upload className="w-4 h-4 mr-2" />
            批量导入
          </Button>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>

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
