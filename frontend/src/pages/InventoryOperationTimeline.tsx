import { useCallback, useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { ArrowLeft, FileText } from 'lucide-react'

import {
  createInventoryTimelineAPI,
  inventoryAPI,
  type InventoryDetail,
  type InventoryTimelineItem,
  type InventoryTimelineOperationType,
} from '@/api/client'
import { OperationLogExpandedRow } from '@/components/OperationLogExpandedRow'
import { Button } from '@/components/ui/Button'
import { FilterTable } from '@/components/ui/FilterTable'
import { HighlightText } from '@/components/ui/HighlightText'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TableLoadingState } from '@/components/ui/TableFilters'
import type { FilterAPI } from '@/hooks/useTableState'
import type { BadgeColor } from '@/lib/constants'
import { formatDateTime } from '@/lib/utils'
import { getApiErrorMessage } from '@/lib/validationSchemas'

const SEARCH_FIELD_OPTIONS = [{ value: 'all', label: '全部' }]

const OPERATION_TYPE_META: Record<
  InventoryTimelineOperationType,
  { label: string; color: BadgeColor }
> = {
  stock_in: { label: '入库', color: 'green' },
  edit: { label: '编辑', color: 'blue' },
  borrow: { label: '借用', color: 'cyan' },
}

function formatTimelineTime(time: string | null): string {
  if (!time) return '-'
  try {
    return formatDateTime(time)
  } catch {
    return time
  }
}

function OperationTypeBadge({ type }: Readonly<{ type: InventoryTimelineOperationType }>) {
  const meta = OPERATION_TYPE_META[type]
  return <StatusBadge status={meta.label} color={meta.color} />
}

const columnHelper = createColumnHelper<InventoryTimelineItem>()

function getTimelineColumns() {
  return [
    columnHelper.accessor('time', {
      header: '时间',
      enableSorting: false,
      size: 180,
      minSize: 150,
      cell: info => <span>{formatTimelineTime(info.getValue())}</span>,
    }),
    columnHelper.accessor('operation_type', {
      header: '类型',
      enableSorting: false,
      size: 100,
      minSize: 80,
      cell: info => <OperationTypeBadge type={info.getValue()} />,
    }),
    columnHelper.accessor('operator_name', {
      header: '操作人',
      enableSorting: false,
      size: 150,
      minSize: 120,
      cell: info => (
        <HighlightText
          text={info.getValue()}
          highlight={info.table.getState().globalFilter}
          matchMode={info.table.options.meta?.matchMode}
        />
      ),
    }),
    columnHelper.accessor('detail', {
      header: '详情',
      enableSorting: false,
      size: 500,
      minSize: 320,
      cell: info => (
        <div className="flex min-w-0 items-center gap-2">
          <HighlightText
            text={info.row.original.detail}
            highlight={info.table.getState().globalFilter}
            matchMode={info.table.options.meta?.matchMode}
          />
          {info.row.original.operation_type === 'borrow' && (
            <StatusBadge
              status={info.row.original.summary?.is_returned === true ? '已归还' : '借用中'}
              color={info.row.original.summary?.is_returned === true ? 'green' : 'cyan'}
              className="h-7"
            />
          )}
        </div>
      ),
    }),
  ]
}

function TimelineHeader({
  inventory,
  onBack,
}: Readonly<{
  inventory?: InventoryDetail
  onBack: () => void
}>) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4 sm:overflow-hidden sm:whitespace-nowrap">
      <Button variant="modern" className="h-10 shrink-0" onClick={onBack}>
        <ArrowLeft className="mr-2 size-4" />
        返回
      </Button>
      <h1 className="shrink-0 text-2xl font-bold text-primary sm:text-3xl">操作记录</h1>
      {inventory && (
        <div className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground sm:w-auto sm:flex-1 sm:flex-nowrap sm:overflow-hidden sm:text-base">
          <span className="min-w-0 sm:max-w-[32rem] sm:truncate" title={inventory.name}>
            名称：{inventory.name}
          </span>
          <span className="shrink-0">CAS：{inventory.cas_number}</span>
          <span className="min-w-0 sm:truncate" title={inventory.storage_location || '-'}>
            位置：{inventory.storage_location || '-'}
          </span>
        </div>
      )}
    </div>
  )
}

export function InventoryOperationTimelinePage() {
  const navigate = useNavigate()
  const { internalCode: routeInternalCode } = useParams<{ internalCode: string }>()
  const internalCode = routeInternalCode?.trim() ?? ''
  const timelineAPI = useMemo(() => createInventoryTimelineAPI(internalCode), [internalCode])
  const columns = useMemo(() => getTimelineColumns(), [])
  const handleBack = useCallback(() => navigate('/inventory'), [navigate])
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    return <OperationLogExpandedRow item={itemRaw as unknown as InventoryTimelineItem} />
  }, [])
  const inventoryQuery = useQuery({
    queryKey: ['inventory-by-code', internalCode],
    queryFn: async () => (await inventoryAPI.getByCode(internalCode)).data,
    enabled: Boolean(internalCode),
  })

  if (!internalCode) {
    return <Navigate to="/inventory" replace />
  }

  if (inventoryQuery.isLoading) {
    return (
      <div className="space-y-6">
        <TimelineHeader onBack={handleBack} />
        <TableLoadingState className="min-h-[18rem]" label="加载操作记录" />
      </div>
    )
  }

  if (inventoryQuery.isError || !inventoryQuery.data) {
    return (
      <div className="space-y-6">
        <TimelineHeader onBack={handleBack} />
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">
          {getApiErrorMessage(inventoryQuery.error, '库存不存在或无法加载')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <TimelineHeader inventory={inventoryQuery.data} onBack={handleBack} />
      <FilterTable
        api={timelineAPI as FilterAPI}
        queryKey={['inventory-timeline', internalCode]}
        tableId="inventory-operation-timeline"
        customColumns={columns as ColumnDef<Record<string, unknown>, unknown>[]}
        title={<><FileText className="size-5" /> 操作记录</>}
        searchPlaceholder="搜索操作人或详情..."
        statusOptions={[]}
        searchFieldOptions={SEARCH_FIELD_OPTIONS}
        showFuzzySearch={false}
        showMatchMode={false}
        suppressSorting
        renderExpandedRow={renderExpandedRow}
        scrollHeight="calc(100vh - 280px)"
        emptyText="暂无操作记录"
        endMessage="仅显示近期记录"
      />
    </div>
  )
}

export default InventoryOperationTimelinePage
