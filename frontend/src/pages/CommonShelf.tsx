import React, { useMemo, useCallback } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Archive } from 'lucide-react'

import { FilterTable } from '@/components/ui/FilterTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import { commonShelfAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { getInventoryTableColumns } from '@/lib/tableConfigs'
import { formatDate } from '@/lib/utils'

interface CommonShelfItem {
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
  created_at: string
  created_by_name?: string | null
  notes?: string | null
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'common', label: '常用' },
  { value: 'in_stock', label: '在库' },
  { value: 'borrowed', label: '借出' },
  { value: 'consumed', label: '已用完' },
]

const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
]

export function CommonShelfPage() {
  const columns = useMemo(
    () => getInventoryTableColumns() as ColumnDef<Record<string, unknown>, unknown>[],
    []
  )

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
