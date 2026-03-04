import { cn } from '@/lib/utils'

// 预定义颜色
export type BadgeColor = 'green' | 'blue' | 'orange' | 'gray' | 'purple' | 'red' | 'amber'

// 颜色样式映射
export const BADGE_COLORS: Record<BadgeColor, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border border-orange-300 dark:border-orange-700',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700',
  red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
}

// 状态到颜色的默认映射
export const STATUS_COLORS: Record<string, BadgeColor> = {
  // 库存状态
  in_stock: 'green',
  not_in_stock: 'amber',
  borrowed: 'blue',
  consumed: 'gray',
  // 用户状态
  active: 'green',
  inactive: 'red',
  // 用户角色
  admin: 'purple',
  user: 'blue',
  // 设备状态
  current: 'green',
  other: 'gray',
  // 订单状态
  pending: 'orange',
  approved: 'blue',
  arrived: 'purple',
  stocked: 'green',
  rejected: 'red',
}

// 状态到中文名称的映射
export const STATUS_LABELS: Record<string, string> = {
  // 库存状态
  in_stock: '在库',
  not_in_stock: '没有',
  borrowed: '借出',
  consumed: '用完',
  // 用户状态
  active: '启用',
  inactive: '禁用',
  // 用户角色
  admin: '管理员',
  user: '用户',
  // 设备状态
  current: '当前设备',
  other: '其他设备',
  // 订单状态
  pending: '待审',
  approved: '已批',
  arrived: '已到',
  stocked: '入库',
  rejected: '已驳',
}

// 申购原因到中文名称的映射
export const ORDER_REASON_LABELS: Record<string, string> = {
  none: '',
  running_out: '用完',
  not_stocked: '没有',
  common_public: '公用',
  not_found: '未见',
  reorder: '追加',
  high_usage: '大量',
  degraded: '变质',
}

interface StatusBadgeProps {
  status: string
  color?: BadgeColor
  className?: string
}

/**
 * 通用状态标签组件
 * 自动根据 status 映射到对应颜色
 */
export function StatusBadge({ status, color, className }: StatusBadgeProps) {
  const baseClass = 'inline-flex items-center h-8 px-2.5 text-sm rounded-lg font-medium whitespace-nowrap'
  const badgeColor = color || STATUS_COLORS[status] || 'gray'
  const label = STATUS_LABELS[status] || status

  return (
    <span className={cn(baseClass, BADGE_COLORS[badgeColor], className)}>
      {label}
    </span>
  )
}

export default StatusBadge
