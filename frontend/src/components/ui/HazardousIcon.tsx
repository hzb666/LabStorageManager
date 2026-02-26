import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HazardousIconProps {
  /** 是否显示危险品图标 */
  isHazardous?: boolean
  /** 自定义类名 */
  className?: string
  /** 图标尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否显示文字标签 */
  showLabel?: boolean
}

/**
 * 危险品图标组件
 * 显示危险品警告标识
 */
export function HazardousIcon({
  isHazardous,
  className,
  size = 'md',
  showLabel = false
}: HazardousIconProps) {
  if (!isHazardous) return null

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4'
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <AlertTriangle className={cn('text-yellow-500 shrink-0', sizeClasses[size])} />
      {showLabel && <span className="text-yellow-500 text-sm">危险品</span>}
    </span>
  )
}

export default HazardousIcon
