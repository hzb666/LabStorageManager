import React, { useRef, useCallback, useState, useEffect } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Table as TableType, Row, Cell, Column } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useMobile'

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
  renderExpandAllControls?: (props: {
    isExpanded: boolean
    toggle: () => void
    expandAll: () => void
    collapseAll: () => void
  }) => React.ReactNode
}

// --- 单行组件：全动态测算与 Headless 布局 ---
function HeadlessVirtualRow<TData>({
  row,
  virtualRow,
  measureRef,
  renderExpandedRow,
  getProportionalStyles,
  noteField,
}: {
  row: Row<TData>
  virtualRow: { index: number; start: number }
  measureRef: (el: HTMLDivElement | null) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  getProportionalStyles: (column: Column<TData, unknown>) => React.CSSProperties
  noteField?: string
}) {
  const isExpanded = row.getIsExpanded()
  const original = row.original as TData
  
  const hasNote = noteField ? Boolean((original as Record<string, unknown>)?.[noteField]) : false

  return (
    <div
      ref={measureRef}
      data-index={virtualRow.index}
      className="absolute top-0 left-0 w-full"
      style={{ transform: `translateY(${virtualRow.start}px)` }}
    >
      <div
        className={cn(
          "flex w-full cursor-pointer transition-colors items-center hover:bg-accent dark:hover:bg-input border-b",
          isExpanded ? "border-transparent" : "border-border"
        )}
        onClick={row.getToggleExpandedHandler()}
      >
        {row.getVisibleCells().map((cell: Cell<TData, unknown>, index: number) => {
          
          const isFirstCol = index === 0;
          const showAccentLine = isFirstCol && hasNote && !isExpanded;

          return (
            <div
              key={cell.id}
              className={cn(
                "p-3 text-base break-all flex items-center relative transition-colors",
                // 修复1：第一列始终保留真实的边框占位，永远不挤压文字
                isFirstCol && "border-l-4 border-transparent"
              )}
              style={getProportionalStyles(cell.column)}
            >
              {/* 修复1：在透明边框的位置上，盖一个可以任意调整高度的绝对定位条 */}
              {showAccentLine && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[75%] bg-slate-300 dark:bg-slate-500 rounded-r-[2px]" />
              )}
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {isExpanded && renderExpandedRow && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden bg-muted/30 border-b dark:bg-input/30 border-border"
          >
            {renderExpandedRow(original)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- 列表主容器：容器级虚拟滚动 ---
export function DataTable<TData>({
  table,
  renderExpandedRow,
  estimatedRowHeight = 53,
  scrollHeight = 600,
  enableExpandAll = false,
  expandAllStorageKey,
  isAllExpanded: externalIsAllExpanded,
  onToggleExpandAll,
  noteField,
}: DataTableProps<TData>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  const [resizingColId, setResizingColId] = useState<string | null>(null)
  
  const isControlled = externalIsAllExpanded !== undefined && onToggleExpandAll !== undefined
  const [internalIsAllExpanded] = useState<boolean>(() => {
    if (!enableExpandAll || !expandAllStorageKey) return false
    try {
      const saved = localStorage.getItem(expandAllStorageKey)
      return saved === 'expanded'
    } catch {
      return false
    }
  })
  
  const isAllExpanded = isControlled ? externalIsAllExpanded : internalIsAllExpanded

  useEffect(() => {
    if (enableExpandAll && expandAllStorageKey) {
      localStorage.setItem(expandAllStorageKey, isAllExpanded ? 'expanded' : 'collapsed')
    }
  }, [isAllExpanded, enableExpandAll, expandAllStorageKey])

  useEffect(() => {
    if (!enableExpandAll) return
    
    const rows = table.getRowModel().rows
    rows.forEach(row => {
      if (isAllExpanded && !row.getIsExpanded()) {
        row.toggleExpanded(true)
      } else if (!isAllExpanded && row.getIsExpanded()) {
        row.toggleExpanded(false)
      }
    })
  }, [isAllExpanded, enableExpandAll, table])
  
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return

    const updateScrollbar = () => {
      const width = el.offsetWidth - el.clientWidth
      setScrollbarWidth((prev) => (prev === width ? prev : width))
    }

    updateScrollbar()
    const observer = new ResizeObserver(() => updateScrollbar())
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const isMobile = useIsMobile()
  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()

  const totalWeight = visibleColumns.reduce((sum, col) => sum + col.getSize(), 0)
  const minTableWidth = visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)

  const getProportionalStyles = useCallback((column: Column<TData, unknown>): React.CSSProperties => {
    const size = column.getSize()
    if (size === 0) return { display: 'none' }

    const widthPercent = (size / totalWeight) * 100
    const minSize = column.columnDef.minSize ?? 50

    return {
      flex: `0 0 ${widthPercent}%`,
      width: `${widthPercent}%`,
      minWidth: `${minSize}px`,
      boxSizing: 'border-box',
    }
  }, [totalWeight])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: any) => {
    e.preventDefault()
    e.stopPropagation()

    const currentIndex = visibleColumns.findIndex(c => c.id === header.column.id)
    const leftCol = visibleColumns[currentIndex]
    const rightCol = visibleColumns[currentIndex + 1]

    if (!leftCol || !rightCol) return

    const startX = e.type === 'touchstart' ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX
    const startLeftSize = leftCol.getSize()
    const startRightSize = rightCol.getSize()

    const leftMin = leftCol.columnDef.minSize ?? 50
    const leftMax = leftCol.columnDef.maxSize ?? 9999
    const rightMin = rightCol.columnDef.minSize ?? 50
    const rightMax = rightCol.columnDef.maxSize ?? 9999

    const tablePxWidth = Math.max(bodyScrollRef.current?.clientWidth || 0, minTableWidth)
    const pixelPerWeight = tablePxWidth / totalWeight

    setResizingColId(header.column.id)

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = moveEvent.type === 'touchmove'
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX

      const deltaX = currentX - startX
      const deltaWeight = deltaX / pixelPerWeight

      let newLeft = startLeftSize + deltaWeight
      let newRight = startRightSize - deltaWeight

      if (newLeft < leftMin) {
        newLeft = leftMin
        newRight = startRightSize + (startLeftSize - leftMin)
      }
      if (newRight < rightMin) {
        newRight = rightMin
        newLeft = startLeftSize + (startRightSize - rightMin)
      }
      if (newLeft > leftMax) {
        newLeft = leftMax
        newRight = startRightSize - (leftMax - startLeftSize)
      }
      if (newRight > rightMax) {
        newRight = rightMax
        newLeft = startLeftSize - (rightMax - startRightSize)
      }

      table.setColumnSizing(old => ({
        ...old,
        [leftCol.id]: newLeft,
        [rightCol.id]: newRight
      }))
    }

    const onUp = () => {
      setResizingColId(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onUp)
  }, [visibleColumns, totalWeight, minTableWidth, table])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
    getScrollElement: () => bodyScrollRef.current,
  })


  return (
    <div
      ref={scrollContainerRef}
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      style={{ height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight }}
    >
      {/* 表头区 */}
      <div 
        className="z-30 w-full rounded-t-md bg-card"
        style={{ paddingRight: `${scrollbarWidth}px` }} // 让出滚动条位置
      >
        {/* 修复2：把 border-b-2 移到内部的 div 上，这样边框到 padding 处就会截止，不会盖住滚动条 */}
        <div className="w-full border-b-2 border-border">
          <div ref={headerScrollRef} className="w-full overflow-hidden">
            <div 
              className="flex w-full"
              style={{ minWidth: `${minTableWidth}px` }} 
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <React.Fragment key={headerGroup.id}>
                  {headerGroup.headers.map((header, index) => {
                    const canSort = header.column.getCanSort()
                    const isSorted = header.column.getIsSorted()
                    const isResizing = resizingColId === header.column.id

                    return (
                      <div
                        key={header.id}
                        className={cn(
                          "relative p-3 mt-3 font-semibold text-foreground flex items-center group select-none hover:bg-accent dark:hover:bg-input transition-colors rounded-t-md",
                          index === 0 && "border-l-4 border-transparent"
                        )}
                        style={getProportionalStyles(header.column)}
                      >
                        <div
                          className={cn("flex items-center gap-1.5 w-full", canSort && "cursor-pointer")}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="truncate">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          {canSort && (
                            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-muted-foreground">
                              {isSorted === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : 
                               isSorted === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : 
                               <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />}
                            </span>
                          )}
                        </div>

                        {(() => {
                          const canResize = header.column.getCanResize() && header.index !== headerGroup.headers.length - 1
                          return canResize && !isMobile
                        })() && (
                          <div
                            onMouseDown={(e) => handleCustomResize(e, header)}
                            onTouchStart={(e) => handleCustomResize(e, header)}
                            onDoubleClick={() => table.resetColumnSizing()}
                            title="拖拽调整比例 (双击恢复默认)"
                            className={cn(
                              "absolute right-0 top-0 h-full w-1 cursor-col-resize z-10 touch-none transition-all opacity-0 group-hover:opacity-100",
                              isResizing ? "bg-primary/70 opacity-100 w-1.5" : "hover:bg-primary/50",
                              isResizing && header.getSize() === (header.column.columnDef.minSize ?? 50) && "bg-destructive/70",
                              isResizing && header.column.columnDef.maxSize && header.getSize() === header.column.columnDef.maxSize && "bg-destructive/70"
                            )}
                          />
                        )}
                      </div>
                    )
                  })}
                  {headerGroup.id === table.getHeaderGroups()[table.getHeaderGroups().length - 1].id && (
                    null
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 表体区 */}
      <div
        ref={bodyScrollRef}
        className="w-full overflow-auto custom-scrollbar relative flex-1"
        style={{ scrollbarGutter: 'stable' }}
        onScroll={(e) => {
          if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            minWidth: `${minTableWidth}px`,
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <HeadlessVirtualRow
                key={row.id}
                row={row}
                virtualRow={virtualRow}
                measureRef={rowVirtualizer.measureElement}
                renderExpandedRow={renderExpandedRow}
                getProportionalStyles={getProportionalStyles}
                noteField={noteField}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}