// DataTable.tsx
import React, { useRef, useCallback, useState, useEffect, memo, useMemo } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Table as TableType, Row, Cell, Header } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useMobile'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'

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
}

interface MemoizedExpandedRowProps<TData> {
  original: TData;
  renderExpandedRow: (row: TData) => React.ReactNode;
}

const MemoizedExpandedRow = memo(
  <TData,>({ original, renderExpandedRow }: MemoizedExpandedRowProps<TData>) => {
    return <>{renderExpandedRow(original)}</>;
  },
  (prevProps, nextProps) => prevProps.original === nextProps.original
) as <TData>(props: MemoizedExpandedRowProps<TData>) => React.JSX.Element;

// 内部行组件
function InnerRowComponent<TData>({
  row,
  isExpanded,
  isAllExpanded, // 🚀 新增：接收全局展开状态
  renderExpandedRow,
  noteField,
  onRowClick,
}: Readonly<{
  row: Row<TData>
  isExpanded: boolean 
  isAllExpanded?: boolean
  renderExpandedRow?: (row: TData) => React.ReactNode
  noteField?: string
  onRowClick?: (e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => void
}>) {
  const original = row.original

  const noteValue = noteField
    ? (original as Record<string, unknown>)?.[noteField] as string | undefined
    : undefined
  const hasNote = Boolean(noteValue)
  const isHighlighted = noteValue?.startsWith('[强调]') || false

  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (onRowClick) {
        onRowClick(e, row)
      } else {
        row.toggleExpanded()
      }
    },
    [onRowClick, row]
  )

  return (
    <div className="w-full">
      <div
        className={cn(
          "flex w-full cursor-pointer transition-colors items-center hover:bg-accent dark:hover:bg-input border-b",
          isExpanded ? "border-transparent" : "border-border"
        )}
        onClick={handleToggle}
      >
        {row.getVisibleCells().map((cell: Cell<TData, unknown>, index: number) => {
          const isFirstCol = index === 0;
          const showAccentLine = isFirstCol && hasNote && !isExpanded;

          return (
            <div
              key={cell.id}
              className={cn(
                "p-3 text-base break-all flex items-center relative transition-colors",
                isFirstCol && "border-l-4 border-transparent"
              )}
              // 🚀 性能优化：直接读取挂载在父级的 CSS 变量，无需触发 React 重渲染
              style={{
                flex: `var(--col-${cell.column.id}-flex)`,
                minWidth: `var(--col-${cell.column.id}-min)`,
                display: `var(--col-${cell.column.id}-display)`
              }}
            >
              {isFirstCol && (
                <div
                  className={cn(
                    "absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[75%] rounded-r-[2px]",
                    isHighlighted ? "bg-amber-400 dark:bg-amber-600" : "bg-slate-300 dark:bg-slate-500",
                    "transition-all duration-300 ease-in-out origin-center",
                    showAccentLine ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"
                  )}
                />
              )}
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          )
        })}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && renderExpandedRow && (
          <motion.div
            // 🚀 性能优化：区分单行展开和全部展开，修复虚拟列表高度计算滞后导致的穿模
            initial={{ height: isAllExpanded ? "auto" : 0, opacity: isAllExpanded ? 1 : 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }} // 删除了 willChange 以保证同步 Reflow
            transition={{ duration: isAllExpanded ? 0 : 0.15, ease: "easeOut" }}
            className="bg-muted/30 border-b dark:bg-input/30 border-border"
          >
            <div>
              <MemoizedExpandedRow 
                original={original} 
                renderExpandedRow={renderExpandedRow} 
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 缓存 InnerRowComponent
const InnerRow = memo(InnerRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.row.id === nextProps.row.id && 
    prevProps.row.original === nextProps.row.original && 
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isAllExpanded === nextProps.isAllExpanded && // 🚀 纳入全局展开状态比较
    prevProps.renderExpandedRow === nextProps.renderExpandedRow &&
    prevProps.noteField === nextProps.noteField &&
    prevProps.onRowClick === nextProps.onRowClick
  )
}) as typeof InnerRowComponent

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
}: Readonly<DataTableProps<TData>>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const rAFRef = useRef<number | null>(null) // 🚀 新增：用于精准控制 rAF 节流

  const [resizingColId, setResizingColId] = useState<string | null>(null)
  
  const isControlled = externalIsAllExpanded !== undefined && onToggleExpandAll !== undefined
  const [internalIsAllExpanded] = useState<boolean>(() => {
    if (!enableExpandAll || !expandAllStorageKey) return false
    try {
      return localStorage.getItem(expandAllStorageKey) === 'expanded'
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
    table.toggleAllRowsExpanded(isAllExpanded)
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
    const observer = new ResizeObserver(() => requestAnimationFrame(updateScrollbar))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
  }, [table.getState().sorting]);

  const isMobile = useIsMobile()
  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()
  const columnSizing = table.getState().columnSizing

  const visibleColIds = useMemo(() => visibleColumns.map(c => c.id).join(','), [visibleColumns])

  const { totalWeight, minTableWidth } = useMemo(() => {
    return {
      totalWeight: visibleColumns.reduce((sum, col) => sum + col.getSize(), 0),
      minTableWidth: visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)
    }
  }, [visibleColIds, columnSizing])

  // 🚀 性能优化：生成 CSS 变量对象，替代原有行内 style
  const cssVariableStyles = useMemo(() => {
    const styles: Record<string, string> = {}
    visibleColumns.forEach(column => {
      const size = column.getSize()
      const minSize = column.columnDef.minSize ?? 50
      
      styles[`--col-${column.id}-flex`] = size === 0 ? 'none' : `${size} 0 0%`
      styles[`--col-${column.id}-min`] = `${minSize}px`
      styles[`--col-${column.id}-display`] = size === 0 ? 'none' : 'flex'
    })
    return styles as React.CSSProperties
  }, [visibleColIds, columnSizing])

  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: Header<TData, unknown>) => {
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
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current)
      
      rAFRef.current = requestAnimationFrame(() => {
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
        
        rAFRef.current = null
      })
    }

    const onUp = () => {
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current)
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

  const shouldUseVirtualization = scrollHeight !== 'auto'

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: useCallback((index: number) => {
      const row = rows[index]
      return row?.getIsExpanded() ? estimatedRowHeight + 124.8 : estimatedRowHeight
    }, [rows, estimatedRowHeight]),
    overscan: isAllExpanded ? 5 : 10,
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  })

  const virtualizerRef = useRef(rowVirtualizer)
  useEffect(() => { virtualizerRef.current = rowVirtualizer })

  const scrollLockRef = useRef(false)

  const handleScroll = useCallback(() => {
    if (scrollLockRef.current || !hasNextPage || isFetchingNextPage) return
    scrollLockRef.current = true
    requestAnimationFrame(() => {
      const el = bodyScrollRef.current
      const virtualizer = virtualizerRef.current
      if (el && virtualizer) {
        const { scrollTop, clientHeight } = el
        const totalHeight = virtualizer.getTotalSize()
        if (totalHeight - scrollTop - clientHeight < 200) fetchNextPage?.()
      }
      scrollLockRef.current = false
    })
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => {
    const isExpanding = !row.getIsExpanded()
    row.toggleExpanded()

    const el = bodyScrollRef.current
    const container = e.currentTarget.closest('[data-index]')

    if (isExpanding && el && container && virtualizerRef.current) {
      const index = Number(container.getAttribute('data-index'))
      const initialItem = virtualizerRef.current.getVirtualItems().find(v => v.index === index)
      
      if (initialItem && initialItem.start < el.scrollTop) {
        const targetY = initialItem.start
        const startY = el.scrollTop
        const distance = targetY - startY
        const duration = 300 
        let startTime: number | null = null
        let expectedScrollTop = startY
        
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

        const smoothScroll = (currentTime: number) => {
          if (!el) return
          if (Math.abs(el.scrollTop - expectedScrollTop) > 2) return
          if (!startTime) startTime = currentTime
          const elapsed = currentTime - startTime
          const progress = Math.min(elapsed / duration, 1)
          
          el.scrollTop = startY + distance * easeOutCubic(progress)
          expectedScrollTop = el.scrollTop 
          
          if (progress < 1) requestAnimationFrame(smoothScroll)
        }
        requestAnimationFrame(smoothScroll)
      }
    }
  }, [])

  const handleContainerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
    handleScroll()
  }, [handleScroll])

  return (
    <div
      ref={scrollContainerRef}
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      // 🚀 注入全局 CSS 变量用于列宽管理
      style={{ 
        height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight,
        ...cssVariableStyles 
      }}
    >
      <div 
        className="z-30 w-full rounded-t-md bg-card"
        style={{ paddingRight: `${scrollbarWidth}px` }} 
      >
        <div className="w-full border-b-2 border-border">
          <div ref={headerScrollRef} className="w-full overflow-hidden">
            <div className="flex w-full" style={{ minWidth: `${minTableWidth}px` }}>
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
                          "relative p-3 mt-3 font-bold text-foreground flex items-center group select-none hover:bg-accent dark:hover:bg-input transition-colors rounded-t-md",
                          index === 0 && "border-l-4 border-transparent"
                        )}
                        // 🚀 Header 同样读取 CSS 变量控制列宽
                        style={{
                          flex: `var(--col-${header.column.id}-flex)`,
                          minWidth: `var(--col-${header.column.id}-min)`,
                          display: `var(--col-${header.column.id}-display)`
                        }}
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
                            <span className="w-4 h-4 shrink-0 flex items-center justify-center text-muted-foreground">
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                onMouseDown={(e) => handleCustomResize(e, header)}
                                onTouchStart={(e) => handleCustomResize(e, header)}
                                onDoubleClick={() => table.resetColumnSizing()}
                                className={cn(
                                  "absolute right-0 top-1.5 h-full w-1 cursor-col-resize z-10 touch-none transition-all opacity-0 group-hover:opacity-100",
                                  isResizing ? "bg-primary/70 opacity-100 w-1.5" : "hover:bg-primary/50",
                                  isResizing && header.getSize() === (header.column.columnDef.minSize ?? 50) && "bg-destructive/70",
                                  isResizing && header.column.columnDef.maxSize && header.getSize() === header.column.columnDef.maxSize && "bg-destructive/70"
                                )}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p>拖拽调整列宽 (双击恢复默认)</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={bodyScrollRef}
        className="w-full overflow-auto custom-scrollbar relative flex-1"
        style={{ scrollbarGutter: 'stable' }}
        onScroll={handleContainerScroll}
      >
        <div
          style={{
            height: shouldUseVirtualization ? `${rowVirtualizer.getTotalSize()}px` : 'auto',
            width: "100%",
            minWidth: `${minTableWidth}px`,
            position: shouldUseVirtualization ? 'relative' : 'static'
          }}
        >
          {shouldUseVirtualization ? (
            rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>
                    <InnerRow
                      row={row}
                      isExpanded={row.getIsExpanded()} 
                      isAllExpanded={isAllExpanded} // 🚀 传递状态
                      renderExpandedRow={renderExpandedRow}
                      noteField={noteField}
                      onRowClick={handleRowClick}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            rows.map((row, index) => (
              <div key={row.id ?? index} className="w-full">
                <InnerRow
                  row={row}
                  isExpanded={row.getIsExpanded()} 
                  isAllExpanded={isAllExpanded} // 🚀 传递状态
                  renderExpandedRow={renderExpandedRow}
                  noteField={noteField}
                  onRowClick={handleRowClick}
                />
              </div>
            ))
          )}
        </div>
        
        {isFetchingNextPage && (
          <div className="flex items-center justify-center pt-4 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span>加载更多...</span>
          </div>
        )}
        
        {!hasNextPage && !isFetchingNextPage && (
          <div className="text-center pt-4 text-muted-foreground text-base">
            {total !== undefined && total > 0 
              ? `已加载全部 ${rows.length} 条记录` 
              : searchKeyword 
                ? `未找到匹配"${searchKeyword}"的记录`
                : '暂无数据'}
          </div>
        )}
      </div>
    </div>
  )
}