import type { BadgeColor } from '@/lib/constants'

export interface LogTypeOption {
  value: string
  label: string
}

interface LogTypeBadgeMeta {
  label: string
  color: BadgeColor
}

export const LOG_TYPE_OPTIONS: LogTypeOption[] = [
  { value: 'all', label: '全部' },
  { value: 'reagent_order', label: '试剂' },
  { value: 'consumable_order', label: '耗材' },
  { value: 'inventory', label: '库存' },
  { value: 'common_shelf', label: '常用' },
  { value: 'borrow', label: '借用' },
  { value: 'user', label: '用户' },
  { value: 'session', label: '会话' },
]

export const SEARCH_LOG_TYPE_OPTION: LogTypeOption = {
  value: 'search',
  label: '搜索',
}

const LOG_TYPE_BADGE_META: Record<string, LogTypeBadgeMeta> = {
  reagent_order: { label: '试剂', color: 'blue' },
  consumable_order: { label: '耗材', color: 'green' },
  inventory: { label: '库存', color: 'purple' },
  common_shelf: { label: '常用', color: 'amber' },
  borrow: { label: '借用', color: 'cyan' },
  session: { label: '会话', color: 'teal' },
  user: { label: '用户', color: 'indigo' },
  export: { label: '导出', color: 'orange' },
  search: { label: '搜索', color: 'orange' },
}

const DEFAULT_LOG_TYPE_BADGE = { label: '未知', color: 'gray' } as const

export function getLogTypeBadgeMeta(type: string): LogTypeBadgeMeta {
  return LOG_TYPE_BADGE_META[type] ?? DEFAULT_LOG_TYPE_BADGE
}

export function getLogTypeLabel(type: string): string {
  return getLogTypeBadgeMeta(type).label
}
