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
}

// --- 单行组件：全动态测算与 Headless 布局 ---
function HeadlessVirtualRow<TData>({
  row,
  virtualRow,
  measureRef,
  renderExpandedRow,
  getProportionalStyles,
}: {
  row: Row<TData>
  virtualRow: { index: number; start: number }
  measureRef: (el: HTMLDivElement | null) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  getProportionalStyles: (column: Column<TData, unknown>) => React.CSSProperties
}) {
  const isExpanded = row.getIsExpanded()
  const original = row.original as TData

  return (
    <div
      ref={measureRef}
      data-index={virtualRow.index}
      className="absolute top-0 left-0 w-full"
      style={{ transform: `translateY(${virtualRow.start}px)` }}
    >
      <div
        className="flex w-full border-b border-border cursor-pointer transition-colors items-center hover:bg-accent dark:hover:bg-input"
        onClick={row.getToggleExpandedHandler()}
      >
        {row.getVisibleCells().map((cell: Cell<TData, unknown>) => (
          <div
            key={cell.id}
            className="p-3 text-base break-all"
            style={getProportionalStyles(cell.column)}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        ))}
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
}: DataTableProps<TData>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  const [resizingColId, setResizingColId] = useState<string | null>(null)
  
  // 核心修复 1：记录垂直滚动条的宽度
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  // 动态测量并同步滚动条宽度（兼容不同设备和系统）
  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return

    const updateScrollbar = () => {
      // offsetWidth 包含滚动条，clientWidth 不包含，两者的差值就是滚动条精准宽度
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

  // 样式计算器
  const getProportionalStyles = useCallback((column: Column<TData, unknown>): React.CSSProperties => {
    const size = column.getSize()
    if (size === 0) return { display: 'none' }

    const widthPercent = (size / totalWeight) * 100
    const minSize = column.columnDef.minSize ?? 50

    return {
      flex: `0 0 ${widthPercent}%`,
      width: `${widthPercent}%`,
      minWidth: `${minSize}px`,
      boxSizing: 'border-box', // 确保 padding 不会撑爆容器
    }
  }, [totalWeight])

  // 核心修复 2 & 3：完全自定义相邻列拉伸算法，解决光标偏移问题
  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: any) => {
    e.preventDefault()
    e.stopPropagation()

    const currentIndex = visibleColumns.findIndex(c => c.id === header.column.id)
    const leftCol = visibleColumns[currentIndex]
    const rightCol = visibleColumns[currentIndex + 1]

    // 如果没有相邻的右侧列，不可拖拽
    if (!leftCol || !rightCol) return

    const startX = e.type === 'touchstart' ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX
    const startLeftSize = leftCol.getSize()
    const startRightSize = rightCol.getSize()

    const leftMin = leftCol.columnDef.minSize ?? 50
    const leftMax = leftCol.columnDef.maxSize ?? 9999
    const rightMin = rightCol.columnDef.minSize ?? 50
    const rightMax = rightCol.columnDef.maxSize ?? 9999

    // 使用 bodyScrollRef.clientWidth (已经扣除了滚动条宽度)，换算极其精准的像素比例
    const tablePxWidth = Math.max(bodyScrollRef.current?.clientWidth || 0, minTableWidth)
    const pixelPerWeight = tablePxWidth / totalWeight

    setResizingColId(header.column.id)

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = moveEvent.type === 'touchmove'
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX

      const deltaX = currentX - startX
      // 物理位移转为比例权重位移
      const deltaWeight = deltaX / pixelPerWeight

      let newLeft = startLeftSize + deltaWeight
      let newRight = startRightSize - deltaWeight

      // 强校验物理边界，左右此消彼长，总和绝对不变
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
      className="w-full bg-card rounded-md flex flex-col overflow-y-auto"
      style={{ height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight }}
    >
      {/* 表头区 */}
      <div 
        className="z-30 w-full border-b-2 border-border rounded-t-md"
        // 关键一步：把表体滚动条吃掉的像素，以 padding 的形式补偿给表头，强行对齐！
        style={{ paddingRight: `${scrollbarWidth}px` }}
      >
        <div ref={headerScrollRef} className="w-full overflow-hidden">
          <div 
            className="flex w-full"
            style={{ minWidth: `${minTableWidth}px` }} 
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <React.Fragment key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const isSorted = header.column.getIsSorted()
                  const isResizing = resizingColId === header.column.id

                  return (
                    <div
                      key={header.id}
                      className="relative p-3 mt-3 font-semibold text-foreground flex items-center group select-none hover:bg-accent dark:hover:bg-input transition-colors rounded-t-md"
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
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 表体区 */}
      <div
        ref={bodyScrollRef}
        className="w-full overflow-x-auto custom-scrollbar relative flex-1"
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
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}