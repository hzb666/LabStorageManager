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

// === Status Badge Colors ===
export type BadgeColor = 'green' | 'blue' | 'orange' | 'gray' | 'purple' | 'red' | 'amber'

export const BADGE_COLORS: Record<BadgeColor, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border border-orange-300 dark:border-orange-700',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700',
  red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
}

export const STATUS_COLORS = {
  in_stock: 'green',
  run_short: 'orange',
  not_in_stock: 'amber',
  borrowed: 'blue',
  consume: 'green',
  consumed: 'gray',
  active: 'green',
  inactive: 'red',
  admin: 'purple',
  user: 'blue',
  current: 'green',
  other: 'gray',
  pending: 'orange',
  approved: 'blue',
  arrived: 'purple',
  stocked: 'green',
  rejected: 'red',
  completed: 'green',
  running_out: 'orange',
  not_stocked: 'red',
  common_public: 'blue',
  not_found: 'purple',
  reorder: 'green',
  high_usage: 'amber',
  degraded: 'red',
  others: 'gray',
  common_shelf: 'blue',
} as const satisfies Record<string, BadgeColor>

export const STATUS_LABELS: Record<string, string> = {
  in_stock: '在库',
  run_short: '快用完',
  not_in_stock: '没有',
  borrowed: '借出',
  consume: '拿取',
  consumed: '用完',
  active: '启用',
  inactive: '禁用',
  admin: '管理员',
  user: '用户',
  current: '当前设备',
  other: '其他设备',
  pending: '待审',
  approved: '批准',
  arrived: '到货',
  stocked: '入库',
  rejected: '驳回',
  completed: '完成',
  running_out: '用完',
  not_stocked: '没有',
  common_public: '公用',
  not_found: '未见',
  reorder: '追加',
  high_usage: '大量',
  degraded: '变质',
  others: '其他',
  common_shelf: '常用货架',
}

export const ORDER_REASON_LABELS: Record<string, string> = {
  running_out: '用完',
  not_stocked: '没有',
  common_public: '公用',
  not_found: '未见',
  reorder: '追加',
  high_usage: '大量',
  degraded: '变质',
  others: '其他',
}

export const ORDER_REASON_COLORS: Record<string, BadgeColor> = {
  running_out: 'orange',
  not_stocked: 'red',
  common_public: 'blue',
  not_found: 'purple',
  reorder: 'green',
  high_usage: 'amber',
  degraded: 'red',
  others: 'gray',
}

// === Session Storage Keys ===
export const AUTH_NOTICE_KEY = 'auth_notice'
export const CACHE_VERSION_STORAGE_KEY = 'app_cache_version'
export const CACHE_VERSION_RESET_NOTICE = '系统已更新，请重新登录'

// === Order Status (Reagent) ===
export const REAGENT_STATUS_MAP: Record<string, string> = {
  pending: '已申购',
  approved: '已批准',
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
  approved: '已批准',
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
  run_short: '快用完',
  borrowed: '已借出',
  consumed: '已耗尽',
}

export const INVENTORY_STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-800',
  run_short: 'bg-orange-100 text-orange-800',
  borrowed: 'bg-blue-100 text-blue-800',
  consumed: 'bg-gray-100 text-gray-800',
}

export const CHEMICAL_CATEGORY_LABELS: Record<string, string> = {
  acid: '酸类',
  base: '碱类',
  salt: '盐类',
  solvent: '溶剂',
  catalyst: '催化',
  indicator: '指示剂',
  other: '其他',
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


// ==================== 时间常量 ====================
// 1天毫秒数
export const ONE_DAY_MS = 24 * 60 * 60 * 1000

// 公告关闭时长 (24小时)
export const ANNOUNCEMENT_CLOSED_DURATION_MS = ONE_DAY_MS

// 登录态过期时长 (3天)
export const AUTH_STORAGE_EXPIRY_MS = 3 * ONE_DAY_MS

// 字体加载超时 (1秒)
export const FONT_TIMEOUT_MS = 1000

// ==================== 缓存与限流常量 ====================
// 化学属性缓存最大条目数
export const CHEMICAL_PROPERTIES_CACHE_MAX_SIZE = 1000

// 化学属性缓存有效期 (10年毫秒数)
export const CHEMICAL_PROPERTIES_CACHE_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000

// PubChem 速率限制: 1秒最多5个请求
export const PUBCHEM_RATE_LIMIT = 5
export const PUBCHEM_RATE_WINDOW_MS = 1000
