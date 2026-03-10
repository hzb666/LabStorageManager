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

// ============================================================================
// 类型定义
// ============================================================================

/** 操作按钮配置项 */
export interface ActionButtonConfig<T> {
  /** 唯一标识 */
  id: string
  /** 显示文本 */
  label: string
  /** 按钮变体 */
  variant?: 'default' | 'morden' | 'destructive' | 'secondary' | 'ghost'
  /** 按钮尺寸 */
  size?: 'default' | 'sm' | 'lg' | 'icon'
  /** 自定义样式类 */
  className?: string
  /** 图标（可选，用于图标按钮） */
  icon?: React.ReactNode
  /** 是否显示（根据数据判断） */
  showWhen?: (item: T, isAdmin?: boolean) => boolean
  /** 点击回调 */
  onClick: (item: T) => void | Promise<void>
  /** 是否需要二次确认 */
  confirm?: boolean
  /** 二次确认时的显示文本 */
  confirmLabel?: string
  /** 权限要求 */
  requiredRole?: typeof UserRoles.ADMIN | typeof UserRoles.USER
}

/** 组件 Props */
export interface TableActionButtonsProps<T> {
  /** 数据项 */
  item: T
  /** 操作按钮配置列表 */
  actions: ActionButtonConfig<T>[]
  /** 是否显示编辑按钮 */
  showEdit?: boolean
  /** 编辑按钮回调 */
  onEdit?: (item: T) => void
  /** 管理员权限 */
  isAdmin?: boolean
  /** 状态字段名（用于判断状态，如 'status'） */
  statusField?: keyof T
  /** 状态显示配置（当不显示操作按钮时显示状态信息） */
  statusDisplay?: {
    /** 状态值 */
    value: unknown
    /** 显示文本 */
    label: string
    /** 样式类名 */
    className?: string
    /** 鼠标悬停提示 (新增) */
    title?: string
  }[]
  /** 紧凑模式 */
  compact?: boolean
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 通用表格操作按钮组件
 * 通过配置化 Props 实现不同场景的复用
 */
export function TableActionButtons<T>({
  item,
  actions,
  showEdit = true,
  onEdit,
  isAdmin = false,
  statusField,
  statusDisplay,
  compact = false,
}: TableActionButtonsProps<T>) {
  // 状态字段
  const status = statusField ? (item[statusField] as string) : undefined

  // 渲染状态显示（当有状态显示配置且当前状态匹配时）
  if (statusDisplay && status) {
    const matchedStatus = statusDisplay.find(s => s.value === status)
    if (matchedStatus) {
      return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {/* 新增了 title 属性的支持 */}
          <span className={matchedStatus.className} title={matchedStatus.title}>
            {matchedStatus.label}
          </span>
        </div>
      )
    }
  }

  // 过滤可见的按钮
  const visibleActions = actions.filter(action => {
    // 权限检查
    if (action.requiredRole === UserRoles.ADMIN && !isAdmin) return false
    if (action.requiredRole === UserRoles.USER && isAdmin === undefined) return false
    // 条件显示检查
    if (action.showWhen) return action.showWhen(item, isAdmin)
    return true
  })

  // 渲染操作按钮
  return (
    <div className={cn('flex items-center gap-1', compact ? 'flex-wrap' : 'flex-wrap')}>
      {/* 编辑按钮 */}
      {showEdit && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="morden"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(item)
              }}
            >
              {/* Pencil 图标 */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>编辑</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* 动态操作按钮 */}
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
// 内部组件：单个操作按钮（处理确认逻辑）
// ============================================================================

interface ActionButtonProps<T> {
  config: ActionButtonConfig<T>
  item: T
  isAdmin: boolean
}

function ActionButton<T>({
  config,
  item,
}: ActionButtonProps<T>) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (isLoading) return

    if (!isConfirming && config.confirm) {
      // 首次点击，进入确认模式
      setIsConfirming(true)
      return
    }

    // 执行操作
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

  const handleBlur = () => {
    if (isConfirming && !isLoading) {
      setIsConfirming(false)
    }
  }

  // 根据是否需要确认来渲染不同的按钮
  if (config.confirm) {
    return (
      <LoadingButton
        size="sm"
        className={cn(
          config.className,
          'h-8 text-sm leading-4',
          // 动态样式：保持与 Inventory.tsx 一致
          isConfirming
            ? isLoading
              ? 'text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none'
              : 'bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none'
            : ''
        )}
        onClick={handleClick}
        onBlur={handleBlur}
        isLoading={isLoading}
      >
        {isConfirming ? (config.confirmLabel || '确认') : config.label}
      </LoadingButton>
    )
  }

  // 普通按钮
  if (config.icon && !config.label) {
    // 图标按钮
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={config.variant || 'morden'}
            size="sm"
            className={cn('h-8 w-8 p-0', config.className)}
            onClick={(e) => {
              e.stopPropagation()
              config.onClick(item)
            }}
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
      onClick={(e) => {
        e.stopPropagation()
        config.onClick(item)
      }}
    >
      {config.label}
    </Button>
  )
}

// ============================================================================
// React.memo 优化（用于表格行渲染）
// ============================================================================

/**
 * 带 memo 优化的 TableActionButtons 组件
 * 用于表格中，只在该变的属性变化时重渲染
 */
export const TableActionButtonsMemo = React.memo(
  TableActionButtons,
  (prevProps, nextProps) => {
    // 1. 比较配置项引用 (防止父组件配置变化时组件不更新)
    if (
      prevProps.isAdmin !== nextProps.isAdmin ||
      prevProps.showEdit !== nextProps.showEdit ||
      prevProps.compact !== nextProps.compact ||
      prevProps.onEdit !== nextProps.onEdit ||
      prevProps.actions !== nextProps.actions ||
      prevProps.statusDisplay !== nextProps.statusDisplay
    ) {
      return false
    }

    // 2. 动态遍历比较 item 的所有属性 (抹平泛型差异，杜绝硬编码导致的闭包缓存)
    const prevItem = prevProps.item as Record<string, unknown>
    const nextItem = nextProps.item as Record<string, unknown>

    if (prevItem === nextItem) return true

    const prevKeys = Object.keys(prevItem)
    const nextKeys = Object.keys(nextItem)

    if (prevKeys.length !== nextKeys.length) return false

    return prevKeys.every((key) => prevItem[key] === nextItem[key])
  }
) as typeof TableActionButtons