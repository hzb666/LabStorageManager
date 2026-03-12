/**
 * 通用表格操作按钮组件
 * 通过 Props 传入配置，实现不同表格的操作按钮复用
 * 使用 React.memo + 通用浅比较 优化性能并防止闭包陷阱
 */
import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { UserRoles } from '@/lib/constants'
import { Pencil } from 'lucide-react'

// ============================================================================
// 类型定义
// ============================================================================

export interface ActionButtonConfig<T> {
  id: string
  label: string
  variant?: 'default' | 'morden' | 'destructive' | 'secondary' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  className?: string
  icon?: React.ReactNode
  showWhen?: (item: T, isAdmin?: boolean) => boolean
  /** 是否禁用（按钮变灰不可点） */
  disableWhen?: (item: T, isAdmin?: boolean) => boolean
  onClick: (item: T) => void | Promise<void>
  confirm?: boolean
  confirmLabel?: string
  requiredRole?: typeof UserRoles.ADMIN | typeof UserRoles.USER
}

export interface TableActionButtonsProps<T> {
  item: T
  actions: ActionButtonConfig<T>[]
  showEdit?: boolean
  /** 是否禁用编辑按钮 */
  disableEdit?: boolean
  onEdit?: (item: T) => void
  isAdmin?: boolean
  statusField?: keyof T
  statusDisplay?: {
    value: unknown
    label: string
    className?: string
    title?: string
  }[]
  compact?: boolean
}

interface ActionButtonProps<T> {
  config: ActionButtonConfig<T>
  item: T
  isAdmin?: boolean
}

// ============================================================================
// 组件实现
// ============================================================================

export function TableActionButtons<T>({
  item,
  actions,
  showEdit = true,
  disableEdit = false,
  onEdit,
  isAdmin = false,
  statusField,
  statusDisplay,
  compact = false,
}: Readonly<TableActionButtonsProps<T>>) {
  const status = statusField ? (item[statusField] as string) : undefined

  if (statusDisplay && status) {
    const matchedStatus = statusDisplay.find(s => s.value === status)
    if (matchedStatus) {
      return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className={matchedStatus.className} title={matchedStatus.title}>
            {matchedStatus.label}
          </span>
        </div>
      )
    }
  }

  const visibleActions = actions.filter(action => {
    if (action.requiredRole === UserRoles.ADMIN && !isAdmin) return false
    if (action.requiredRole === UserRoles.USER && isAdmin === undefined) return false
    if (action.showWhen) return action.showWhen(item, isAdmin)
    return true
  })

  return (
    <div className={cn('flex items-center gap-1', compact ? 'flex-wrap' : 'flex-wrap')}>
      {showEdit && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="morden"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={disableEdit}
              onClick={(e) => {
                e.stopPropagation()
                onEdit(item)
              }}
            >
              <Pencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>编辑</p>
          </TooltipContent>
        </Tooltip>
      )}

      {visibleActions.map(action => (
        <ActionButton<T>
          key={action.id}
          config={action}
          item={item}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  )
}

function ActionButton<T>({ config, item, isAdmin }: Readonly<ActionButtonProps<T>>) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const isDisabled = config.disableWhen ? config.disableWhen(item, isAdmin) : false

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLoading || isDisabled) return

    if (!isConfirming && config.confirm) {
      setIsConfirming(true)
      return
    }

    setIsLoading(true)
    try {
      await config.onClick(item)
      setIsConfirming(false)
    } catch {
      setIsConfirming(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSimpleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    config.onClick(item)
  }

  // 同时有 icon 和 confirm 时，显示带图标的确认按钮
  if (config.icon && config.confirm) {
    // 根据按钮 id 确定确认状态的背景色；确认态图标与常规态保持一致
    const isApprove = config.id === 'approve'
    const confirmStateClass = isApprove
      ? 'bg-green-600 text-white [&_svg]:text-white hover:bg-green-600/70 dark:bg-green-600 dark:hover:bg-green-600/70'
      : 'bg-destructive text-white [&_svg]:text-white hover:bg-destructive/70 dark:bg-destructive dark:hover:bg-destructive/70'
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <LoadingButton
            size="sm"
            disabled={isDisabled}
            variant="morden"
            className={cn(
              config.className,
              'h-8 w-8 p-0',
              isConfirming
                ? cn(
                  'transition-none [&_svg]:transition-none',
                  confirmStateClass,
                  isLoading && 'opacity-100 cursor-wait'
                )
                : ''
            )}
            onClick={handleClick}
            onBlur={() => { if (isConfirming && !isLoading) setIsConfirming(false) }}
            isLoading={isLoading}
          >
            {config.icon}
          </LoadingButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{isConfirming ? (config.confirmLabel || '确认') : config.label}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  if (config.confirm) {
    return (
      <LoadingButton
        size="sm"
        disabled={isDisabled}
        className={cn(
          config.className,
          'h-8 text-sm leading-4',
          isConfirming
            ? isLoading
              ? 'text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none'
              : 'bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none'
            : ''
        )}
        onClick={handleClick}
        onBlur={() => { if (isConfirming && !isLoading) setIsConfirming(false) }}
        isLoading={isLoading}
      >
        {isConfirming ? (config.confirmLabel || '确认') : config.label}
      </LoadingButton>
    )
  }

  if (config.icon) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={config.variant || 'morden'}
            size="sm"
            className={cn('h-8 w-8 p-0', config.className)}
            disabled={isDisabled}
            onClick={handleSimpleClick}
          >
            {config.icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{config.label}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button
      variant={config.variant || 'default'}
      size="sm"
      className={cn('h-7 text-sm px-2', config.className)}
      disabled={isDisabled}
      onClick={handleSimpleClick}
    >
      {config.label}
    </Button>
  )
}

export const TableActionButtonsMemo = React.memo(
  TableActionButtons,
  (prevProps, nextProps) => {
    if (
      prevProps.isAdmin !== nextProps.isAdmin ||
      prevProps.showEdit !== nextProps.showEdit ||
      prevProps.disableEdit !== nextProps.disableEdit ||
      prevProps.compact !== nextProps.compact ||
      prevProps.onEdit !== nextProps.onEdit ||
      prevProps.actions !== nextProps.actions ||
      prevProps.statusDisplay !== nextProps.statusDisplay
    ) {
      return false
    }

    const prevItem = prevProps.item as Record<string, unknown>
    const nextItem = nextProps.item as Record<string, unknown>

    if (prevItem === nextItem) return true
    const prevKeys = Object.keys(prevItem)
    const nextKeys = Object.keys(nextItem)
    if (prevKeys.length !== nextKeys.length) return false
    return prevKeys.every((key) => prevItem[key] === nextItem[key])
  }
) as typeof TableActionButtons
