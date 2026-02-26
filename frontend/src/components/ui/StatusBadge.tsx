import { cn } from '@/lib/utils'

// 库存状态类型
export type InventoryStatus = 'in_stock' | 'borrowed' | 'consumed'

// 用户状态类型
export type UserStatus = 'active' | 'inactive'

// 用户角色类型
export type UserRole = 'admin' | 'user'

// 库存状态样式映射
export const INVENTORY_STATUS_STYLES: Record<InventoryStatus, string> = {
  in_stock: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700',
  borrowed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
  consumed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
}

// 库存状态标签映射
export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  in_stock: '在库',
  borrowed: '借用',
  consumed: '用完',
}

// 用户状态样式映射
export const USER_STATUS_STYLES: Record<UserStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700',
  inactive: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700',
}

// 用户状态标签映射
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: '启用',
  inactive: '禁用',
}

// 用户角色样式映射
export const USER_ROLE_STYLES: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700',
  user: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
}

// 用户角色标签映射
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  user: '用户',
}

// 兼容旧的导出
export const STATUS_STYLES = { ...INVENTORY_STATUS_STYLES, ...USER_STATUS_STYLES, ...USER_ROLE_STYLES }
export type StatusType = InventoryStatus | UserStatus | UserRole

interface StatusBadgeProps {
  status: StatusType
  className?: string
}

/**
 * 通用状态标签组件
 * 支持库存状态、用户状态、用户角色等多种状态类型
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  // 库存状态
  if (status in INVENTORY_STATUS_STYLES) {
    const normalizedStatus = status as InventoryStatus
    return (
      <span
        className={cn(
          'inline-flex items-center h-8 px-2.5 text-sm rounded-lg font-medium whitespace-nowrap',
          INVENTORY_STATUS_STYLES[normalizedStatus],
          className
        )}
      >
        {INVENTORY_STATUS_LABELS[normalizedStatus]}
      </span>
    )
  }
  
  // 用户状态
  if (status in USER_STATUS_STYLES) {
    const normalizedStatus = status as UserStatus
    return (
      <span
        className={cn(
          'inline-flex items-center h-8 px-2.5 text-sm rounded-lg font-medium whitespace-nowrap',
          USER_STATUS_STYLES[normalizedStatus],
          className
        )}
      >
        {USER_STATUS_LABELS[normalizedStatus]}
      </span>
    )
  }
  
  // 用户角色
  if (status in USER_ROLE_STYLES) {
    const normalizedStatus = status as UserRole
    return (
      <span
        className={cn(
          'inline-flex items-center h-8 px-2.5 text-sm rounded-lg font-medium whitespace-nowrap',
          USER_ROLE_STYLES[normalizedStatus],
          className
        )}
      >
        {USER_ROLE_LABELS[normalizedStatus]}
      </span>
    )
  }
  
  // 默认样式
  return (
    <span
      className={cn(
        'inline-flex items-center h-8 px-2.5 text-sm rounded-lg font-medium whitespace-nowrap bg-muted',
        className
      )}
    >
      {status}
    </span>
  )
}

export default StatusBadge
