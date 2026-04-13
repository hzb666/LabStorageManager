/** DataTable 表体组件。 */
import React, { memo, useCallback } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Row, Cell } from '@tanstack/react-table'
import type { Virtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// InnerRow 及相关子组件
// ============================================================================

interface MemoizedExpandedRowProps<TData> {
  original: TData
  renderExpandedRow: (row: TData) => React.ReactNode
}

// 包装展开内容，避免同一行的展开区在原始数据未变化时重复渲染。
const MemoizedExpandedRow = memo(
  // 仅在展开行原始数据变化时重新渲染展开内容。
  <TData,>({ original, renderExpandedRow }: MemoizedExpandedRowProps<TData>) => {
    return <>{renderExpandedRow(original)}</>
  },
  (prevProps, nextProps) => prevProps.original === nextProps.original
) as <TData>(props: MemoizedExpandedRowProps<TData>) => React.JSX.Element

// 渲染单行数据及其展开区，并处理强调标记和点击展开逻辑。
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

  // 点击行时优先走外部点击处理，否则退回到默认的展开切换。
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

// 记忆化行组件，减少表格滚动和展开时的重复渲染。
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

// ============================================================================
// DataTableBody 主组件
// ============================================================================

interface DataTableBodyProps<TData> {
  rows: Row<TData>[]
  renderExpandedRow?: (row: TData) => React.ReactNode
  noteField?: string
  shouldUseVirtualization: boolean
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  minTableWidth: number
  handleRowClick: (e: React.MouseEvent<HTMLDivElement>, row: Row<TData>) => void
  // 加载更多 & 空状态
  isFetchingNextPage?: boolean
  hasNextPage?: boolean
  total?: number
  searchKeyword?: string
}

// 解析表格底部提示文案，避免在已有结果时误显示空状态。
function getFooterMessage(rowCount: number, total?: number, searchKeyword?: string): string | null {
  if (rowCount === 0) {
    if (searchKeyword) {
      return `未找到匹配"${searchKeyword}"的记录`
    }

    return '暂无数据'
  }

  if (total !== undefined && total > 0) {
    return `已加载全部 ${rowCount} 条记录`
  }

  return null
}

// 在虚拟化和普通渲染之间切换，并负责空态与分页加载态展示。
export function DataTableBody<TData>({
  rows,
  renderExpandedRow,
  noteField,
  shouldUseVirtualization,
  rowVirtualizer,
  minTableWidth,
  handleRowClick,
  isFetchingNextPage,
  hasNextPage,
  total,
  searchKeyword,
}: Readonly<DataTableBodyProps<TData>>) {
  const footerMessage = getFooterMessage(rows.length, total, searchKeyword)

  return (
    <>
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

      {!hasNextPage && !isFetchingNextPage && footerMessage && (
        <div className="text-center pt-4 text-muted-foreground text-base">
          {footerMessage}
        </div>
      )}
    </>
  )
}
