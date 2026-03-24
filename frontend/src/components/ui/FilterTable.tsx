/**
 * 通用筛选表格组件
 * 集成搜索/筛选、分页、表格列配置、展开/收起等功能
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ColumnDef, RowData, Table } from '@tanstack/react-table'
import { useLocation } from 'react-router-dom'
import { ChevronsDownUp, ChevronsUpDown, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { TableEmptyState, TableFilters } from '@/components/ui/TableFilters'
import {
  DEFAULT_SEARCH_FIELD_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  useTableState,
} from '@/hooks/useTableState'
import type { FilterAPI, FilterOption, SearchFieldOption } from '@/hooks/useTableState'
import { getInventoryTableColumns } from '@/lib/tableConfigs'

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean
    onEdit?: (item: TData) => void
    onBorrowSuccess?: () => void
  }
}

export interface FilterTableProps {
  api: FilterAPI
  queryKey?: string[]
  tableId: string
  customColumns?: ColumnDef<Record<string, unknown>, unknown>[]
  onEdit?: (item: Record<string, unknown>) => void
  onBorrowSuccess?: () => void
  statusOptions?: FilterOption[]
  searchFieldOptions?: SearchFieldOption[]
  showFuzzySearch?: boolean
  defaultStatus?: string
  defaultSearchField?: string
  pageSize?: number
  debounceMs?: number
  extraParams?: Record<string, unknown>
  searchPlaceholder?: string
  title?: React.ReactNode
  enableExpandAll?: boolean
  renderExpandedRow?: (item: Record<string, unknown>) => React.ReactNode
  noteField?: string
  scrollHeight?: number | string
  className?: string
  emptyText?: string
}

/** 从地址栏解析初始搜索词与搜索字段，作为表格首屏状态来源。 */
function getInitialUrlSearchState({
  defaultSearchField,
  locationSearch,
  searchFieldOptions,
}: Readonly<{
  defaultSearchField: string
  locationSearch: string
  searchFieldOptions: SearchFieldOption[]
}>) {
  try {
    const query = new URLSearchParams(locationSearch)
    const nextSearch = query.get('search')?.trim() ?? ''
    const nextField = query.get('field')?.trim() ?? ''
    const hasValidField = searchFieldOptions.some((option) => option.value === nextField)

    return {
      search: nextSearch,
      field: hasValidField ? nextField : defaultSearchField,
      hasQuery: query.has('search') || query.has('field'),
    }
  } catch {
    return {
      search: '',
      field: defaultSearchField,
      hasQuery: false,
    }
  }
}

/** 为表格生成稳定行 id，优先使用业务主键，其次回退到索引。 */
function getTableRowId(row: Record<string, unknown>, index: number): string {
  if (typeof row.id === 'string' || typeof row.id === 'number') {
    return String(row.id)
  }

  if (typeof row.uuid === 'string' || typeof row.uuid === 'number') {
    return String(row.uuid)
  }

  return String(index)
}

/** 根据行数与显式配置推导表格滚动容器高度。 */
function getScrollHeight(rowCount: number, scrollHeight?: number | string): number | string {
  if (scrollHeight !== undefined) {
    return scrollHeight
  }

  if (rowCount <= 10) {
    return 'auto'
  }

  return 'calc(100vh - 112px - 16px)'
}

/** 通过 ref 持有外部动作回调，避免表格 meta 因函数引用变化而频繁重建。 */
function useActionRefs({
  onBorrowSuccess,
  onEdit,
}: Readonly<Pick<FilterTableProps, 'onBorrowSuccess' | 'onEdit'>>) {
  const onEditRef = useRef(onEdit)
  const onBorrowSuccessRef = useRef(onBorrowSuccess)

  useEffect(() => {
    onEditRef.current = onEdit
    onBorrowSuccessRef.current = onBorrowSuccess
  }, [onEdit, onBorrowSuccess])

  return { onEditRef, onBorrowSuccessRef }
}

/** 监听地址栏搜索参数变化，并把 URL 中的搜索态同步回表格状态。 */
function useLocationSearchSync({
  applySearchImmediate,
  defaultSearchField,
  initialUrlSearchState,
  locationSearch,
}: Readonly<{
  applySearchImmediate: (search: string, field?: string) => void
  defaultSearchField: string
  initialUrlSearchState: ReturnType<typeof getInitialUrlSearchState>
  locationSearch: string
}>) {
  const lastAppliedSearchRef = useRef<string>(locationSearch)

  useEffect(() => {
    if (locationSearch === lastAppliedSearchRef.current) {
      return
    }

    if (!locationSearch || !initialUrlSearchState.hasQuery) {
      applySearchImmediate('', defaultSearchField)
      lastAppliedSearchRef.current = locationSearch
      return
    }

    applySearchImmediate(initialUrlSearchState.search, initialUrlSearchState.field)
    lastAppliedSearchRef.current = locationSearch
  }, [
    applySearchImmediate,
    defaultSearchField,
    initialUrlSearchState.field,
    initialUrlSearchState.hasQuery,
    initialUrlSearchState.search,
    locationSearch,
  ])
}

/** 在筛选条件变化后重置展开态，避免旧展开行与新结果集错位。 */
function useExpandedResetOnFilterChange({
  enableExpandAll,
  filter,
  table,
}: Readonly<{
  enableExpandAll: boolean
  filter: ReturnType<typeof useTableState>
  table: Table<Record<string, unknown>>
}>) {
  const tableRef = useRef(table)

  useEffect(() => {
    tableRef.current = table
  }, [table])

  const prevFiltersRef = useRef({
    globalFilter: filter.globalFilter,
    statusFilter: filter.statusFilter,
    searchField: filter.searchField,
    fuzzySearch: filter.fuzzySearch,
    sorting: filter.sorting,
  })

  useEffect(() => {
    const prev = prevFiltersRef.current
    const current = {
      globalFilter: filter.globalFilter,
      statusFilter: filter.statusFilter,
      searchField: filter.searchField,
      fuzzySearch: filter.fuzzySearch,
      sorting: filter.sorting,
    }

    const hasFilterChanged =
      prev.globalFilter !== current.globalFilter ||
      prev.statusFilter !== current.statusFilter ||
      prev.searchField !== current.searchField ||
      prev.fuzzySearch !== current.fuzzySearch ||
      prev.sorting !== current.sorting

    if (!hasFilterChanged) {
      return
    }

    tableRef.current.resetExpanded()
    if (enableExpandAll && filter.isAllExpanded) {
      tableRef.current.toggleAllRowsExpanded(true)
    }
    prevFiltersRef.current = current
  }, [
    enableExpandAll,
    filter.fuzzySearch,
    filter.globalFilter,
    filter.isAllExpanded,
    filter.searchField,
    filter.sorting,
    filter.statusFilter,
  ])
}

interface FilterTableHeaderProps {
  disableExpandAll: boolean
  displayCount: number
  enableExpandAll: boolean
  isAllExpanded: boolean
  onToggleExpandAll: () => void
  title?: React.ReactNode
}

/** 渲染筛选表格卡片头部与“展开全部”控制区。 */
function FilterTableHeader({
  disableExpandAll,
  displayCount,
  enableExpandAll,
  isAllExpanded,
  onToggleExpandAll,
  title,
}: Readonly<FilterTableHeaderProps>) {
  if (!title) {
    return null
  }

  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          {title}
          <span className="text-muted-foreground font-normal">
            (&thinsp;{displayCount}&thinsp;)
          </span>
        </CardTitle>
        {enableExpandAll && (
          <Button
            variant="modern"
            size="lg"
            onClick={onToggleExpandAll}
            disabled={disableExpandAll}
            className={disableExpandAll ? 'text-muted-foreground opacity-60' : ''}
          >
            {isAllExpanded ? (
              <><ChevronsDownUp className="size-4 -ml-0.5 mr-1.5" />收起全部</>
            ) : (
              <><ChevronsUpDown className="size-4 -ml-0.5 mr-1.5" />展开全部</>
            )}
          </Button>
        )}
      </div>
    </CardHeader>
  )
}

interface FilterTableContentProps {
  emptyText: string
  enableExpandAll: boolean
  filter: ReturnType<typeof useTableState>
  noteField?: string
  renderExpandedRow?: (item: Record<string, unknown>) => React.ReactNode
  scrollHeight: number | string
  setIsTableAtTop: React.Dispatch<React.SetStateAction<boolean>>
  statusOptions: FilterOption[]
  table: Table<Record<string, unknown>>
  tableId: string
}

/** 根据加载态、空态和数据态切换表格主体内容。 */
function FilterTableContent({
  emptyText,
  enableExpandAll,
  filter,
  noteField,
  renderExpandedRow,
  scrollHeight,
  setIsTableAtTop,
  statusOptions,
  table,
  tableId,
}: Readonly<FilterTableContentProps>) {
  if (filter.isLoading && filter.data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
      </div>
    )
  }

  if (filter.data.length === 0) {
    return (
      <TableEmptyState
        searchKeyword={filter.globalFilter}
        statusFilter={filter.statusFilter}
        hasFilter={filter.hasFilter}
        emptyText={emptyText}
        statusOptions={statusOptions}
      />
    )
  }

  return (
    <div className="px-6">
      <DataTable
        table={table}
        renderExpandedRow={renderExpandedRow}
        scrollHeight={scrollHeight}
        enableExpandAll={enableExpandAll}
        expandAllStorageKey={tableId}
        noteField={noteField}
        isAllExpanded={filter.isAllExpanded}
        onToggleExpandAll={filter.toggleExpandAll}
        hasNextPage={filter.hasNextPage}
        isFetchingNextPage={filter.isFetchingNextPage}
        fetchNextPage={filter.fetchNextPage}
        total={filter.total}
        searchKeyword={filter.globalFilter}
        onIsAtTopChange={setIsTableAtTop}
      />
    </div>
  )
}

/** 组合筛选栏、表格状态与数据表格渲染，是 FilterTable 的总入口。 */
export function FilterTable({
  api,
  queryKey = ['list'],
  tableId,
  customColumns,
  onEdit,
  onBorrowSuccess,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  searchFieldOptions = DEFAULT_SEARCH_FIELD_OPTIONS,
  showFuzzySearch = true,
  defaultStatus = 'all',
  defaultSearchField = 'all',
  pageSize = 50,
  debounceMs = 300,
  extraParams = {},
  searchPlaceholder = '搜索名称、CAS号、位置...',
  title,
  enableExpandAll = true,
  renderExpandedRow,
  noteField,
  scrollHeight,
  className = '',
  emptyText = '暂无数据',
}: Readonly<FilterTableProps>) {
  const location = useLocation()
  const { onEditRef, onBorrowSuccessRef } = useActionRefs({ onEdit, onBorrowSuccess })
  const [isTableAtTop, setIsTableAtTop] = useState(true)

  const initialUrlSearchState = useMemo(() => {
    return getInitialUrlSearchState({
      defaultSearchField,
      locationSearch: location.search,
      searchFieldOptions,
    })
  }, [defaultSearchField, location.search, searchFieldOptions])

  const filter = useTableState({
    api,
    queryKey,
    tableId,
    statusOptions,
    searchFieldOptions,
    defaultStatus,
    defaultSearchField,
    pageSize,
    debounceMs,
    extraParams,
    initialSearch: initialUrlSearchState.search,
    initialSearchField: initialUrlSearchState.field,
  })

  useLocationSearchSync({
    applySearchImmediate: filter.applySearchImmediate,
    defaultSearchField,
    initialUrlSearchState,
    locationSearch: location.search,
  })

  const tableColumns = useMemo(() => {
    if (customColumns && customColumns.length > 0) {
      return customColumns
    }

    return getInventoryTableColumns() as ColumnDef<Record<string, unknown>, unknown>[]
  }, [customColumns])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    defaultColumn: {
      sortDescFirst: false,
      sortingFn: 'text',
    },
    data: filter.data as Record<string, unknown>[],
    columns: tableColumns,
    getRowId: getTableRowId,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    onColumnSizingChange: filter.setColumnSizing,
    manualSorting: true,
    onSortingChange: filter.setSorting,
    state: {
      sorting: filter.sorting,
      columnSizing: filter.columnSizing,
      globalFilter: filter.globalFilter,
    },
    meta: {
      fuzzySearch: filter.fuzzySearch,
      onEdit: (item) => onEditRef.current?.(item),
      onBorrowSuccess: () => onBorrowSuccessRef.current?.(),
    },
  })

  useExpandedResetOnFilterChange({ enableExpandAll, filter, table })

  const calculatedScrollHeight = useMemo(() => {
    return getScrollHeight(filter.data.length, scrollHeight)
  }, [filter.data.length, scrollHeight])

  const disableExpandAll = !filter.isAllExpanded && !isTableAtTop

  return (
    <div className={`space-y-6 ${className}`}>
      <TableFilters
        searchInput={filter.searchInput}
        onSearchInputChange={filter.setSearchInput}
        statusFilter={filter.statusFilter}
        onStatusFilterChange={filter.setStatusFilter}
        searchField={filter.searchField}
        onSearchFieldChange={filter.setSearchField}
        fuzzySearch={filter.fuzzySearch}
        onFuzzySearchChange={filter.setFuzzySearch}
        statusOptions={statusOptions}
        searchFieldOptions={searchFieldOptions}
        searchPlaceholder={searchPlaceholder}
        showFuzzySearch={showFuzzySearch}
      />

      <Card className="overflow-hidden">
        <FilterTableHeader
          title={title}
          displayCount={filter.displayCount}
          enableExpandAll={enableExpandAll}
          isAllExpanded={filter.isAllExpanded}
          onToggleExpandAll={filter.toggleExpandAll}
          disableExpandAll={disableExpandAll}
        />
        <CardContent className="p-0">
          <FilterTableContent
            emptyText={emptyText}
            enableExpandAll={enableExpandAll}
            filter={filter}
            noteField={noteField}
            renderExpandedRow={renderExpandedRow}
            scrollHeight={calculatedScrollHeight}
            setIsTableAtTop={setIsTableAtTop}
            statusOptions={statusOptions}
            table={table}
            tableId={tableId}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default FilterTable
