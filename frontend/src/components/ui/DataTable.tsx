// DataTable.tsx
import React, { useRef, useCallback, useState, useEffect, memo } from 'react'
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
  // 新增：向外传递是否滚动在顶部的状态
  onIsAtTopChange?: (isAtTop: boolean) => void
}

interface MemoizedExpandedRowProps<TData> {
  original: TData
  renderExpandedRow: (row: TData) => React.ReactNode
}

interface BulkAnchor {
  rowId: string
  offsetInRow: number
}

const MemoizedExpandedRow = memo(
  <TData,>({ original, renderExpandedRow }: MemoizedExpandedRowProps<TData>) => {
    return <>{renderExpandedRow(original)}</>
  },
  (prevProps, nextProps) => prevProps.original === nextProps.original
) as <TData>(props: MemoizedExpandedRowProps<TData>) => React.JSX.Element

function InnerRowComponent<TData>({
  row,
  isExpanded,
  renderExpandedRow,
  noteField,
  onRowClick,
}: Readonly<{
  row: Row<TData>
  isExpanded: boolean
  renderExpandedRow?: (row: TData) => React.ReactNode
  noteField?: string
  onRowClick?: (e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => void
}>) {
  const original = row.original

  const noteValue = noteField
    ? ((original as Record<string, unknown>)?.[noteField] as string | undefined)
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
          'flex w-full cursor-pointer transition-colors items-center hover:bg-accent dark:hover:bg-input border-b',
          isExpanded ? 'border-transparent' : 'border-border'
        )}
        onClick={handleToggle}
      >
        {row.getVisibleCells().map((cell: Cell<TData, unknown>, index: number) => {
          const isFirstCol = index === 0
          const showAccentLine = isFirstCol && hasNote && !isExpanded

          return (
            <div
              key={cell.id}
              className={cn(
                'p-3 text-base break-all flex items-center relative transition-colors',
                isFirstCol && 'border-l-4 border-transparent'
              )}
              style={{
                flex: `var(--col-${cell.column.id}-flex)`,
                minWidth: `var(--col-${cell.column.id}-min)`,
                display: `var(--col-${cell.column.id}-display)`,
              }}
            >
              {isFirstCol && (
                <div
                  className={cn(
                    'absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[75%] rounded-r-[2px]',
                    isHighlighted ? 'bg-amber-400 dark:bg-amber-600' : 'bg-slate-300 dark:bg-slate-500',
                    'transition-all duration-300 ease-in-out origin-center',
                    showAccentLine ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
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

const InnerRow = memo(InnerRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.row.id === nextProps.row.id &&
    prevProps.row.original === nextProps.row.original &&
    prevProps.isExpanded === nextProps.isExpanded &&
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
  onIsAtTopChange, // 新增
}: Readonly<DataTableProps<TData>>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const rAFRef = useRef<number | null>(null)

  const [resizingColId, setResizingColId] = useState<string | null>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const [isBulkAnimating, setIsBulkAnimating] = useState(false)

  const bulkAnimationTimerRef = useRef<number | null>(null)
  const hasMountedExpandAllRef = useRef(false)
  const prevIsAllExpandedRef = useRef<boolean | undefined>(undefined)

  const bulkAnchorRef = useRef<BulkAnchor | null>(null)
  const bulkExpandedSnapshotRef = useRef<Set<string> | null>(null)

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
  const sortingState = table.getState().sorting

  useEffect(() => {
    if (enableExpandAll && expandAllStorageKey) {
      localStorage.setItem(expandAllStorageKey, isAllExpanded ? 'expanded' : 'collapsed')
    }
  }, [isAllExpanded, enableExpandAll, expandAllStorageKey])

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
    if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0
  }, [sortingState])

  useEffect(() => {
    return () => {
      if (bulkAnimationTimerRef.current) {
        window.clearTimeout(bulkAnimationTimerRef.current)
        bulkAnimationTimerRef.current = null
      }
    }
  }, [])

  const isMobile = useIsMobile()
  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()

  const totalWeight = visibleColumns.reduce((sum, col) => sum + col.getSize(), 0)
  const minTableWidth = visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)

  const cssVariableStyles: React.CSSProperties & Record<string, string> = {}
  visibleColumns.forEach((column) => {
    const size = column.getSize()
    const minSize = column.columnDef.minSize ?? 50

    cssVariableStyles[`--col-${column.id}-flex`] =
      size === 0 ? 'none' : `${size} 0 0%`
    cssVariableStyles[`--col-${column.id}-min`] = `${minSize}px`
    cssVariableStyles[`--col-${column.id}-display`] =
      size === 0 ? 'none' : 'flex'
  })

  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: Header<TData, unknown>) => {
    e.preventDefault()
    e.stopPropagation()

    const currentIndex = visibleColumns.findIndex((c) => c.id === header.column.id)
    const leftCol = visibleColumns[currentIndex]
    const rightCol = visibleColumns[currentIndex + 1]

    if (!leftCol || !rightCol) return

    const startX = e.type === 'touchstart'
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX

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

        table.setColumnSizing((old) => ({
          ...old,
          [leftCol.id]: newLeft,
          [rightCol.id]: newRight,
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

  const estimateRowSize = useCallback((index: number) => {
    const row = rows[index]
    if (!row) return estimatedRowHeight

    const expandedEstimate = estimatedRowHeight + 124.8
    const snapshot = bulkExpandedSnapshotRef.current

    if (isBulkAnimating && snapshot) {
      return snapshot.has(row.id) ? expandedEstimate : estimatedRowHeight
    }

    return row.getIsExpanded() ? expandedEstimate : estimatedRowHeight
  }, [rows, estimatedRowHeight, isBulkAnimating])

  const getRowItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: estimateRowSize,
    overscan: isBulkAnimating ? 4 : (isAllExpanded ? 5 : 10),
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: getRowItemKey,
  })

  const virtualizerRef = useRef(rowVirtualizer)
  useEffect(() => {
    virtualizerRef.current = rowVirtualizer
  }, [rowVirtualizer])

  const captureBulkAnchor = useCallback((): BulkAnchor | null => {
    const el = bodyScrollRef.current
    const virtualizer = virtualizerRef.current
    if (!el || !virtualizer) return null

    const scrollTop = el.scrollTop
    const items = virtualizer.getVirtualItems()
    if (!items.length) return null

    let anchorItem = items.find((item) => scrollTop >= item.start && scrollTop < item.end)
    if (!anchorItem) anchorItem = items[0]

    const row = rows[anchorItem.index]
    if (!row) return null

    return {
      rowId: row.id,
      offsetInRow: Math.max(0, scrollTop - anchorItem.start),
    }
  }, [rows])

  const restoreBulkAnchor = useCallback((anchor: BulkAnchor | null) => {
    if (!anchor) return

    const el = bodyScrollRef.current
    const virtualizer = virtualizerRef.current
    if (!el || !virtualizer) return

    const index = rows.findIndex((row) => row.id === anchor.rowId)
    if (index < 0) return

    let item = virtualizer.getVirtualItems().find((v) => v.index === index)

    if (!item) {
      virtualizer.scrollToIndex(index, { align: 'start' })
      item = virtualizer.getVirtualItems().find((v) => v.index === index)
      if (!item) return
    }

    el.scrollTop = item.start + anchor.offsetInRow
  }, [rows])

  useEffect(() => {
    if (!enableExpandAll) return

    if (!hasMountedExpandAllRef.current) {
      hasMountedExpandAllRef.current = true
      prevIsAllExpandedRef.current = isAllExpanded
      table.toggleAllRowsExpanded(isAllExpanded)

      requestAnimationFrame(() => {
        virtualizerRef.current.measure()
      })
      return
    }

    if (prevIsAllExpandedRef.current === isAllExpanded) return
    prevIsAllExpandedRef.current = isAllExpanded

    bulkAnchorRef.current = captureBulkAnchor()
    bulkExpandedSnapshotRef.current = new Set(
      rows.filter((row) => row.getIsExpanded()).map((row) => row.id)
    )

    setIsBulkAnimating(true)
    table.toggleAllRowsExpanded(isAllExpanded)

    if (bulkAnimationTimerRef.current) {
      window.clearTimeout(bulkAnimationTimerRef.current)
    }

    bulkAnimationTimerRef.current = window.setTimeout(() => {
      bulkExpandedSnapshotRef.current = null

      requestAnimationFrame(() => {
        virtualizerRef.current.measure()

        requestAnimationFrame(() => {
          virtualizerRef.current.measure()
          restoreBulkAnchor(bulkAnchorRef.current)

          requestAnimationFrame(() => {
            restoreBulkAnchor(bulkAnchorRef.current)
            setIsBulkAnimating(false)
            bulkAnchorRef.current = null
            bulkAnimationTimerRef.current = null
          })
        })
      })
    }, 180)

    return () => {
      if (bulkAnimationTimerRef.current) {
        window.clearTimeout(bulkAnimationTimerRef.current)
        bulkAnimationTimerRef.current = null
      }
    }
  }, [
    isAllExpanded,
    enableExpandAll,
    table,
    rows,
    captureBulkAnchor,
    restoreBulkAnchor,
  ])

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
      const initialItem = virtualizerRef.current.getVirtualItems().find((v) => v.index === index)

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
    
    // 新增：判断是否在顶部并传递给父组件
    if (onIsAtTopChange) {
      onIsAtTopChange(e.currentTarget.scrollTop <= 2)
    }

    handleScroll()
  }, [handleScroll, onIsAtTopChange]) // 依赖项加入 onIsAtTopChange

  return (
    <div
      ref={scrollContainerRef}
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      style={{
        height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight,
        ...cssVariableStyles,
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
                          'relative p-3 mt-3 font-bold text-foreground flex items-center group select-none hover:bg-accent dark:hover:bg-input transition-colors rounded-t-md',
                          index === 0 && 'border-l-4 border-transparent'
                        )}
                        style={{
                          flex: `var(--col-${header.column.id}-flex)`,
                          minWidth: `var(--col-${header.column.id}-min)`,
                          display: `var(--col-${header.column.id}-display)`,
                        }}
                      >
                        <div
                          className={cn('flex items-center gap-1 w-full min-w-0', canSort && 'cursor-pointer')}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          {canSort && (
                            <span
                              className={cn(
                                'h-4 shrink-0 overflow-hidden flex items-center justify-center text-muted-foreground transition-[width,margin,opacity] duration-200',
                                isSorted
                                  ? 'w-4 ml-1.5 opacity-100'
                                  : 'w-0 ml-0 opacity-0 group-hover:w-4 group-hover:ml-1.5 group-hover:opacity-50'
                              )}
                            >
                              {isSorted === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> :
                               isSorted === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> :
                               <ArrowUpDown className="w-3.5 h-3.5" />}
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
                                  'absolute right-0 top-1.5 h-full w-1 cursor-col-resize z-10 touch-none transition-all opacity-0 group-hover:opacity-100',
                                  isResizing ? 'bg-primary/70 opacity-100 w-1.5' : 'hover:bg-primary/50',
                                  isResizing && header.getSize() === (header.column.columnDef.minSize ?? 50) && 'bg-destructive/70',
                                  isResizing && header.column.columnDef.maxSize && header.getSize() === header.column.columnDef.maxSize && 'bg-destructive/70'
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
            width: '100%',
            minWidth: `${minTableWidth}px`,
            position: shouldUseVirtualization ? 'relative' : 'static',
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
