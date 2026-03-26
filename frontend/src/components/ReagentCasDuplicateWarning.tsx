import { AlertTriangle } from 'lucide-react'

import type { CASOverviewResponse } from '@/api/client'

interface ReagentCasDuplicateWarningProps {
  casWarning: CASOverviewResponse | null
  className?: string
  onOpenOrders?: () => void
  onOpenInventory?: () => void
  getOrderStatusLabel?: (status: string) => string
}

const DEFAULT_WARNING_CLASS_NAME = 'mt-4 rounded-md bg-orange-50 p-3 dark:bg-orange-950'
const WARNING_ACTION_CLASS_NAME =
  'font-bold transition-colors hover:text-orange-950 dark:hover:text-orange-100'
const DISPLAY_NAME_MAX_LENGTH = 10

// 限制展示名称长度，避免告警区被超长名称撑坏。
const truncateDisplayName = (displayName?: string | null): string => {
  if (!displayName) {
    return ''
  }

  return displayName.length > DISPLAY_NAME_MAX_LENGTH
    ? `${displayName.slice(0, DISPLAY_NAME_MAX_LENGTH)}...`
    : displayName
}

// 优先使用页面传入的状态映射，没提供时再回退原始状态值，避免这里复制一套状态表。
const getOrderStatusText = (
  status: string,
  getOrderStatusLabel?: (status: string) => string
): string => getOrderStatusLabel?.(status) ?? status

interface WarningSectionLabelProps {
  label: string
  onClick?: () => void
}

function WarningSectionLabel({ label, onClick }: Readonly<WarningSectionLabelProps>) {
  if (onClick) {
    return (
      <button
        type="button"
        className={WARNING_ACTION_CLASS_NAME}
        onClick={onClick}
      >
        {label}
      </button>
    )
  }

  return <span className="font-bold">{label}</span>
}

// 这里只消费后端给出的 has_warning 结果，不在前端重复推导冲突规则。
export function ReagentCasDuplicateWarning({
  casWarning,
  className,
  onOpenOrders,
  onOpenInventory,
  getOrderStatusLabel,
}: Readonly<ReagentCasDuplicateWarningProps>) {
  if (!casWarning?.has_warning) {
    return null
  }

  const displayName = truncateDisplayName(casWarning.display_name)
  const orderLatest = casWarning.orders.latest
  const inventoryLatest = casWarning.inventory.latest
  const hasOrderRecord = casWarning.orders.total_count > 0 && Boolean(orderLatest)
  const hasInventoryRecord = casWarning.inventory.total_count > 0 && Boolean(inventoryLatest)
  const orderLabel = `现有订单（共 ${casWarning.orders.total_count} 条）：`
  const inventoryLabel = `现有库存（共 ${casWarning.inventory.total_count} 条）：`

  return (
    <div className={className || DEFAULT_WARNING_CLASS_NAME}>
      <p className="flex items-center gap-1 text-sm text-orange-700 dark:text-orange-300">
        <AlertTriangle className="h-4 w-4" />
        <span>
          注意：检测到同 CAS 相关记录（CAS: {casWarning.cas_number}
          {displayName ? `，名称：${displayName}` : ''}
          ）
        </span>
      </p>

      <div className="mt-2 space-y-1 text-sm text-orange-800 dark:text-orange-200">
        {hasOrderRecord && orderLatest && (
          <p>
            <WarningSectionLabel label={orderLabel} onClick={onOpenOrders} />
            <span>订购人：{orderLatest.applicant_name || '未知订购人'}，</span>
            <span>状态：{getOrderStatusText(orderLatest.status, getOrderStatusLabel)}，</span>
            <span>规格：{orderLatest.specification}</span>
          </p>
        )}

        {hasInventoryRecord && inventoryLatest && (
          <p>
            <WarningSectionLabel label={inventoryLabel} onClick={onOpenInventory} />
            <span>{inventoryLatest.storage_location || '位置未填写'}，</span>
            <span>{inventoryLatest.remaining_quantity ?? '-'} / {inventoryLatest.specification}</span>
          </p>
        )}
      </div>
    </div>
  )
}
