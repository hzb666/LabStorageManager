import {
  ConsumableOrderStatus,
  ReagentOrderStatus,
} from '@/api/client'

const EDITABLE_ORDER_STATUSES = new Set<string>([
  ReagentOrderStatus.PENDING,
  ReagentOrderStatus.REJECTED,
  ConsumableOrderStatus.PENDING,
  ConsumableOrderStatus.REJECTED,
])
const ADMIN_EDITABLE_ORDER_STATUSES = new Set<string>([
  ...EDITABLE_ORDER_STATUSES,
  ReagentOrderStatus.APPROVED,
  ConsumableOrderStatus.APPROVED,
])
const APPROVABLE_ORDER_STATUSES = new Set<string>([
  ReagentOrderStatus.PENDING,
  ReagentOrderStatus.REJECTED,
  ConsumableOrderStatus.PENDING,
  ConsumableOrderStatus.REJECTED,
])
const REJECTABLE_ORDER_STATUSES = new Set<string>([
  ReagentOrderStatus.PENDING,
  ReagentOrderStatus.APPROVED,
  ConsumableOrderStatus.PENDING,
  ConsumableOrderStatus.APPROVED,
])

export function isEditableOrderStatus(status: unknown): boolean {
  return typeof status === 'string' && EDITABLE_ORDER_STATUSES.has(status)
}

export function isOrderEditableByRole(status: unknown, isAdmin: boolean): boolean {
  if (typeof status !== 'string') {
    return false
  }
  return isAdmin
    ? ADMIN_EDITABLE_ORDER_STATUSES.has(status)
    : EDITABLE_ORDER_STATUSES.has(status)
}

export function isApprovableOrderStatus(status: unknown): boolean {
  return typeof status === 'string' && APPROVABLE_ORDER_STATUSES.has(status)
}

export function isRejectableOrderStatus(status: unknown): boolean {
  return typeof status === 'string' && REJECTABLE_ORDER_STATUSES.has(status)
}
