import { useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'

const PAGE_SIZE_OPTIONS = [20, 50, 100]

interface PaginationProps {
  currentPage: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  className?: string
}

export function Pagination({ currentPage, totalPages, pageSize, onPageChange, onPageSizeChange, className }: Readonly<PaginationProps>) {
  // 移除了 useIsMobile 钩子，全面采用 Tailwind 响应式类名
  const [jumpPage, setJumpPage] = useState('')

  const handleJump = () => {
    const page = Number.parseInt(jumpPage, 10)
    if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page)
      setJumpPage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJump()
    }
  }

  const pages = getPageNumbers(currentPage, totalPages)

  return (
    <nav className={cn('flex flex-col sm:flex-row flex-wrap items-center sm:justify-end gap-4', className)}>

      {/* 区域 1：每页条数 与 移动端页码信息（移动端居上/居左显示） */}
      <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-4">
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-9 w-auto gap-2">
            <SelectValue placeholder="选择条数" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 仅在移动端 (< md) 显示的简易页码 */}
        <span className="flex md:hidden text-sm text-muted-foreground whitespace-nowrap">
          {currentPage} / {totalPages}
        </span>
      </div>

      {/* 区域 2：分页按钮 与 跳转输入框（移动端居下显示） */}
      <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-2 sm:gap-4">

        {/* 翻页按钮组 */}
        <div className="flex items-center gap-1">
          <Button
            variant="morden"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="h-9 w-9 p-0"
          >
            <ChevronLeft className="size-5" />
          </Button>

          {/* 桌面端 (>= md) 完整页码 */}
          <div className="hidden md:flex items-center gap-1">
            {pages.map((page, i) =>
              page === '...' ? (
                <span key={`ellipsis-${i}`} className="flex h-9 w-9 items-center justify-center">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </span>
              ) : (
                <Button
                  // 【核心魔法】将 active 状态绑定到 key 上。状态切换时强制组件重新挂载，实现 0 延迟变色
                  key={`page-${page}-${page === currentPage ? 'active' : 'inactive'}`}
                  variant={page === currentPage ? 'default' : 'morden'}
                  onClick={() => onPageChange(page)}
                  // 移除基础过渡动画，仅在 hover 时施加过渡类名
                  className="h-9 w-9 p-0"
                >
                  {page}
                </Button>
              )
            )}
          </div>

          <Button
            variant="morden"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="h-9 w-9 p-0"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        {/* 跳转输入框 */}
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={String(currentPage)}
            className="h-9 w-20 text-base pl-3 pr-8"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">页</span>
        </div>
      </div>
    </nav>
  )
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = [1]

  if (current > 3) pages.push('...')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) pages.push('...')

  pages.push(total)
  return pages
}

interface PaginationInfoProps {
  currentPage: number
  pageSize: number
  total: number
  onPageSizeChange?: (size: number) => void
  className?: string
}

export function PaginationInfo({ currentPage, pageSize, total, className }: Readonly<PaginationInfoProps>) {
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, total)

  return (
    <div className={cn('hidden md:flex items-center gap-2 text-base text-muted-foreground', className)}>
      <span>
        显示 {from}-{to} 条，共 {total} 条
      </span>
    </div>
  )
}
