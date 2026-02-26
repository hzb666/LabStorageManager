import React from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Header } from '@tanstack/react-table'
import { useIsMobile } from '@/hooks/useMobile'

interface ResizableHeaderProps<T> {
  header: Header<T, unknown>
}

export function ResizableHeader<T>({ header }: ResizableHeaderProps<T>) {
  const isMobile = useIsMobile()

  return (
    <th
      className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base relative"
      style={{ width: header.getSize() }}
    >
      <div className="flex items-center justify-between">
        <span className="flex-1">
          {header.isPlaceholder
            ? null
            : flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {/* 仅在桌面端显示列宽调整手柄 */}
        {!isMobile && header.column.getCanResize() && (
          <div
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            className={`
              absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none
              hover:bg-primary/50
              ${header.column.getIsResizing() ? 'bg-primary' : 'bg-transparent'}
            `}
          />
        )}
      </div>
    </th>
  )
}
