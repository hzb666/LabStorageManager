import { cn } from '@/lib/utils'

interface QuantityIndicatorProps {
  remaining: number
  initial: number
  unit?: string
  // 已含完整展示单位与格式时直接覆盖 unit，避免再重复拼装一次。
  specification?: string
  className?: string
  showBar?: boolean
  barWidth?: string
}

const NARROW_SPACE = '\u200A'

// 统一组装剩余量文本，优先展示已格式化规格。
const getDisplayText = ({
  initial,
  remaining,
  specification,
  unit,
}: Pick<QuantityIndicatorProps, 'initial' | 'remaining' | 'specification' | 'unit'>): string => {
  if (specification) {
    return `${remaining}${NARROW_SPACE}/${NARROW_SPACE}${specification}`
  }

  if (unit) {
    return `${remaining}${NARROW_SPACE}/${NARROW_SPACE}${initial} ${unit}`
  }

  return `${remaining}${NARROW_SPACE}/${NARROW_SPACE}${initial}`
}

const getQuantityTextClassName = (percentage: number): string | undefined => {
  if (percentage === 0) {
    return 'text-destructive'
  }

  if (percentage > 0 && percentage < 20) {
    return 'text-amber-600 dark:text-amber-400'
  }

  return undefined
}

// 根据剩余百分比返回进度条轨道颜色。
const getProgressTrackClassName = (percentage: number): string => {
  if (percentage === 0) {
    return 'bg-destructive/20'
  }

  return 'bg-amber-500/20'
}

// 根据剩余百分比返回进度条填充颜色。
const getProgressFillClassName = (percentage: number): string => {
  if (percentage === 0) {
    return 'bg-destructive'
  }

  return 'bg-amber-500'
}

// 计算进度条宽度，并为极小值保留最小可见宽度。
const getProgressWidth = (percentage: number): string => {
  if (percentage === 0) {
    return '0%'
  }

  return `${Math.max(percentage, 5)}%`
}

// 初始量为 0 时显示 `-`，其余沿用红/琥珀阈值表达“用完/偏低”的库存语义。
export function QuantityIndicator({
  remaining,
  initial,
  unit = '',
  specification,
  className,
  showBar = true,
  barWidth = 'w-16',
}: QuantityIndicatorProps) {
  if (initial === 0) {
    return (
      <div className={cn('flex items-center h-8 break-all', className)}>
        <span className="text-muted-foreground">-</span>
      </div>
    )
  }

  const percentage = (remaining / initial) * 100
  const displayText = getDisplayText({ remaining, initial, specification, unit })
  const quantityTextClassName = getQuantityTextClassName(percentage)
  const shouldShowProgressBar = showBar && percentage < 20
  const progressTrackClassName = getProgressTrackClassName(percentage)
  const progressFillClassName = getProgressFillClassName(percentage)
  const progressWidth = getProgressWidth(percentage)

  return (
    <div className={cn('flex flex-col justify-center h-8 break-all', className)}>
      <span className={cn('leading-none', quantityTextClassName)}>
        {displayText}
      </span>
      {shouldShowProgressBar && (
        <div className={cn(barWidth, 'h-1.5 rounded mt-1.5', progressTrackClassName)}>
          <div
            className={cn('h-full rounded transition-all', progressFillClassName)}
            style={{ width: progressWidth }}
          />
        </div>
      )}
    </div>
  )
}

export default QuantityIndicator
