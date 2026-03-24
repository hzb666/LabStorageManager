/**
 * DataTable 表头组件
 * 从 DataTable 中提取的表头渲染逻辑：排序、列宽调整手柄、Tooltip
 */
import React from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Table as TableType, Header as HeaderType } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useMobile'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'

interface DataTableHeaderProps<TData> {
  table: TableType<TData>
  headerScrollRef: React.RefObject<HTMLDivElement | null>
  scrollbarWidth: number
  minTableWidth: number
  resizingColId: string | null
  handleCustomResize: (e: React.MouseEvent | React.TouchEvent, header: HeaderType<TData, unknown>) => void
}

/** 排序方向 → 图标映射 */
function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <ArrowUp className="w-3.5 h-3.5" />
  if (direction === 'desc') return <ArrowDown className="w-3.5 h-3.5" />
  return <ArrowUpDown className="w-3.5 h-3.5" />
}

/** 列宽调整手柄的 className */
function getResizeHandleClassName(isResizing: boolean, header: HeaderType<unknown, unknown>): string {
  const minSize = header.column.columnDef.minSize ?? 50
  const maxSize = header.column.columnDef.maxSize
  const currentSize = header.getSize()

  const isAtMin = isResizing && currentSize === minSize
  const isAtMax = isResizing && maxSize !== undefined && currentSize === maxSize

  return cn(
    'absolute right-0 top-1.5 h-full w-1 cursor-col-resize z-10 touch-none transition-all opacity-0 group-hover:opacity-100',
    isResizing ? 'bg-primary/70 opacity-100 w-1.5' : 'hover:bg-primary/50',
    (isAtMin || isAtMax) && 'bg-destructive/70'
  )
}

/** 单个表头单元格 */
function HeaderCell<TData>({
  header,
  index,
  isResizing,
  showResizeHandle,
  handleCustomResize,
  table,
}: Readonly<{
  header: HeaderType<TData, unknown>
  index: number
  isResizing: boolean
  showResizeHandle: boolean
  handleCustomResize: (e: React.MouseEvent | React.TouchEvent, header: HeaderType<TData, unknown>) => void
  table: TableType<TData>
}>) {
  const canSort = header.column.getCanSort()
  const isSorted = header.column.getIsSorted()

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
            <SortIcon direction={isSorted} />
          </span>
        )}
      </div>

      {showResizeHandle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onMouseDown={(e) => handleCustomResize(e, header)}
              onTouchStart={(e) => handleCustomResize(e, header)}
              onDoubleClick={() => table.resetColumnSizing()}
              className={getResizeHandleClassName(isResizing, header as HeaderType<unknown, unknown>)}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>拖拽调整列宽 (双击恢复默认)</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** 负责渲染表头区域、排序图标和列宽拖拽手柄。 */
export function DataTableHeader<TData>({
  table,
  headerScrollRef,
  scrollbarWidth,
  minTableWidth,
  resizingColId,
  handleCustomResize,
}: Readonly<DataTableHeaderProps<TData>>) {
  const isMobile = useIsMobile()

  return (
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
                  const canResize = header.column.getCanResize() && header.index !== headerGroup.headers.length - 1

                  return (
                    <HeaderCell
                      key={header.id}
                      header={header}
                      index={index}
                      isResizing={resizingColId === header.column.id}
                      showResizeHandle={canResize && !isMobile}
                      handleCustomResize={handleCustomResize}
                      table={table}
                    />
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
