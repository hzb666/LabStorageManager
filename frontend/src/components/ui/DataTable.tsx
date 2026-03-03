import React, { useRef, useCallback, useState, useEffect, memo, useMemo } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Table as TableType, Row, Cell, Column } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react'
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
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  total?: number
  searchKeyword?: string  // 搜索关键词，用于区分无数据情况
}

// --- 性能优化：内层组件渲染隔离 ---
function InnerRowComponent<TData>({
  row,
  renderExpandedRow,
  getProportionalStyles,
  noteField,
  onRowClick,
}: {
  row: Row<TData>
  renderExpandedRow?: (row: TData) => React.ReactNode
  getProportionalStyles: (column: Column<TData, unknown>) => React.CSSProperties
  noteField?: string
  onRowClick?: (e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => void
}) {
  const isExpanded = row.getIsExpanded()
  const original = row.original as TData
  
  const hasNote = noteField ? Boolean((original as Record<string, unknown>)?.[noteField]) : false

  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (onRowClick) {
        onRowClick(e, row)
      } else {
        row.getToggleExpandedHandler()(e)
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
              style={getProportionalStyles(cell.column)}
            >
              <div 
                className={cn(
                  "absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[75%] bg-slate-300 dark:bg-slate-500 rounded-r-[2px]",
                  "transition-all duration-300 ease-in-out origin-center",
                  showAccentLine 
                    ? "opacity-100 scale-y-100" 
                    : "opacity-0 scale-y-0"
                )} 
              />
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          )
        })}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && renderExpandedRow && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ willChange: "height, opacity", overflow: "hidden" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="bg-muted/30 border-b dark:bg-input/30 border-border"
          >
            {renderExpandedRow(original)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const InnerRow = memo(InnerRowComponent) as typeof InnerRowComponent

// --- 列表主容器：容器级虚拟滚动 ---
export function DataTable<TData>({
  table,
  renderExpandedRow,
  estimatedRowHeight = 56.8, // 更新默认行高
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

  // 🚀 性能优化 1：批量展开
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
    const observer = new ResizeObserver(() => updateScrollbar())
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [table.getState().sorting]);

  const isMobile = useIsMobile()
  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()
  const columnSizing = table.getState().columnSizing

  // 🚀 性能优化 2：缓存列宽求和
  const { totalWeight, minTableWidth } = useMemo(() => {
    return {
      totalWeight: visibleColumns.reduce((sum, col) => sum + col.getSize(), 0),
      minTableWidth: visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)
    }
  }, [visibleColumns, columnSizing])

  // 🚀 性能优化 3：O(1) 预计算样式字典
  const columnStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {}
    visibleColumns.forEach(column => {
      const size = column.getSize()
      if (size === 0) {
        styles[column.id] = { display: 'none' }
        return
      }
      const widthPercent = (size / totalWeight) * 100
      const minSize = column.columnDef.minSize ?? 50
      styles[column.id] = {
        flex: `0 0 ${widthPercent}%`,
        width: `${widthPercent}%`,
        minWidth: `${minSize}px`,
        boxSizing: 'border-box',
      }
    })
    return styles
  }, [visibleColumns, totalWeight, columnSizing])

  const getProportionalStyles = useCallback((column: Column<TData, unknown>): React.CSSProperties => {
    return columnStyles[column.id] || {}
  }, [columnStyles])

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

    // 🚀 性能优化 4：拖拽 rAF 节流防掉帧
    let animationFrameId: number;

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      
      animationFrameId = requestAnimationFrame(() => {
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
      })
    }

    const onUp = () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
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

  // 🎯 修改处：动态处理 overscan 和 estimateSize
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: useCallback((index: number) => {
      const row = rows[index]
      // 动态判断该行是否展开，如果展开则返回基础高度 + 展开高度
      return row?.getIsExpanded() ? estimatedRowHeight + 124.8 : estimatedRowHeight
    }, [rows, estimatedRowHeight]),
    overscan: isAllExpanded ? 5 : 10, // 展开全部时降低 overscan 渲染量
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  })

  // 同步虚拟列表的 ref，供点击事件进行无依赖动态获取
  const virtualizerRef = useRef(rowVirtualizer)
  useEffect(() => {
    virtualizerRef.current = rowVirtualizer
  })

  const handleScroll = useCallback(() => {
    const el = bodyScrollRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return

    const { scrollTop, clientHeight } = el
    const totalHeight = rowVirtualizer.getTotalSize()
    
    if (totalHeight - scrollTop - clientHeight < 200) {
      fetchNextPage?.()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rowVirtualizer])

  // 🛡️ 终极核心修复：使用动态追踪插值（Dynamic Lerp）强力对抗虚拟列表滚动跳跃
  const handleRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => {
    const isExpanding = !row.getIsExpanded()
    row.toggleExpanded()

    if (isExpanding) {
      const el = bodyScrollRef.current
      const container = e.currentTarget.closest('[data-index]')
      
      if (el && container && virtualizerRef.current) {
        const index = Number(container.getAttribute('data-index'))
        const initialItem = virtualizerRef.current.getVirtualItems().find(v => v.index === index)
        
        // 只有当行在视口上方（被遮挡）时才触发动画
        if (initialItem && initialItem.start < el.scrollTop) {
          let startTime = performance.now()
          
          const animate = (time: number) => {
            if (!el || !virtualizerRef.current) return
            
            const elapsed = time - startTime
            
            // 🔥 关键魔术：每一帧都向虚拟列表索取该行的“最新坐标”
            // 彻底解决滚动回去重测导致的 Layout Shift 坐标偏移问题！
            const currentItem = virtualizerRef.current.getVirtualItems().find(v => v.index === index)
            // 如果瞬间找不到（极低概率），回退到上一次的已知坐标
            const targetY = currentItem ? currentItem.start : initialItem.start
            
            // 计算当前距离目标的差值
            const diff = targetY - el.scrollTop
            
            // 动画执行 400ms (完全覆盖 motion 的 300ms) 或距离 < 1px 时直接吸附停止
            if (elapsed > 400 || Math.abs(diff) < 1) {
              el.scrollTop = targetY
              return
            }
            
            // 丝滑缓动算法：每帧追赶剩余距离的 15%
            // 如果虚拟列表突然把 targetY 往下挪了，下一帧它会自动调转方向继续追！
            el.scrollTop += diff * 0.15
            
            requestAnimationFrame(animate)
          }
          
          requestAnimationFrame(animate)
        }
      }
    }
  }, [])

  return (
    <div
      ref={scrollContainerRef}
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      style={{ height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight }}
    >
      <div 
        className="z-30 w-full rounded-t-md bg-card"
        style={{ paddingRight: `${scrollbarWidth}px` }} 
      >
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
        onScroll={(e) => {
          if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
          }
          handleScroll()
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
              <div
                key={virtualRow.key}
                data-index={virtualRow.index} 
                ref={rowVirtualizer.measureElement} 
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <InnerRow
                  row={row}
                  renderExpandedRow={renderExpandedRow}
                  getProportionalStyles={getProportionalStyles}
                  noteField={noteField}
                  onRowClick={handleRowClick}
                />
              </div>
            )
          })}
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
                : '暂无库存数据，请先入库'}
          </div>
        )}
      </div>
    </div>
  )
}