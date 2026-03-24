// DataTable.tsx
import React, { useRef, useCallback, useState, useEffect } from 'react'
import type { Table as TableType } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getExpandAllState, setExpandAllState } from '@/lib/tableExpandStorage'
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
  noteField?: string
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  total?: number
  searchKeyword?: string
  onIsAtTopChange?: (isAtTop: boolean) => void
}

type ColumnCssVariableKey =
  | `--col-${string}-flex`
  | `--col-${string}-min`
  | `--col-${string}-display`

type ColumnCssVariables = Partial<Record<ColumnCssVariableKey, string>>

/** 计算 CSS 变量样式对象 */
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

/** 组合表头、表体和行为 hooks，负责渲染完整的数据表格容器。 */
export function DataTable<TData>({
  table,
  renderExpandedRow,
  estimatedRowHeight = 56.8,
  scrollHeight = 600,
  enableExpandAll = false,
  expandAllStorageKey,
  isAllExpanded: externalIsAllExpanded,
  onToggleExpandAll,
  noteField,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  total,
  searchKeyword,
  onIsAtTopChange,
}: Readonly<DataTableProps<TData>>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  const isControlled = externalIsAllExpanded !== undefined && onToggleExpandAll !== undefined
  const [internalIsAllExpanded] = useState<boolean>(() => {
    if (!enableExpandAll || !expandAllStorageKey) return false
    return getExpandAllState(expandAllStorageKey, false)
  })

  const isAllExpanded = isControlled ? externalIsAllExpanded : internalIsAllExpanded
  const sortingState = table.getState().sorting

  useEffect(() => {
    if (!isControlled && enableExpandAll && expandAllStorageKey) {
      setExpandAllState(expandAllStorageKey, isAllExpanded)
    }
  }, [isAllExpanded, enableExpandAll, expandAllStorageKey, isControlled])

  // 滚动条宽度检测
  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return

    // 计算原生滚动条宽度，给表头预留对齐空间。
    const updateScrollbar = () => {
      const width = el.offsetWidth - el.clientWidth
      setScrollbarWidth((prev) => (prev === width ? prev : width))
    }

    updateScrollbar()
    const observer = new ResizeObserver(() => requestAnimationFrame(updateScrollbar))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 排序变化时滚动到顶部
  useEffect(() => {
    if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0
  }, [sortingState])

  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()
  const totalWeight = visibleColumns.reduce((sum, col) => sum + col.getSize(), 0)
  const minTableWidth = visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)
  const cssVariableStyles = computeCssVariables(visibleColumns)

  // ========== Hooks ==========
  const { resizingColId, handleCustomResize } = useColumnResize({
    table, visibleColumns, totalWeight, minTableWidth, bodyScrollRef,
  })

  const { isBulkAnimating, bulkExpandedSnapshotRef, setVirtualizer } = useBulkExpand({
    table, rows, enableExpandAll, isAllExpanded, bodyScrollRef,
  })

  const { handleInfiniteScroll, handleRowClick, setVirtualizerForScroll } = useDataTableScroll<TData>({
    bodyScrollRef, hasNextPage, isFetchingNextPage, fetchNextPage,
  })

  // ========== Virtualizer ==========
  const shouldUseVirtualization = scrollHeight !== 'auto'

  // 根据展开态和批量动画快照估算当前行高，保证虚拟列表测量稳定。
  const estimateRowSize = useCallback((index: number) => {
    const row = rows[index]
    if (!row) return estimatedRowHeight

    const expandedEstimate = estimatedRowHeight + 124.8
    const snapshot = bulkExpandedSnapshotRef.current

    if (isBulkAnimating && snapshot) {
      return snapshot.has(row.id) ? expandedEstimate : estimatedRowHeight
    }
    return row.getIsExpanded() ? expandedEstimate : estimatedRowHeight
  }, [rows, estimatedRowHeight, isBulkAnimating, bulkExpandedSnapshotRef])

  // 为虚拟列表提供稳定的 item key，避免展开/折叠时错位复用。
  const getRowItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])

  const overscanCount = isBulkAnimating ? 4 : isAllExpanded ? 5 : 10 // eslint-disable-line sonarjs/no-nested-conditional

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: estimateRowSize,
    overscan: overscanCount,
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: getRowItemKey,
  })

  // 同步 virtualizer 到 hooks
  useEffect(() => { setVirtualizer(rowVirtualizer) }, [rowVirtualizer, setVirtualizer])
  useSyncVirtualizerRef(rowVirtualizer, setVirtualizerForScroll)

  // ========== 容器滚动 ==========
  // 同步表头横向滚动、向上状态和无限加载触发。
  const handleContainerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
    if (onIsAtTopChange) onIsAtTopChange(e.currentTarget.scrollTop <= 2)
    handleInfiniteScroll()
  }, [handleInfiniteScroll, onIsAtTopChange])

  // ========== Render ==========
  return (
    <div
      ref={scrollContainerRef}
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
          noteField={noteField}
          shouldUseVirtualization={shouldUseVirtualization}
          rowVirtualizer={rowVirtualizer}
          minTableWidth={minTableWidth}
          handleRowClick={handleRowClick}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          total={total}
          searchKeyword={searchKeyword}
        />
      </div>
    </div>
  )
}
