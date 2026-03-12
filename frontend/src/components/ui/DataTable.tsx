// DataTable.tsx
import React, { useRef, useCallback, useState, useEffect, memo, useMemo } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Table as TableType, Row, Cell, Column, Header } from '@tanstack/react-table'
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

// DataTable 组件的 Props 接口定义
interface DataTableProps<TData> {
  table: TableType<TData> // tanstack table 实例
  renderExpandedRow?: (row: TData) => React.ReactNode // 自定义展开行的渲染函数
  estimatedRowHeight?: number // 虚拟滚动中单行的预估高度
  scrollHeight?: number | string // 表格滚动区域的高度
  enableExpandAll?: boolean // 是否允许一键展开所有行
  expandAllStorageKey?: string // 用于持久化展开状态的 localStorage key
  isAllExpanded?: boolean // 外部受控的全部展开状态
  onToggleExpandAll?: () => void // 外部受控的展开状态切换回调
  noteField?: string // 用于特殊高亮标记的字段名（如包含 "[强调]"）
  hasNextPage?: boolean // 是否还有下一页数据（用于无限滚动）
  isFetchingNextPage?: boolean // 是否正在请求下一页数据
  fetchNextPage?: () => void // 触发请求下一页的方法
  total?: number // 数据总条数
  searchKeyword?: string  // 搜索关键词，用于区分无数据情况是由于搜索还是本来就没数据
}

// 缓存展开行的 Props 接口
interface MemoizedExpandedRowProps<TData> {
  original: TData;
  renderExpandedRow: (row: TData) => React.ReactNode;
}

// 使用 React.memo 缓存展开行组件，避免父组件重新渲染时引起不必要的子组件渲染
const MemoizedExpandedRow = memo(
  <TData,>({ original, renderExpandedRow }: MemoizedExpandedRowProps<TData>) => {
    return <>{renderExpandedRow(original)}</>;
  },
  // 仅当原始数据对象发生变化时才重新渲染
  (prevProps, nextProps) => {
    return prevProps.original === nextProps.original;
  }
) as <TData>(props: MemoizedExpandedRowProps<TData>) => React.JSX.Element;

// 🚀 性能优化 1：提取全局空对象，避免每次渲染都生成新的引用触发不必要的 Style Diff
const EMPTY_STYLE: React.CSSProperties = {}

// 内部行组件：负责渲染单行数据以及它的展开状态
function InnerRowComponent<TData>({
  row,
  isExpanded,
  renderExpandedRow,
  getProportionalStyles,
  noteField,
  onRowClick,
}: Readonly<{
  row: Row<TData>
  isExpanded: boolean 
  renderExpandedRow?: (row: TData) => React.ReactNode
  getProportionalStyles: (column: Column<TData, unknown>) => React.CSSProperties
  noteField?: string
  onRowClick?: (e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => void
}>) {
  const original = row.original

  // 检查当前行是否包含备注信息，以及是否需要被特殊高亮（以 "[强调]" 开头）
  const noteValue = noteField
    ? (original as Record<string, unknown>)?.[noteField] as string | undefined
    : undefined
  const hasNote = Boolean(noteValue)
  const isHighlighted = noteValue?.startsWith('[强调]') || false

  // 处理行的点击事件，触发展开/折叠逻辑
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
      {/* 基础行 DOM */}
      <div
        className={cn(
          "flex w-full cursor-pointer transition-colors items-center hover:bg-accent dark:hover:bg-input border-b",
          isExpanded ? "border-transparent" : "border-border"
        )}
        onClick={handleToggle}
      >
        {/* 遍历渲染每一个单元格 */}
        {row.getVisibleCells().map((cell: Cell<TData, unknown>, index: number) => {
          const isFirstCol = index === 0;
          const showAccentLine = isFirstCol && hasNote && !isExpanded;

          return (
            <div
              key={cell.id}
              className={cn(
                "p-3 text-base break-all flex items-center relative transition-colors",
                isFirstCol && "border-l-4 border-transparent" // 给第一列预留左侧边框空间
              )}
              style={getProportionalStyles(cell.column)}
            >
              {/* 如果是第一列且包含备注信息，则在左侧渲染一个指示条 */}
              {isFirstCol && (
                <div
                  className={cn(
                    "absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[75%] rounded-r-[2px]",
                    isHighlighted
                      ? "bg-amber-400 dark:bg-amber-600" // 高亮色
                      : "bg-slate-300 dark:bg-slate-500", // 普通提示色
                    "transition-all duration-300 ease-in-out origin-center",
                    showAccentLine
                      ? "opacity-100 scale-y-100" // 显示指示条
                      : "opacity-0 scale-y-0"     // 隐藏指示条
                  )}
                />
              )}
              {/* 渲染 TanStack Table 单元格内容 */}
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          )
        })}
      </div>

      {/* 展开内容区域，使用 framer-motion 实现高度动画 */}
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
            <MemoizedExpandedRow 
              original={original} 
              renderExpandedRow={renderExpandedRow} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 缓存 InnerRowComponent，通过精准的浅比较策略，防止非当前可视区的行在滚动时触发重渲染
const InnerRow = memo(InnerRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.row.id === nextProps.row.id && // 🚀 性能优化 2：优先校验 ID 避免内存地址变更击穿缓存
    prevProps.row.original === nextProps.row.original && 
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.renderExpandedRow === nextProps.renderExpandedRow &&
    prevProps.getProportionalStyles === nextProps.getProportionalStyles && // 只有当列宽/列配置真实改变时才重新渲染
    prevProps.noteField === nextProps.noteField &&
    prevProps.onRowClick === nextProps.onRowClick
  )
}) as typeof InnerRowComponent

// 主数据表格组件
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
  // DOM 引用
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  // 记录当前正在被拖拽调整宽度的列 ID
  const [resizingColId, setResizingColId] = useState<string | null>(null)
  
  // 处理外部受控或内部持久化的 "全部展开" 状态
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

  // 持久化保存 "全部展开" 状态到 localStorage
  useEffect(() => {
    if (enableExpandAll && expandAllStorageKey) {
      localStorage.setItem(expandAllStorageKey, isAllExpanded ? 'expanded' : 'collapsed')
    }
  }, [isAllExpanded, enableExpandAll, expandAllStorageKey])

  // 监听状态改变并同步到 TanStack Table 的 instance 中
  useEffect(() => {
    if (!enableExpandAll) return
    table.toggleAllRowsExpanded(isAllExpanded)
  }, [isAllExpanded, enableExpandAll, table])
  
  // 用于修复表头和表体之间因为系统滚动条引起的宽度不对齐问题
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return

    // 动态计算原生滚动条宽度
    const updateScrollbar = () => {
      const width = el.offsetWidth - el.clientWidth
      setScrollbarWidth((prev) => (prev === width ? prev : width))
    }

    updateScrollbar()
    // 监听容器大小变化以实时更新滚动条宽度补偿
    const observer = new ResizeObserver(() => {
      // 通过 requestAnimationFrame 防止 ResizeObserver loop limit exceeded 警告
      requestAnimationFrame(updateScrollbar)
    })
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  // 当表格排序状态发生变化时，将滚动条重置回顶部
  useEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [table.getState().sorting]);

  const isMobile = useIsMobile()
  const { rows } = table.getRowModel()
  const visibleColumns = table.getVisibleLeafColumns()
  const columnSizing = table.getState().columnSizing

  // 🚀 降维打击：提取列 ID 字符串作为依赖，避免 visibleColumns 数组每次渲染返回新引用时击穿 useMemo 缓存
  const visibleColIds = useMemo(() => visibleColumns.map(c => c.id).join(','), [visibleColumns])

  // 计算表格的总权重和最小宽度，用于列宽的 flex 动态分配
  const { totalWeight, minTableWidth } = useMemo(() => {
    return {
      totalWeight: visibleColumns.reduce((sum, col) => sum + col.getSize(), 0),
      minTableWidth: visibleColumns.reduce((sum, col) => sum + (col.columnDef.minSize ?? 50), 0)
    }
  }, [visibleColIds, columnSizing]) // 依赖项使用 visibleColIds 和 columnSizing

  // 预先生成每一列的 CSS 样式对象，利用 Flex-grow 实现完美等比自适应
  const columnStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {}
    
    visibleColumns.forEach(column => {
      const size = column.getSize()
      // 如果宽度为0则直接隐藏
      if (size === 0) {
        styles[column.id] = { display: 'none' }
        return
      }
      
      const minSize = column.columnDef.minSize ?? 50
      
      styles[column.id] = {
        flex: `${size} 0 0%`, // 使用 size 作为拉伸权重，flex-basis为0%确保严格按比例
        minWidth: `${minSize}px`,
        boxSizing: 'border-box',
      }
    })
    return styles
  }, [visibleColIds, columnSizing]) // 同上，仅在列配置或列宽尺寸变化时重新计算

  // 获取特定列样式的方法
  // 此时无需 useRef Hack，只要 columnStyles 变化（拖拽列宽时），函数引用更新，就能触发 InnerRow 的重新渲染
  const getProportionalStyles = useCallback((column: Column<TData, unknown>): React.CSSProperties => {
    return columnStyles[column.id] || EMPTY_STYLE
  }, [columnStyles])

  // 处理自定义列宽拖拽调整的核心逻辑
  const handleCustomResize = useCallback((e: React.MouseEvent | React.TouchEvent, header: Header<TData, unknown>) => {
    e.preventDefault()
    e.stopPropagation()

    // 找到当前列及相邻的右侧列（两列进行联动缩放，保证总宽度不变）
    const currentIndex = visibleColumns.findIndex(c => c.id === header.column.id)
    const leftCol = visibleColumns[currentIndex]
    const rightCol = visibleColumns[currentIndex + 1]

    if (!leftCol || !rightCol) return

    // 获取拖拽起始点的鼠标或触摸位置
    const startX = e.type === 'touchstart' ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX
    const startLeftSize = leftCol.getSize()
    const startRightSize = rightCol.getSize()

    // 获取两列的极值限制
    const leftMin = leftCol.columnDef.minSize ?? 50
    const leftMax = leftCol.columnDef.maxSize ?? 9999
    const rightMin = rightCol.columnDef.minSize ?? 50
    const rightMax = rightCol.columnDef.maxSize ?? 9999

    // 计算鼠标移动像素与 table size 权重之间的换算比例
    const tablePxWidth = Math.max(bodyScrollRef.current?.clientWidth || 0, minTableWidth)
    const pixelPerWeight = tablePxWidth / totalWeight

    setResizingColId(header.column.id)

    let animationFrameId: number;

    // 拖拽过程中的处理函数
    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      
      // 使用 requestAnimationFrame 对连续拖动事件进行节流，保持 60fps 平滑
      animationFrameId = requestAnimationFrame(() => {
        const currentX = moveEvent.type === 'touchmove'
          ? (moveEvent as TouchEvent).touches[0].clientX
          : (moveEvent as MouseEvent).clientX

        // 计算移动的距离与权重的转换
        const deltaX = currentX - startX
        const deltaWeight = deltaX / pixelPerWeight

        let newLeft = startLeftSize + deltaWeight
        let newRight = startRightSize - deltaWeight

        // 边界保护处理：防止被挤压到最小值以下或者超过最大值
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

        // 更新 Table 列宽状态
        table.setColumnSizing(old => ({
          ...old,
          [leftCol.id]: newLeft,
          [rightCol.id]: newRight
        }))
      })
    }

    // 拖拽结束的处理函数，解绑全局事件
    const onUp = () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      setResizingColId(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }

    // 绑定全局事件侦听，保证即使鼠标离开表头也能正常拖拽
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onUp)
  }, [visibleColumns, totalWeight, minTableWidth, table])

  // 判断是否使用虚拟滚动：scrollHeight='auto' 时无法正确计算容器高度，需要禁用虚拟滚动
  const shouldUseVirtualization = scrollHeight !== 'auto'

  // 配置虚拟滚动：利用 @tanstack/react-virtual 仅渲染视窗内的元素，极大提升长列表性能
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    // 根据行是否展开，动态提供估计的高度
    estimateSize: useCallback((index: number) => {
      const row = rows[index]
      return row?.getIsExpanded() ? estimatedRowHeight + 124.8 : estimatedRowHeight
    }, [rows, estimatedRowHeight]),
    // 视窗外的预渲染行数：全部展开时降低预渲染数量以防过载
    overscan: isAllExpanded ? 5 : 10,
    getScrollElement: () => bodyScrollRef.current,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  })

  // 存储 Virtualizer 引用供内部无依赖提取
  const virtualizerRef = useRef(rowVirtualizer)
  useEffect(() => {
    virtualizerRef.current = rowVirtualizer
  })

  // 🚀 性能优化 3：引入滚动锁，并在下一个动画帧(rAF)处理触底计算，解耦渲染和事件流
  const scrollLockRef = useRef(false)

  // 处理滚动触底加载更多 (已剥离对 rowVirtualizer 的依赖引用)
  const handleScroll = useCallback(() => {
    if (scrollLockRef.current || !hasNextPage || isFetchingNextPage) return

    scrollLockRef.current = true
    requestAnimationFrame(() => {
      const el = bodyScrollRef.current
      const virtualizer = virtualizerRef.current
      if (el && virtualizer) {
        const { scrollTop, clientHeight } = el
        const totalHeight = virtualizer.getTotalSize()
        
        // 当滚动到距离底部小于 200px 时，触发翻页请求
        if (totalHeight - scrollTop - clientHeight < 200) {
          fetchNextPage?.()
        }
      }
      scrollLockRef.current = false
    })
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // 点击展开行时的平滑滚动追踪逻辑 (Cubic Ease-Out 缓动)
  const handleRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => {
    const isExpanding = !row.getIsExpanded()
    
    // 立即触发展开以避免操作延迟感
    row.toggleExpanded()

    const el = bodyScrollRef.current
    const container = e.currentTarget.closest('[data-index]')

    if (isExpanding && el && container && virtualizerRef.current) {
      const index = Number(container.getAttribute('data-index'))
      const initialItem = virtualizerRef.current.getVirtualItems().find(v => v.index === index)
      
      // 如果当前行顶部超出了可是区域上方（被遮挡），则将其平滑滚动回视窗内
      if (initialItem && initialItem.start < el.scrollTop) {
        const targetY = initialItem.start
        const startY = el.scrollTop
        const distance = targetY - startY
        const duration = 300 // 动画持续时间 300ms
        let startTime: number | null = null
        let expectedScrollTop = startY
        
        // Cubic ease-out 缓动函数
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

        const smoothScroll = (currentTime: number) => {
          if (!el) return
          
          // 如果用户在此期间进行了手动滚动干预，则立刻中止程序的自动滚动
          if (Math.abs(el.scrollTop - expectedScrollTop) > 2) return
          
          if (!startTime) startTime = currentTime
          const elapsed = currentTime - startTime
          
          // 计算动画进度 [0, 1]
          const progress = Math.min(elapsed / duration, 1)
          
          // 按照缓动曲线更新当前 Y 坐标
          const currentPosition = startY + distance * easeOutCubic(progress)
          
          el.scrollTop = currentPosition
          expectedScrollTop = el.scrollTop 
          
          // 如果动画没播完，请求下一帧继续
          if (progress < 1) {
            requestAnimationFrame(smoothScroll)
          }
        }
        
        requestAnimationFrame(smoothScroll)
      }
    }
  }, [])

  // 🚀 性能优化 4：提取稳定的滚动事件处理函数，避免内联函数在频繁渲染时不断销毁重建
  const handleContainerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // 同步滚动表头，保持对齐
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
    handleScroll()
  }, [handleScroll])

  return (
    <div
      ref={scrollContainerRef}
      className="w-full bg-card rounded-md flex flex-col overflow-hidden"
      style={{ height: typeof scrollHeight === 'number' ? `${scrollHeight}px` : scrollHeight }}
    >
      {/* 冻结的表头部分 */}
      <div 
        className="z-30 w-full rounded-t-md bg-card"
        style={{ paddingRight: `${scrollbarWidth}px` }} // 利用计算好的原生滚动条宽度对齐头部与内容
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
                          "relative p-3 mt-3 font-bold text-foreground flex items-center group select-none hover:bg-accent dark:hover:bg-input transition-colors rounded-t-md",
                          index === 0 && "border-l-4 border-transparent"
                        )}
                        style={getProportionalStyles(header.column)}
                      >
                        {/* 排序及标题点击触发区 */}
                        <div
                          className={cn("flex items-center gap-1.5 w-full", canSort && "cursor-pointer")}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="truncate">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          {/* 排序图标显示 */}
                          {canSort && (
                            <span className="w-4 h-4 shrink-0 flex items-center justify-center text-muted-foreground">
                              {isSorted === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : 
                               isSorted === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : 
                               <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />}
                            </span>
                          )}
                        </div>

                        {/* 列宽调节拖拽手柄 */}
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

      {/* 表格主体滚动区（含虚拟滚动实现） */}
      <div
        ref={bodyScrollRef}
        className="w-full overflow-auto custom-scrollbar relative flex-1"
        style={{ scrollbarGutter: 'stable' }} // 防止滚动条闪烁导致的布局跳动
        onScroll={handleContainerScroll}
      >
        {/* 承载虚拟元素的定高大容器 */}
        <div
          style={{
            height: shouldUseVirtualization ? `${rowVirtualizer.getTotalSize()}px` : 'auto',
            width: "100%",
            minWidth: `${minTableWidth}px`,
            position: shouldUseVirtualization ? 'relative' : 'static'
          }}
        >
          {/* 根据 scrollHeight 是否为 'auto' 选择渲染方式 */}
          {shouldUseVirtualization ? (
            // 虚拟滚动模式
            rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>
                    <InnerRow
                      row={row}
                      isExpanded={row.getIsExpanded()} 
                      renderExpandedRow={renderExpandedRow}
                      getProportionalStyles={getProportionalStyles}
                      noteField={noteField}
                      onRowClick={handleRowClick}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            // 直接渲染模式：scrollHeight='auto' 时使用，直接渲染所有行
            rows.map((row, index) => (
              <div
                key={row.id ?? index}
                className="w-full"
              >
                <InnerRow
                  row={row}
                  isExpanded={row.getIsExpanded()} 
                  renderExpandedRow={renderExpandedRow}
                  getProportionalStyles={getProportionalStyles}
                  noteField={noteField}
                  onRowClick={handleRowClick}
                />
              </div>
            ))
          )}
        </div>
        
        {/* 底部加载更多状态提示 */}
        {isFetchingNextPage && (
          <div className="flex items-center justify-center pt-4 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span>加载更多...</span>
          </div>
        )}
        
        {/* 数据加载到底的无更多数据状态提示 */}
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