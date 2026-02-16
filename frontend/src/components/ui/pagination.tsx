import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

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
  const pages = getPageNumbers(currentPage, totalPages)

  return (
    <nav className={cn('flex items-center justify-center gap-2', className)}>
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        className="h-8 px-2 text-sm border rounded-md bg-background hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size} 条/页
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {pages.map((page, i) =>
          page === '...' ? (
            <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </span>
          ) : (
            <Button
              key={page}
              variant={page === currentPage ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(page as number)}
              className="h-8 w-8 p-0"
            >
              {page}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
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

export function PaginationInfo({ currentPage, pageSize, total, onPageSizeChange, className }: PaginationInfoProps) {
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, total)

  return (
    <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <span>
        显示 {from}-{to} 条，共 {total} 条
      </span>
    </div>
  )
}
