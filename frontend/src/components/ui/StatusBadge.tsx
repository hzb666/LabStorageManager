import { cn } from '@/lib/utils'
import { BADGE_COLORS, STATUS_COLORS, STATUS_LABELS, type BadgeColor } from '@/lib/badgeConstants'

interface StatusBadgeProps {
  status: string
  color?: BadgeColor
  className?: string
}

/**
 * 通用状态标签组件
 * 自动根据 status 映射到对应颜色
 */
export function StatusBadge({ status, color, className }: Readonly<StatusBadgeProps>) {
  const baseClass = 'inline-flex items-center h-8 px-2.5 text-sm rounded-lg whitespace-nowrap'
  const badgeColor = color || STATUS_COLORS[status] || 'gray'
  const label = STATUS_LABELS[status] ||
   status

  return (
    <span className={cn(baseClass, BADGE_COLORS[badgeColor], className)}>
      {label}
    </span>
  )
}

export default StatusBadge
