import { cn } from '@/lib/utils'

interface QuantityIndicatorProps {
  /** 剩余数量 */
  remaining: number
  /** 初始数量 */
  initial: number
  /** 单位 */
  unit?: string
  /** 规格（已格式化字符串，如 "500 mL"），优先级高于 unit */
  specification?: string
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
 * - initial 为 0 时：显示 "-"
 */
export function QuantityIndicator({
  remaining,
  initial,
  unit = '',
  specification,
  className,
  showBar = true,
  barWidth = 'w-16'
}: QuantityIndicatorProps) {
  // 当 initial 为 0 时，不显示剩余量/规格，显示 "-"
  if (initial === 0) {
    return (
      <div className={cn('flex items-center h-8 break-all', className)}>
        <span className="text-muted-foreground">-</span>
      </div>
    )
  }

  const percentage = initial > 0 ? (remaining / initial) * 100 : 0
  const narrowSpace = '\u200A'
  const displayText = specification 
    ? `${remaining}${narrowSpace}/${narrowSpace}${specification}` 
    : (unit ? `${remaining}${narrowSpace}/${narrowSpace}${initial} ${unit}` : `${remaining}${narrowSpace}/${narrowSpace}${initial}`)

  return (
    <div className={cn('flex flex-col justify-center h-8 break-all', className)}>
      <span
        className={cn(
          'leading-none', // 【核心修改】：消除默认行高带来的上下留白
          // 快用完时 (0 < percentage < 20)：使用琥珀色
          percentage < 20 && percentage > 0 && 'text-amber-600 dark:text-amber-400',
          // 完全耗尽时 (percentage === 0)：使用红色
          percentage === 0 && 'text-destructive'
        )}
      >
        {displayText}
      </span>
      {showBar && percentage < 20 && (
        <div className={cn(barWidth, 'h-1.5 rounded mt-1.5', // mt-1.5 配合 leading-none 让视觉更紧凑
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