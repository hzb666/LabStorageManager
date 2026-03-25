/**
 * 通用表格操作按钮组件
 * 通过 Props 传入配置，实现不同表格的操作按钮复用
 * 使用 React.memo + 通用浅比较 优化性能并防止闭包陷阱
 */
import React, { useCallback, useState } from 'react'
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
  variant?: 'default' | 'modern' | 'destructive' | 'secondary' | 'ghost'
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
}

interface ActionButtonProps<T> {
  config: ActionButtonConfig<T>
  item: T
  isAdmin?: boolean
}

/** 根据角色要求判断当前动作是否应该展示，统一收敛角色分支避免重复条件流。 */
function canShowActionForRole<T>(action: ActionButtonConfig<T>, isAdmin: boolean): boolean {
  return action.requiredRole !== UserRoles.ADMIN || isAdmin
}

// ============================================================================
// 组件实现
// ============================================================================

/** 根据配置渲染操作列按钮集合，并统一处理编辑按钮和状态展示分支。 */
export function TableActionButtons<T>({
  item,
  actions,
  showEdit = true,
  disableEdit = false,
  onEdit,
  isAdmin = false,
  statusField,
  statusDisplay,
}: Readonly<TableActionButtonsProps<T>>) {
  const status = statusField ? (item[statusField] as string) : undefined

  /** 拦截编辑按钮点击，避免触发行展开等父级事件。 */
  const handleEditClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    onEdit?.(item)
  }, [item, onEdit])

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
    if (!canShowActionForRole(action, isAdmin)) return false
    if (action.showWhen) return action.showWhen(item, isAdmin)
    return true
  })

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {showEdit && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="modern"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={disableEdit}
              onClick={handleEditClick}
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

// ============================================================================
// ActionButton 渲染变体
// ============================================================================

/** 确认操作的公共状态逻辑 */
function useConfirmAction<T>(config: ActionButtonConfig<T>, item: T, isDisabled: boolean) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // 二次点击时真正执行危险操作，首次点击仅进入确认态。
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLoading || isDisabled) return

    if (!isConfirming) {
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

  // 失焦后退出确认态，避免危险按钮长时间停留在确认状态。
  const handleBlur = () => {
    if (isConfirming && !isLoading) setIsConfirming(false)
  }

  const displayLabel = isConfirming ? (config.confirmLabel || '确认') : config.label

  return { isConfirming, isLoading, handleClick, handleBlur, displayLabel }
}

/** 图标 + 确认 按钮 */
function IconConfirmButton<T>({ config, item, isAdmin }: Readonly<ActionButtonProps<T>>) {
  const isDisabled = config.disableWhen ? config.disableWhen(item, isAdmin) : false
  const { isConfirming, isLoading, handleClick, handleBlur, displayLabel } =
    useConfirmAction(config, item, isDisabled)

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
          variant="modern"
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
          onBlur={handleBlur}
          isLoading={isLoading}
        >
          {config.icon}
        </LoadingButton>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{displayLabel}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** 文字确认按钮（无图标） */
function ConfirmButton<T>({ config, item, isAdmin }: Readonly<ActionButtonProps<T>>) {
  const isDisabled = config.disableWhen ? config.disableWhen(item, isAdmin) : false
  const { isConfirming, isLoading, handleClick, handleBlur, displayLabel } =
    useConfirmAction(config, item, isDisabled)

  // 根据确认阶段和加载状态切换按钮的危险态样式。
  const confirmClassName = (() => {
    if (!isConfirming) return ''
    if (isLoading) return 'text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none'
    return 'bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none'
  })()

  return (
    <LoadingButton
      size="sm"
      disabled={isDisabled}
      className={cn(
        config.className,
        'h-8 text-sm leading-4',
        confirmClassName
      )}
      onClick={handleClick}
      onBlur={handleBlur}
      isLoading={isLoading}
    >
      {displayLabel}
    </LoadingButton>
  )
}

/** 纯图标按钮（无确认） */
function IconButton<T>({ config, item, isAdmin }: Readonly<ActionButtonProps<T>>) {
  const isDisabled = config.disableWhen ? config.disableWhen(item, isAdmin) : false

  // 纯图标按钮只负责阻止冒泡并透传业务点击事件。
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    config.onClick(item)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={config.variant || 'modern'}
          size="sm"
          className={cn('h-8 w-8 p-0', config.className)}
          disabled={isDisabled}
          onClick={handleClick}
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

/** 纯文字按钮（无图标、无确认） */
function SimpleButton<T>({ config, item, isAdmin }: Readonly<ActionButtonProps<T>>) {
  const isDisabled = config.disableWhen ? config.disableWhen(item, isAdmin) : false

  // 纯文字按钮沿用与图标按钮一致的点击边界处理。
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    config.onClick(item)
  }

  return (
    <Button
      variant={config.variant || 'default'}
      size="sm"
      className={cn('h-7 text-sm px-2', config.className)}
      disabled={isDisabled}
      onClick={handleClick}
    >
      {config.label}
    </Button>
  )
}

/** 根据 config 特征选择对应的渲染变体 */
function ActionButton<T>(props: Readonly<ActionButtonProps<T>>) {
  const { config } = props

  if (config.icon && config.confirm) return <IconConfirmButton {...props} />
  if (config.confirm) return <ConfirmButton {...props} />
  if (config.icon) return <IconButton {...props} />
  return <SimpleButton {...props} />
}

/** 通过浅比较配置和条目字段，避免操作列在无关更新时重复渲染。 */
export const TableActionButtonsMemo = React.memo(
  TableActionButtons,
  (prevProps, nextProps) => {
    if (
      prevProps.isAdmin !== nextProps.isAdmin ||
      prevProps.showEdit !== nextProps.showEdit ||
      prevProps.disableEdit !== nextProps.disableEdit ||
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
