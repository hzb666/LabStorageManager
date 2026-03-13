/**
 * 通用筛选表格组件
 * 集成搜索/筛选、分页、表格列配置、展开/收起等功能
 */
import React, { useEffect, useMemo, useRef } from 'react'
import {
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { RowData, ColumnDef } from '@tanstack/react-table'
import { useLocation } from 'react-router-dom'

// UI 组件
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { TableFilters, TableEmptyState } from '@/components/ui/TableFilters'
import { Button } from '@/components/ui/Button'
import { ChevronsDownUp, ChevronsUpDown, Loader2 } from 'lucide-react'

// Hooks
import { useTableState, DEFAULT_STATUS_OPTIONS, DEFAULT_SEARCH_FIELD_OPTIONS } from '@/hooks/useTableState'
import type { FilterAPI, FilterOption, SearchFieldOption } from '@/hooks/useTableState'

// 表格列配置
import { getInventoryTableColumns } from '@/lib/tableConfigs'

// 扩展 TanStack Table 的 Meta 类型
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    fuzzySearch: boolean
    onEdit?: (item: TData) => void
    onBorrowSuccess?: () => void
  }
}

// 组件 Props
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

  const tableColumns = useMemo(() => {
    if (customColumns && customColumns.length > 0) {
      return customColumns
    }
    return getInventoryTableColumns() as ColumnDef<Record<string, unknown>, unknown>[]
  }, [customColumns])

  const lastAppliedSearchRef = useRef<string>(location.search)

  useEffect(() => {
    if (location.search === lastAppliedSearchRef.current) {
      return
    }

    if (!location.search) {
      filter.applySearchImmediate('', defaultSearchField)
      lastAppliedSearchRef.current = location.search
      return
    }

    if (!initialUrlSearchState.hasQuery) {
      return
    }

    filter.applySearchImmediate(initialUrlSearchState.search, initialUrlSearchState.field)
    lastAppliedSearchRef.current = location.search
  }, [
    filter.applySearchImmediate,
    initialUrlSearchState.field,
    initialUrlSearchState.hasQuery,
    initialUrlSearchState.search,
    location.search,
  ])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    defaultColumn: {
      // 1. 强制点击循环为：无 -> 升序 (asc) -> 降序 (desc) -> 无
      sortDescFirst: false,
      // 2. 使用 alphanumeric 替代默认 text，对中英混排支持更佳
      sortingFn: 'text',
    },
    data: filter.data as Record<string, unknown>[],
    columns: tableColumns,
    // 修复 1：绝对不能用 Math.random()，改用 id，若无 id 则用稳定的 index 兜底
    getRowId: (row, index) => {
      if (row.id !== undefined && row.id !== null) return String(row.id)
      if (row.uuid !== undefined && row.uuid !== null) return String(row.uuid)
      return String(index)
    },
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true, // 允许所有行展开
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
      onEdit: onEdit ?? undefined,
      onBorrowSuccess: onBorrowSuccess ?? undefined,
    },
  })

  // 严格控制重置展开状态的时机，防止意外折叠单行
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

  // 根据数据条数动态计算表格高度
  // 数据少时使用 'auto' 让内容自然撑开，展开行时也能自适应
  const calculatedScrollHeight = useMemo(() => {
    // 如果外部传入了 scrollHeight，优先使用外部值
    if (scrollHeight !== undefined) {
      return scrollHeight
    }
    
    const rowCount = filter.data.length
    
    // 数据少时（<=10行）使用 'auto' 让内容自然撑开
    // 这样展开行时高度也会自适应，无需手动计算
    if (rowCount <= 10) {
      return 'auto'
    }
    
    // 数据多时使用默认的大高度
    return 'calc(100vh - 112px - 16px)'
  }, [filter.data.length, scrollHeight])

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 搜索与筛选区域 - 卡片外 */}
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

      {/* 数据表格区域 - 卡片内 */}
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
                  // 修复 2：直接使用 filter 内部的切换逻辑，将具体表格操作交回 DataTable 组件内部处理，避免双重触发
                  onClick={filter.toggleExpandAll}
                  className="ml-auto flex font-normal"
                >
                  {filter.isAllExpanded ? (
                    <><ChevronsDownUp className="size-4 mr-1.5" />收起全部</>
                  ) : (
                    <><ChevronsUpDown className="size-4 mr-1.5" />展开全部</>
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
                onToggleExpandAll={filter.toggleExpandAll} // 这里同样使用 filter 的原版 toggle
                hasNextPage={filter.hasNextPage}
                isFetchingNextPage={filter.isFetchingNextPage}
                fetchNextPage={filter.fetchNextPage}
                total={filter.total}
                searchKeyword={filter.globalFilter}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default FilterTable
