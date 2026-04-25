import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'
import type { BadgeColor } from '@/lib/constants'
import { formatDisplayDateTime } from '@/lib/utils'

export type OrderStatusBadgeKind = 'reagent' | 'consumable'
export type OrderStatusTimeValue = string | Date | null | undefined

export interface OrderStatusTimeFields {
  created_at?: OrderStatusTimeValue
  updated_at?: OrderStatusTimeValue
  approved_at?: OrderStatusTimeValue
  rejected_at?: OrderStatusTimeValue
  arrived_at?: OrderStatusTimeValue
  stocked_at?: OrderStatusTimeValue
  completed_at?: OrderStatusTimeValue
}

interface OrderStatusBadgeProps {
  status: string
  order: OrderStatusTimeFields
  kind: OrderStatusBadgeKind
  color?: BadgeColor
  className?: string
}

const STATUS_TIME_CONFIG = {
  pending: { field: 'created_at', label: '申购时间' },
  approved: { field: 'approved_at', label: '批准时间' },
  rejected: { field: 'rejected_at', label: '驳回时间' },
  arrived: { field: 'arrived_at', label: '到货时间' },
  stocked: { field: 'stocked_at', label: '入库时间' },
  completed: { field: 'completed_at', label: '确认收货时间' },
} as const

function getStatusTimeInfo({
  status,
  order,
  kind,
}: {
  status: string
  order: OrderStatusTimeFields
  kind: OrderStatusBadgeKind
}) {
  const config = STATUS_TIME_CONFIG[status as keyof typeof STATUS_TIME_CONFIG]
  if (!config) {
    return null
  }

  const time = order[config.field] ?? (status === 'pending' ? order.created_at : order.updated_at)
  if (!time) {
    return null
  }

  return {
    label: status === 'completed' && kind === 'consumable' ? '确认收货时间' : config.label,
    time,
  }
}

export function OrderStatusBadge({
  status,
  order,
  kind,
  color,
  className,
}: Readonly<OrderStatusBadgeProps>) {
  const statusTime = getStatusTimeInfo({ status, order, kind })
  const badge = <StatusBadge status={status} color={color} className={className} />

  if (!statusTime) {
    return badge
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="whitespace-nowrap">
        {statusTime.label}：{formatDisplayDateTime(statusTime.time)}
      </TooltipContent>
    </Tooltip>
  )
}

export default OrderStatusBadge
