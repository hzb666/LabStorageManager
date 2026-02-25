import { useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIsMobile } from '@/hooks/use-mobile'

const PAGE_SIZE_OPTIONS = [20, 50, 100]

interface PaginationProps {
  currentPage: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  className?: string
}

export function Pagination({ currentPage, totalPages, pageSize, onPageChange, onPageSizeChange, className }: PaginationProps) {
  const isMobile = useIsMobile()
  const [jumpPage, setJumpPage] = useState('')

  const handleJump = () => {
    const page = parseInt(jumpPage, 10)
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page)
      setJumpPage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJump()
    }
  }

  // 移动端简化显示
  if (isMobile) {
    return (
      <nav className={cn('flex items-center justify-between gap-2 w-full', className)}>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-9 w-auto text-base gap-2">
            <SelectValue placeholder="选择每页条数" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Button
            variant="morden"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="h-9 w-9 p-0"
          >
            <ChevronLeft className="size-5" />
          </Button>

          <span className="text-base text-muted-foreground whitespace-nowrap">
            {currentPage} / {totalPages}
          </span>

          <Button
            variant="morden"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="h-9 w-9 p-0"
          >
            <ChevronRight className="size-5" />
          </Button>

          <div className="flex items-center gap-1 ml-1">
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={String(currentPage)}
              className="h-9 w-14 text-base text-center"
            />
            <span className="text-base text-muted-foreground">页</span>
          </div>
        </div>
      </nav>
    )
  }

  // 桌面端完整显示
  const pages = getPageNumbers(currentPage, totalPages)

  return (
    <nav className={cn('flex flex-wrap items-center justify-end gap-2', className)}>
      {/* 每页条数和页码按钮 - 居右 */}
      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-auto gap-2">
            <SelectValue placeholder="选择每页条数" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="morden"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="h-9 w-9 p-0"
        >
          <ChevronLeft className="size-5" />
        </Button>

        {pages.map((page, i) =>
          page === '...' ? (
            <span key={`ellipsis-${i}`} className="flex h-9 w-9 items-center justify-center">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </span>
          ) : (
            <Button
              key={page}
              variant={page === currentPage ? 'default' : 'morden'}
              onClick={() => onPageChange(page as number)}
              className="h-9 w-9 p-0"
            >
              {page}
            </Button>
          )
        )}

        <Button
          variant="morden"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="h-9 w-9 p-0"
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      {/* 跳转页 - 右侧 */}
      <div className="flex items-center gap-1">
        <span className="text-base text-muted-foreground">跳至</span>
        <Input
          type="number"
          min={1}
          max={totalPages}
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={String(currentPage)}
          className="h-9 w-16 text-base text-center"
        />
        <span className="text-base text-muted-foreground">页</span>
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

export function PaginationInfo({ currentPage, pageSize, total, className }: PaginationInfoProps) {
  const isMobile = useIsMobile()
  
  // 移动端不显示
  if (isMobile) {
    return null
  }

  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, total)

  return (
    <div className={cn('flex items-center gap-2 text-base text-muted-foreground', className)}>
      <span>
        显示 {from}-{to} 条，共 {total} 条
      </span>
    </div>
  )
}
