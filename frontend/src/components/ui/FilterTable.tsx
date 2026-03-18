/**
 * 通用筛选表格组件
 * 集成搜索/筛选、分页、表格列配置、展开/收起等功能
 */
import React, { useEffect, useMemo, useRef, useState } from 'react' // <--- 新增 useState
import {
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { RowData, ColumnDef } from '@tanstack/react-table'
import { useLocation } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { TableFilters, TableEmptyState } from '@/components/ui/TableFilters'
import { Button } from '@/components/ui/Button'
import { ChevronsDownUp, ChevronsUpDown, Loader2 } from 'lucide-react'

import { useTableState, DEFAULT_STATUS_OPTIONS, DEFAULT_SEARCH_FIELD_OPTIONS } from '@/hooks/useTableState'
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
  emptyText = '暂无数据'
}: Readonly<FilterTableProps>) {
  const location = useLocation()

  // 🚀 防御性引用：防止父组件传内联函数引起 Meta 频繁更新导致子树重新渲染
  const onEditRef = useRef(onEdit)
  const onBorrowSuccessRef = useRef(onBorrowSuccess)
  useEffect(() => {
    onEditRef.current = onEdit
    onBorrowSuccessRef.current = onBorrowSuccess
  }, [onEdit, onBorrowSuccess])

  // 新增：用于跟踪表格是否滚动在顶部
  const [isTableAtTop, setIsTableAtTop] = useState(true)

  const initialUrlSearchState = useMemo(() => {
    const query = new URLSearchParams(location.search)
    const nextSearch = query.get('search')?.trim() ?? ''
    const nextField = query.get('field')?.trim() ?? ''
    const hasValidField = searchFieldOptions.some((option) => option.value === nextField)

    return {
      search: nextSearch,
      field: hasValidField ? nextField : defaultSearchField,
      hasQuery: query.has('search') || query.has('field'),
    }
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

  // 🚀 此处需要父组件配合，若使用 customColumns 需确保是稳定的引用，不过组件内已做尽可能的降级兼容
  const tableColumns = useMemo(() => {
    if (customColumns && customColumns.length > 0) {
      return customColumns
    }
    return getInventoryTableColumns() as ColumnDef<Record<string, unknown>, unknown>[]
  }, [customColumns])

  const lastAppliedSearchRef = useRef<string>(location.search)

  useEffect(() => {
    if (location.search === lastAppliedSearchRef.current) return

    if (!location.search) {
      filter.applySearchImmediate('', defaultSearchField)
      lastAppliedSearchRef.current = location.search
      return
    }

    if (!initialUrlSearchState.hasQuery) return

    filter.applySearchImmediate(initialUrlSearchState.search, initialUrlSearchState.field)
    lastAppliedSearchRef.current = location.search
  }, [
    filter.applySearchImmediate,
    initialUrlSearchState.field,
    initialUrlSearchState.hasQuery,
    initialUrlSearchState.search,
    location.search,
    defaultSearchField
  ])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    defaultColumn: {
      sortDescFirst: false,
      sortingFn: 'text',
    },
    data: filter.data as Record<string, unknown>[],
    columns: tableColumns,
    getRowId: (row, index) => {
      if (row.id !== undefined && row.id !== null) return String(row.id)
      if (row.uuid !== undefined && row.uuid !== null) return String(row.uuid)
      return String(index)
    },
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
      onEdit: (item) => onEditRef.current?.(item), // 🚀 使用稳定引用
      onBorrowSuccess: () => onBorrowSuccessRef.current?.(), // 🚀 使用稳定引用
    },
  })

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

    if (hasFilterChanged) {
      table.resetExpanded()
      if (enableExpandAll && filter.isAllExpanded) {
        table.toggleAllRowsExpanded(true)
      }
      prevFiltersRef.current = current
    }
  }, [
    filter.globalFilter,
    filter.statusFilter,
    filter.searchField,
    filter.fuzzySearch,
    filter.sorting,
    filter.isAllExpanded,
    enableExpandAll,
    table
  ])

  const calculatedScrollHeight = useMemo(() => {
    if (scrollHeight !== undefined) return scrollHeight
    const rowCount = filter.data.length
    if (rowCount <= 10) return 'auto'
    return 'calc(100vh - 112px - 16px)'
  }, [filter.data.length, scrollHeight])

  // 计算展开全部按钮是否应该被禁用
  // 规则：如果没有全展开 且 表格没有滚动到顶部，则禁用展开操作
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
        {title && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {title}
              <span className="text-muted-foreground font-normal">
                (&thinsp;{filter.displayCount}&thinsp;)
              </span>
              {enableExpandAll && (
                <Button
                  variant="morden"
                  size="lg"
                  onClick={filter.toggleExpandAll}
                  disabled={disableExpandAll}
                  className={`ml-auto flex font-normal transition-all ${disableExpandAll ? 'text-muted-foreground opacity-60' : ''
                    }`}
                >
                  {filter.isAllExpanded ? (
                    <><ChevronsDownUp className="size-4 -ml-0.5 mr-1.5" />收起全部</>
                  ) : (
                    <><ChevronsUpDown className="size-4 -ml-0.5 mr-1.5" />展开全部</>
                  )}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="p-0">
          {filter.isLoading && filter.data.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            </div>
          ) : filter.data.length === 0 ? (
            <TableEmptyState
              searchKeyword={filter.globalFilter}
              statusFilter={filter.statusFilter}
              hasFilter={filter.hasFilter}
              emptyText={emptyText}
            />
          ) : (
            <div className="px-6">
              <DataTable
                table={table}
                renderExpandedRow={renderExpandedRow}
                scrollHeight={calculatedScrollHeight}
                enableExpandAll={enableExpandAll}
                expandAllStorageKey={`${tableId}-expand-all`}
                noteField={noteField}
                isAllExpanded={filter.isAllExpanded}
                onToggleExpandAll={filter.toggleExpandAll}
                hasNextPage={filter.hasNextPage}
                isFetchingNextPage={filter.isFetchingNextPage}
                fetchNextPage={filter.fetchNextPage}
                total={filter.total}
                searchKeyword={filter.globalFilter}
                onIsAtTopChange={setIsTableAtTop} // 新增：接收子组件的滚动状态
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default FilterTable