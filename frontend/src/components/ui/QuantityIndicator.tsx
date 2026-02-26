import { cn } from '@/lib/utils'

interface QuantityIndicatorProps {
  /** 剩余数量 */
  remaining: number
  /** 初始数量 */
  initial: number
  /** 单位 */
  unit?: string
  /** 自定义类名 */
  className?: string
  /** 是否显示进度条 */
  showBar?: boolean
  /** 进度条宽度 */
  barWidth?: string
}

/**
 * 库存剩余量指示器组件
 * 显示剩余量/初始量，并根据剩余百分比显示不同颜色
 * - 0%: 红色（用完）
 * - 0-20%: 琥珀色（快用完）
 * - >20%: 正常颜色
 */
export function QuantityIndicator({
  remaining,
  initial,
  unit = '',
  className,
  showBar = true,
  barWidth = 'w-16'
}: QuantityIndicatorProps) {
  const percentage = initial > 0 ? (remaining / initial) * 100 : 0

  return (
    <div className={cn('break-all', className)}>
      <span
        className={cn(
          // 快用完时 (0 < percentage < 20)：使用琥珀色
          percentage < 20 && percentage > 0 && 'text-amber-600 font-medium dark:text-amber-400',
          // 完全耗尽时 (percentage === 0)：使用红色
          percentage === 0 && 'text-destructive font-medium'
        )}
      >
        {remaining}/{initial} {unit}
      </span>
      {showBar && percentage < 20 && (
        <div className={cn(barWidth, 'h-1.5 rounded mt-1', 
          percentage === 0 ? 'bg-destructive/20' : 'bg-amber-500/20'
        )}>
          <div
            className={cn(
              'h-full rounded transition-all',
              percentage === 0 ? 'bg-destructive' : 'bg-amber-500'
            )}
            style={{ width: `${percentage === 0 ? 0 : Math.max(percentage, 5)}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default QuantityIndicator
