/**
 * Centralized mapping tables for status/reason/role display
 * Backend stores English values; frontend maps to Chinese.
 */

// === Order Status (Reagent) ===
export const REAGENT_STATUS_MAP: Record<string, string> = {
  pending: '已申购',
  approved: '已审批',
  arrived: '已到货',
  stocked: '已入库',
  rejected: '未通过',
}

export const REAGENT_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  arrived: 'bg-green-100 text-green-800',
  stocked: 'bg-gray-100 text-gray-800',
  rejected: 'bg-red-100 text-red-800',
}

// === Order Status (Consumable) ===
export const CONSUMABLE_STATUS_MAP: Record<string, string> = {
  pending: '已申购',
  approved: '已审批',
  completed: '已完成',
  rejected: '未通过',
}

export const CONSUMABLE_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

// === Inventory Status ===
export const INVENTORY_STATUS_MAP: Record<string, string> = {
  in_stock: '在库',
  borrowed: '已借出',
  consumed: '已耗尽',
}

export const INVENTORY_STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-800',
  borrowed: 'bg-blue-100 text-blue-800',
  consumed: 'bg-gray-100 text-gray-800',
}

// === Order Reason ===
export const ORDER_REASON_MAP: Record<string, string> = {
  none: '没有',
  running_out: '快用完',
  empty: '用完',
  common_public: '常用或公用',
  not_found: '找不到',
  reorder: '重新下单',
}

// === User Role ===
export const USER_ROLE_MAP: Record<string, string> = {
  admin: '管理员',
  user: '普通用户',
}

// === Helper to get display text ===
export function mapStatus(value: string, mapping: Record<string, string>): string {
  return mapping[value] ?? value
}
