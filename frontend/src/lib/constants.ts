/**
 * Centralized mapping tables for status/reason/role display
 * Backend stores English values; frontend maps to Chinese.
 */

// === UI Component Styles ===
export const LABEL_STYLES = {
  base: "text-base mb-1.5 block",
  sm: "text-sm mb-1.5 block",
  lg: "text-lg mb-3 block",
} as const

export const INPUT_STYLES = {
  base: "h-9 inline-flex leading-none",
  sm: "h-8 inline-flex leading-none",
  lg: "h-10 text-base inline-flex leading-none",
} as const

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
  cannot_find: '没有（找不到）',
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
  public: '公用账户',
}

// User Role 常量 - 用于代码中的角色判断
export const UserRoles = {
  ADMIN: 'admin',
  USER: 'user',
  PUBLIC: 'public',
} as const

export type UserRole = typeof UserRoles[keyof typeof UserRoles]

// 用户类型定义
export interface User {
  id: number
  username: string
  full_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
}

/**
 * 判断用户是否为管理员
 */
export function isAdmin(user: { role: string } | null | undefined): boolean {
  return user?.role === UserRoles.ADMIN
}

/**
 * 判断用户是否为管理员或本人（用于操作权限判断）
 */
export function isAdminOrSelf(currentUser: { role: string; id: number } | null | undefined, targetId: number): boolean {
  if (!currentUser) return false
  return currentUser.role === UserRoles.ADMIN || currentUser.id === targetId
}

// === Import Template Columns ===
export interface ImportColumn {
  name: string
  required: boolean
  description: string
}

export const IMPORT_TEMPLATE_COLUMNS: ImportColumn[] = [
  {
    name: 'cas_number',
    required: true,
    description: '格式: XXXXX-XX-X，例如 64-17-5',
  },
  {
    name: 'name',
    required: true,
    description: '化学品中文名称，例如 乙醇',
  },
  {
    name: 'english_name',
    required: false,
    description: '化学品的英文名称，例如 Ethanol',
  },
  {
    name: 'alias',
    required: false,
    description: '化学品的别名或俗称，例如 酒精',
  },
  {
    name: 'category',
    required: false,
    description: '化学品分类，例如 有机溶剂、酸、碱',
  },
  {
    name: 'brand',
    required: false,
    description: '品牌或生产厂家，例如 Sigma、阿拉丁',
  },
  {
    name: 'specification',
    required: true,
    description: '格式: 数值+单位，如 500ml, 1L, 100g，系统会自动解析出数量和单位',
  },
  {
    name: 'remaining_quantity',
    required: false,
    description: '剩余数量（可选），不填则默认等于规格中的数量',
  },
  {
    name: 'storage_location',
    required: false,
    description: '例如 302冰箱第二层、A-1-1 柜',
  },
  {
    name: 'is_hazardous',
    required: false,
    description: 'true/false 或 1/0，危险品需要特殊存储',
  },
  {
    name: 'notes',
    required: false,
    description: '其他需要记录的信息，例如 易燃物品',
  },
]

// === Helper to get display text ===
export function mapStatus(value: string, mapping: Record<string, string>): string {
  return mapping[value] ?? value
}
