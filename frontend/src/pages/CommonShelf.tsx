import React, { useMemo, useCallback } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { Archive } from 'lucide-react'

import { FilterTable } from '@/components/ui/FilterTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { commonShelfAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { formatDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { normalizeApiErrorMessage, safeString } from '@/lib/validationSchemas'

interface CommonShelfItem {
  id: number
  sample_inventory_id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number | null
  unit: string | null
  status: string
  created_at: string
  created_by_name?: string | null
  notes?: string | null
  available_bottles: number
  total_bottles: number
  consumed_bottles: number
  specification?: string | null
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'consumed', label: '已耗尽' },
]

const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
  { value: 'storage_location', label: '位置' },
]

const columnHelper = createColumnHelper<CommonShelfItem>()

export function CommonShelfPage() {
  const queryClient = useQueryClient()

  const refreshCommonShelf = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['common-shelf'] })
  }, [queryClient])

  const columns = useMemo(() => {
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      minSize: 100,
      maxSize: 140,
      cell: (info) => {
        const meta = info.table.options.meta
        return (
          <CommonShelfActionButtons
            item={info.row.original}
            onConsumeSuccess={meta?.onBorrowSuccess as () => void}
          />
        )
      },
    })

    const baseColumns: ColumnDef<CommonShelfItem, unknown>[] = [
      columnHelper.accessor('cas_number', {
        header: 'CAS号',
        size: 130,
        minSize: 110,
        cell: (info) => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
      }),
      columnHelper.accessor('name', {
        header: '名称',
        size: 220,
        minSize: 180,
        cell: (info) => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
      }),
      columnHelper.accessor('storage_location', {
        header: '位置',
        size: 140,
        minSize: 110,
        cell: (info) => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
      }),
      columnHelper.accessor('brand', {
        header: '品牌',
        size: 100,
        minSize: 80,
        cell: (info) => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
      }),
      columnHelper.accessor('specification', {
        header: '规格',
        size: 110,
        minSize: 90,
        cell: (info) => <span>{safeString(info.getValue(), '-')}</span>,
      }),
      columnHelper.accessor('available_bottles', {
        header: '可用瓶数',
        size: 90,
        minSize: 80,
        cell: (info) => <span className="font-medium text-green-700">{info.getValue()} 瓶</span>,
      }),
      columnHelper.accessor('total_bottles', {
        header: '总瓶数',
        size: 90,
        minSize: 80,
        cell: (info) => <span>{info.getValue()} 瓶</span>,
      }),
      columnHelper.accessor('status', {
        header: '状态',
        size: 80,
        minSize: 70,
        cell: (info) => <StatusBadge status={safeString(info.getValue(), '')} />,
      }),
    ]

    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [])

  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as CommonShelfItem
    return (
      <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
        <div className="hidden md:block shrink-0">
          <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 flex-1">
          <div>英文名称：{item.english_name || '-'}</div>
          <div>别名：{item.alias || '-'}</div>
          <div>分类：{item.category || '-'}</div>
          <div>品牌：{item.brand || '-'}</div>
          <div>创建人：{item.created_by_name || '-'}</div>
          <div>入库时间：{formatDate(item.created_at)}</div>
          <div>可用/总计：{item.available_bottles} / {item.total_bottles} 瓶</div>
          <div>已耗尽：{item.consumed_bottles} 瓶</div>
          <NoteDisplay label="备注" text={item.notes ?? undefined} />
        </div>
      </div>
    )
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">常用货架</h1>
      </div>

      <FilterTable
        api={commonShelfAPI as FilterAPI}
        queryKey={['common-shelf']}
        tableId="common-shelf-table"
        customColumns={columns}
        onBorrowSuccess={refreshCommonShelf}
        statusOptions={STATUS_OPTIONS}
        searchFieldOptions={SEARCH_FIELD_OPTIONS}
        title={<><Archive className="w-5 h-5" /> 常用/公用试剂</>}
        searchPlaceholder="搜索名称、CAS号、品牌..."
        renderExpandedRow={renderExpandedRow}
        noteField="notes"
      />
    </div>
  )
}

const CommonShelfActionButtons = React.memo(function CommonShelfActionButtons({
  item,
  onConsumeSuccess,
}: {
  item: CommonShelfItem
  onConsumeSuccess: () => void | Promise<void>
}) {
  const actions = useMemo(() => {
    return [
      {
        id: 'consume',
        label: '拿一瓶',
        confirm: true,
        confirmLabel: '确认',
        showWhen: (currentItem: CommonShelfItem) => currentItem.available_bottles > 0,
        onClick: async (currentItem: CommonShelfItem) => {
          try {
            await commonShelfAPI.consumeOne(currentItem.sample_inventory_id)
            await onConsumeSuccess()
            toast.success('已记录拿取 1 瓶')
          } catch (error) {
            const err = error as { response?: { data?: { detail?: string } } }
            toast.error(normalizeApiErrorMessage(err.response?.data?.detail, '拿取失败'))
            throw error
          }
        },
      },
    ]
  }, [onConsumeSuccess])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={false}
      statusField="status"
    />
  )
}, (prevProps, nextProps) => {
  if (prevProps.onConsumeSuccess !== nextProps.onConsumeSuccess) return false

  const prevItem = prevProps.item as Record<string, unknown>
  const nextItem = nextProps.item as Record<string, unknown>
  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
