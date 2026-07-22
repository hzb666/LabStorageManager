import React, { useRef, useCallback, useState, useEffect } from 'react'
import type { SortingState, Table as TableType } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getExpandAllState, setExpandAllState } from '@/lib/storage/appTableStorage'
import { useColumnResize } from '@/hooks/useColumnResize'
import { useBulkExpand } from '@/hooks/useBulkExpand'
import { useDataTableScroll, useSyncVirtualizerRef } from '@/hooks/useDataTableScroll'
import { DataTableHeader } from '@/components/ui/DataTableHeader'
import { DataTableBody } from '@/components/ui/DataTableBody'

interface DataTableProps<TData> {
  table: TableType<TData>
  renderExpandedRow?: (row: TData) => React.ReactNode
  estimatedRowHeight?: number
  scrollHeight?: number | string
  enableExpandAll?: boolean
  expandAllStorageKey?: string
  isAllExpanded?: boolean
  onToggleExpandAll?: () => void
  disableExpandedRowAnimation?: boolean
  noteField?: string
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  total?: number
  searchKeyword?: string
  endMessage?: string
  onIsAtTopChange?: (isAtTop: boolean) => void
}

type ColumnCssVariableKey =
  | `--col-${string}-flex`
  | `--col-${string}-min`
  | `--col-${string}-display`

type ColumnCssVariables = Partial<Record<ColumnCssVariableKey, string>>

function getOverscanCount(isBulkAnimating: boolean, isAllExpanded: boolean) {
  if (isBulkAnimating) return 4
  if (isAllExpanded) return 5
  return 10
}

// 用 CSS 变量共享列宽和隐藏态，避免表头与表体各算一套布局。
function computeCssVariables<TData>(
  visibleColumns: ReturnType<TableType<TData>['getVisibleLeafColumns']>,
): React.CSSProperties & ColumnCssVariables {
  const styles: React.CSSProperties & ColumnCssVariables = {}
  visibleColumns.forEach((column) => {
    const size = column.getSize()
    const minSize = column.columnDef.minSize ?? 50
    styles[`--col-${column.id}-flex`] = size === 0 ? 'none' : `${size} 0 0%`
    styles[`--col-${column.id}-min`] = `${minSize}px`
    styles[`--col-${column.id}-display`] = size === 0 ? 'none' : 'flex'
  })
  return styles
}

// 表体滚动条会影响表头对齐；排序切换后也需要回到新的结果顶部。
function useDataTableViewportEffects(
  bodyScrollRef: React.RefObject<HTMLDivElement | null>,
  sortingState: SortingState,
) {
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return

    const updateScrollbar = () => {
      const width = el.offsetWidth - el.clientWidth
      setScrollbarWidth((prev) => (prev === width ? prev : width))
    }

    updateScrollbar()
    const observer = new ResizeObserver(() => requestAnimationFrame(updateScrollbar))
    observer.observe(el)
    return () => observer.disconnect()
  }, [bodyScrollRef])

  useEffect(() => {
    if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0
  }, [bodyScrollRef, sortingState])

  return scrollbarWidth
}

// 组合表头、表体和行为 hooks，负责渲染完整的数据表格容器。
export function DataTable<TData>({
  table,
  renderExpandedRow,
  estimatedRowHeight = 57,
  scrollHeight = 600,
  enableExpandAll = false,
  expandAllStorageKey,
  isAllExpanded: externalIsAllExpanded,
  onToggleExpandAll,
  disableExpandedRowAnimation,
  noteField,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  total,
  searchKeyword,
  endMessage,
  onIsAtTopChange,
}: Readonly<DataTableProps<TData>>) {
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  const isControlled = externalIsAllExpanded !== undefined && onToggleExpandAll !== undefined
  const [internalIsAllExpanded] = useState<boolean>(() => {
    if (!enableExpandAll || !expandAllStorageKey) return false
    return getExpandAllState(expandAllStorageKey, false)
  })

  const isAllExpanded = isControlled ? externalIsAllExpanded : internalIsAllExpanded
  const sortingState = table.getState().sorting
  const scrollbarWidth = useDataTableViewportEffects(bodyScrollRef, sortingState)

  useEffect(() => {
    // 受控展开态由外层驱动；本地回写限定在非受控场景，防止本地存储与父级双写冲突。
    if (!isControlled && enableExpandAll && expandAllStorageKey) {
      setExpandAllState(expandAllStorageKey, isAllExpanded)
    }
  }, [isAllExpanded, enableExpandAll, expandAllStorageKey, isControlled])

  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()
  const totalWeight = visibleColumns.reduce((sum, col) => sum + col.getSize(), 0)
  const minTableWidth = visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)
  const cssVariableStyles = computeCssVariables(visibleColumns)

  const { resizingColId, handleCustomResize } = useColumnResize({
    table, visibleColumns, totalWeight, minTableWidth, bodyScrollRef,
  })

  const { isBulkAnimating, bulkExpandedSnapshotRef, setVirtualizer } = useBulkExpand({
    table,
    rows,
    enableExpandAll,
    isAllExpanded,
    disableBulkExpandAnimation: disableExpandedRowAnimation,
    bodyScrollRef,
  })

  const { handleContainerScroll, handleRowClick, setVirtualizerForScroll } = useDataTableScroll<TData>({
    bodyScrollRef, headerScrollRef, hasNextPage, isFetchingNextPage, fetchNextPage, onIsAtTopChange,
  })

  const shouldUseVirtualization = scrollHeight !== 'auto'

  // 根据展开态和批量动画快照估算当前行高，保证虚拟列表测量稳定。
  const estimateRowSize = useCallback((index: number) => {
    const row = rows[index]
    if (!row) return estimatedRowHeight

    const expandedEstimate = estimatedRowHeight + 125
    const snapshot = bulkExpandedSnapshotRef.current

    if (disableExpandedRowAnimation && isAllExpanded) {
      return expandedEstimate
    }

    if (isBulkAnimating && snapshot) {
      return snapshot.has(row.id) ? expandedEstimate : estimatedRowHeight
    }
    return row.getIsExpanded() ? expandedEstimate : estimatedRowHeight
  }, [
    rows,
    estimatedRowHeight,
    isBulkAnimating,
    bulkExpandedSnapshotRef,
    disableExpandedRowAnimation,
    isAllExpanded,
  ])

  // 为虚拟列表提供稳定的 item key，避免展开/折叠时错位复用。
  const getRowItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])

  const overscanCount = getOverscanCount(isBulkAnimating, isAllExpanded)

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: estimateRowSize,
    overscan: overscanCount,
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: getRowItemKey,
  })

  // 批量展开和滚动逻辑消费同一个 virtualizer，保证测量和滚动基准一致。
  useEffect(() => { setVirtualizer(rowVirtualizer) }, [rowVirtualizer, setVirtualizer])
  useSyncVirtualizerRef(rowVirtualizer, setVirtualizerForScroll)

  return (
    <div
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      style={{
        height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight,
        ...cssVariableStyles,
      }}
    >
      <DataTableHeader
        table={table}
        headerScrollRef={headerScrollRef}
        scrollbarWidth={scrollbarWidth}
        minTableWidth={minTableWidth}
        resizingColId={resizingColId}
        handleCustomResize={handleCustomResize}
      />

      <div
        ref={bodyScrollRef}
        className="w-full overflow-auto custom-scrollbar relative flex-1"
        style={{ scrollbarGutter: 'stable' }}
        onScroll={handleContainerScroll}
      >
        <DataTableBody
          rows={rows}
          renderExpandedRow={renderExpandedRow}
          disableExpandedRowAnimation={disableExpandedRowAnimation}
          noteField={noteField}
          shouldUseVirtualization={shouldUseVirtualization}
          rowVirtualizer={rowVirtualizer}
          minTableWidth={minTableWidth}
          handleRowClick={handleRowClick}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          total={total}
          searchKeyword={searchKeyword}
          endMessage={endMessage}
        />
      </div>
    </div>
  )
}
