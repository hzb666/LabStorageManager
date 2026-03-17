/**
 * Valibot 验证 Schemas
 * 使用方法:
 * ```tsx
 * import { useForm } from 'react-hook-form'
 * import { valibotResolver } from '@hookform/resolvers/valibot'
 * import { InventorySchema } from '@/lib/validationSchemas'
 *
 * const form = useForm({
 *   resolver: valibotResolver(InventorySchema),
 *   defaultValues: {...}
 * })
 * ```
 */

import * as v from 'valibot'
import { valibotResolver } from '@hookform/resolvers/valibot'

// 类型化 resolver - 解决类型推断问题
// 使用方法: resolver: createValibotResolver(InventoryFormSchema)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createValibotResolver(schema: any): any {
  return valibotResolver(schema)
}

const parseNumberOrNaN = (input: string | number): number => {
  if (typeof input === 'number') return input
  const parsed = Number.parseFloat(input)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}


// ==========================================
// 1. 基础通用类型验证
// ==========================================

/**
 * 必填字符串验证 - 替代 validateRequired
 * @param fieldName 字段中文名称
 */
export const createRequiredStringSchema = (fieldName: string) =>
  v.pipe(
    v.string(`${fieldName}不能为空`),
    v.trim(),
    v.nonEmpty(`${fieldName}不能为空`)
  )

/**
 * 字符串长度验证 - 替代 validateStringLength
 * @param fieldName 字段中文名称
 * @param min 最小长度
 * @param max 最大长度
 */
export const createStringLengthSchema = (
  fieldName: string,
  min: number,
  max: number
) =>
  v.pipe(
    v.string(`${fieldName}必须是字符串`),
    v.trim(),
    v.minLength(min, min === 1 ? `${fieldName}不能为空` : `${fieldName}至少${min}个字符`),
    v.maxLength(max, `${fieldName}最多${max}个字符`)
  )

/**
 * 字符串最大长度验证 - 仅验证最大长度，不限制最小值
 * @param fieldName 字段中文名称
 * @param max 最大长度
 */
export const createMaxLengthSchema = (
  fieldName: string,
  max: number
) =>
  v.pipe(
    v.string(),
    v.trim(),
    v.maxLength(max, `${fieldName}最多${max}个字符`)
  )

/**
 * 正整数验证 (>=1) - 用于瓶数等必须为整数的字段
 * 支持字符串和数字输入，在 handleSubmit 中手动转换
 * 注意：不包含上限限制，具体上限由使用处单独定义
 * @param fieldName 字段中文名称
 */
export const createPositiveNumberSchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.integer(`${fieldName}必须为整数`),
    v.minValue(1, `${fieldName}必须为大于等于1的整数`)
  )

/**
 * 正数验证 (可小数) - 用于初始量等可以是小数 quantity 的字段
 * 支持字符串和数字输入
 * @param fieldName 字段中文名称
 */
export const createQuantitySchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.gtValue(0, `${fieldName}必须大于0`)
  )

/**
 * 非负数验证 - 用于剩余量等可以为0的字段
 * 支持字符串和数字输入
 * @param fieldName 字段中文名称
 */
export const createNonNegativeNumberSchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`)
  )

/**
 * 剩余量验证 - 用于编辑时验证剩余量不超过初始量
 * 支持字符串和数字输入
 * @param fieldName 字段中文名称
 * @param maxValue 最大值（初始量）
 */
export const createRemainingQuantitySchema = (fieldName: string, maxValue: number) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`),
    v.maxValue(maxValue, `${fieldName}不能超过初始量 (${maxValue})`)
  )

/**
 * 价格验证 - 替代 validatePrice
 * 支持字符串和数字输入
 * @param min 最小值
 * @param max 最大值
 */
export const createPriceSchema = (min = 0, max = 999999) =>
  v.pipe(
    v.union([v.string(), v.number()], '价格必须是有效数字'),
    v.transform(parseNumberOrNaN),
    v.number('价格必须是有效数字'),
    v.minValue(min, `价格不能小于${min}`),
    v.maxValue(max, `价格不能大于${max}`)
  )

// ==========================================
// 2. 复杂业务字段验证
// ==========================================

/**
 * 用户名验证 - 替代 validateUsername
 */
export const UsernameSchema = v.pipe(
  v.string('用户名不能为空'),
  v.trim(),
  v.minLength(3, '用户名至少3个字符'),
  v.maxLength(20, '用户名最多20个字符'),
  v.regex(/^\w+$/, '用户名只能包含字母、数字和下划线')
)

/**
 * 规格验证 - 替代 validateSpecification
 * 支持格式: 500ml, 1L, 100g, 500 ml, 1.5L 等
 */
export const SpecificationSchema = v.pipe(
  v.string('规格不能为空'),
  v.trim(),
  v.toLowerCase(),
  v.regex(
    /^\d+(\.\d+)?\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$/,
    '规格格式无效'
  )
)

// 规格解析辅助函数 - 从规格字符串提取数值
export function parseSpecification(spec: string): number | null {
  if (!spec) return null
  const match = new RegExp(/^(\d+\.?\d*)\s*/i).exec(spec)
  return match ? Number.parseFloat(match[1]) : null
}

// ==========================================
// 3. CAS 号高级验证逻辑
// ==========================================

/**
 * CAS 校验码计算逻辑
 * CAS号格式：三部分组成，第一部分2-6位数字，第二部分2位数字，第三部分1位校验码
 * 校验码计算：将第一二部分的数字从右到左依次乘以1,2,3...，求和后取模10
 */
export const validateCASLogic = (input: string): boolean => {
  const parts = input.split('-')
  if (parts.length !== 3) return false

  const firstPart = parts[0]
  const secondPart = parts[1]
  const thirdPart = parts[2]

  // 合并前两部分作为顺序号
  const sequenceNumber = firstPart + secondPart
  const digits = sequenceNumber.split('').reverse()

  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const digit = Number.parseInt(digits[i], 10)
    const multiplier = i + 1
    sum += digit * multiplier
  }

  const calculatedCheckDigit = sum % 10
  const actualCheckDigit = Number.parseInt(thirdPart, 10)

  return calculatedCheckDigit === actualCheckDigit
}

/**
 * CAS号验证 - 替代 validateCASNumber & normalizeCASNumber
 * 自动标准化：大写 + 去除空格
 */
export const CasNumberSchema = v.pipe(
  v.string('CAS号不能为空'),
  v.trim(),
  v.toUpperCase(),
  v.regex(/^\d{2,7}-\d{2}-\d$/, 'CAS号格式无效'),
  v.check((input) => validateCASLogic(input), 'CAS号校验码错误')
)

/**
 * CAS 输入预校验（用于自动识别按钮）
 */
export const validateAndNormalizeCASInput = (
  casValue: string
): { normalized: string } | { error: string } => {
  const normalized = casValue.trim().toUpperCase()
  if (!normalized) {
    return { error: '请先输入 CAS 号' }
  }

  if (!/^\d{2,7}-\d{2}-\d$/.test(normalized)) {
    return { error: 'CAS号格式无效' }
  }

  if (!validateCASLogic(normalized)) {
    return { error: 'CAS号校验码错误' }
  }

  return { normalized }
}

// ==========================================
// 4. 库存模块 Schema
// ==========================================

/**
 * 订单原因 Schema - 用于试剂和耗材订单
 * 支持预选选项和自定义输入
 */
const ORDER_REASON_VALUES = [
  'running_out',
  'not_stocked',
  'common_public',
  'not_found',
  'reorder',
  'high_usage',
  'degraded',
  'others',
] as const

export const OrderReasonSchema = v.picklist(ORDER_REASON_VALUES, '申购原因不能为空')

/**
 * 剩余量验证（非负数，允许0，但不能是null/undefined/空字符串）
 * 使用 v.union 在最外层拒绝空字符串
 * 注意：此 Schema 用于基础验证，编辑模式下 additional 验证在 handleFormSubmit 中单独处理
 */
const RemainingQuantitySchema = v.pipe(
  v.union([
    v.pipe(v.string(), v.trim(), v.minLength(1, '剩余数量不能为空')),
    v.number()
  ], '剩余数量必须是有效数字'),
  v.transform(parseNumberOrNaN),
  v.number('剩余数量必须是有效数字'),
  v.minValue(0, '剩余数量不能为负数')
)



/**
 * 库存表单 Schema
 * remaining_quantity 可选（后端自动计算等于 initial_quantity）
 * 编辑模式下 remaining_quantity 必填的验证在 handleFormSubmit 中处理
 */
export const InventoryFormSchema = v.object({
  // 基础字段
  name: createStringLengthSchema('名称', 1, 200),
  cas_number: CasNumberSchema,
  english_name: createMaxLengthSchema('英文名称', 200),
  alias: createMaxLengthSchema('别名', 200),
  category: createMaxLengthSchema('分类', 100),
  brand: createMaxLengthSchema('品牌', 100),
  specification: v.optional(SpecificationSchema),
  storage_location: createMaxLengthSchema('存储位置', 200),
  notes: createMaxLengthSchema('备注', 500),

  // 数量相关
  quantity_bottles: v.optional(v.pipe(createPositiveNumberSchema('瓶数'), v.maxValue(99, '瓶数不能超过99'))),
  initial_quantity: v.optional(createQuantitySchema('初始数量')),
  unit: v.optional(createRequiredStringSchema('单位')),
  remaining_quantity: v.optional(RemainingQuantitySchema),

  // 危险品
  is_hazardous: v.boolean('危险品必须是布尔值'),
})

/**
 * 库存表单 Schema 类型
 */
export type InventoryFormData = v.InferOutput<typeof InventoryFormSchema>

// ==========================================
// 5. 订单模块 Schema
// ==========================================

/**
 * 试剂订单 Schema
 * 前端输入: specification (规格字符串，如 500ml)
 * 后端处理: 拆分为 initial_quantity 和 unit
 */
export const ReagentOrderSchema = v.object({
  name: createStringLengthSchema('名称', 1, 200),
  cas_number: CasNumberSchema,
  english_name: createMaxLengthSchema('英文名称', 200),
  alias: createMaxLengthSchema('别名', 200),
  category: createMaxLengthSchema('分类', 100),
  brand: createMaxLengthSchema('品牌', 100),
  specification: SpecificationSchema, // 后端必填
  quantity: v.pipe(createPositiveNumberSchema('数量'), v.maxValue(99, '数量不能超过99')),
  price: createPriceSchema(0.01),  // 必填
  order_reason: OrderReasonSchema,   // 必填
  is_hazardous: v.boolean('危险品必须是布尔值'),
  notes: createMaxLengthSchema('备注', 500)
})

/**
 * 耗材订单 Schema
 * 与后端 ConsumableOrderCreate 保持一致
 * - specification: 必填
 * - unit: 可选
 * - 移除了 order_reason 和 is_hazardous
 * - 移除了 alias, category, brand, image_path
 */
export const ConsumableOrderSchema = v.object({
  name: createStringLengthSchema('名称', 1, 200),
  english_name: createMaxLengthSchema('英文名称', 200),
  product_number: createMaxLengthSchema('货号', 200),  // 选填，最多200字符
  specification: createStringLengthSchema('规格', 1, 100),  // 后端必填
  unit: createMaxLengthSchema('单位', 20),  // 后端新增可选字段
  quantity: createPositiveNumberSchema('数量'),
  price: v.optional(createPriceSchema()),
  communication: v.optional(createMaxLengthSchema('沟通信息', 100)),
  // 移除了 order_reason (后端已移除)
  // 移除了 is_hazardous (后端已移除)
  // 移除了 alias, category, brand (用户要求删除)
  notes: createMaxLengthSchema('备注', 500)
})

/**
 * 订单表单 Schema 类型
 */
export type ReagentOrderFormData = v.InferOutput<typeof ReagentOrderSchema>
export type ConsumableOrderFormData = v.InferOutput<typeof ConsumableOrderSchema>

// ==========================================
// 6. 用户模块 Schema
// ==========================================

/**
 * 登录 Schema
 */
export const LoginSchema = v.object({
  username: UsernameSchema,
  password: createStringLengthSchema('密码', 6, 50)
})

/**
 * 锁屏模式 Schema（只需密码）
 */
export const LockScreenSchema = v.object({
  password: createStringLengthSchema('密码', 6, 50)
})

/**
 * 登录表单类型
 */
export type LoginFormData = v.InferOutput<typeof LoginSchema>


// ==========================================
// 7. 用户管理模块 Schema (Admin)
// ==========================================

/**
 * 创建用户 Schema (AdminUsers 页面用)
 */
export const UserCreateSchema = v.object({
  username: UsernameSchema,
  password: v.pipe(
    v.string('密码不能为空'),
    v.minLength(6, '密码至少6个字符'),
    v.maxLength(50, '密码最多50个字符')
  ),
  full_name: createStringLengthSchema('姓名', 1, 100),
  role: v.optional(v.picklist(['admin', 'user', 'public']))
})

/**
 * 更新用户 Schema (AdminUsers 页面用)
 * 包含 username（必填）、full_name（必填）、role
 */
export const UserUpdateSchema = v.object({
  username: UsernameSchema,  // 用户名必填
  full_name: createStringLengthSchema('姓名', 1, 100),  // 必填
  role: v.optional(v.picklist(['admin', 'user', 'public']))
})


/**
 * 修改密码 Schema
 */
export const ChangePasswordSchema = v.object({
  old_password: createStringLengthSchema('原密码', 6, 50),
  new_password: v.pipe(
    v.string('新密码不能为空'),
    v.minLength(6, '新密码至少6个字符'),
    v.maxLength(50, '新密码最多50个字符')
  ),
  confirm_password: createStringLengthSchema('确认密码', 6, 50)
})

/**
 * 带确认的密码 Schema (验证两次密码一致)
 */
export const ChangePasswordWithConfirmSchema = v.pipe(
  ChangePasswordSchema,
  v.forward(
    v.check((input) => input.new_password === input.confirm_password, '两次输入的密码不一致'),
    ['confirm_password']
  )
)

/**
 * 用户创建表单类型
 */
export type UserCreateFormData = v.InferOutput<typeof UserCreateSchema>

/**
 * 用户更新表单类型
 */
export type UserUpdateFormData = v.InferOutput<typeof UserUpdateSchema>

/**
 * 修改密码表单类型
 */
export type ChangePasswordFormData = v.InferOutput<typeof ChangePasswordWithConfirmSchema>

// ==========================================
// 8. 归还模块 Schema
// ==========================================

/**
 * 归还数量验证 Schema - 用于验证归还时的剩余量或使用量
 * 支持字符串和数字输入
 * @param fieldName 字段中文名称（如"剩余量"或"使用量"）
 * @param maxValue 最大值（原借用时的剩余量）
 */
export const createReturnQuantitySchema = (fieldName: string, maxValue: number) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`),
    v.maxValue(maxValue, `${fieldName}不能超过原借用时剩余量 (${maxValue})`)
  )

/**
 * 归还表单 Schema
 */
export const ReturnFormSchema = v.object({
  return_mode: v.picklist(['used', 'remaining'], '归还模式不能为空'),
  return_quantity: v.pipe(
    v.union([v.string(), v.number()], '数量必须是有效数字'),
    v.transform(parseNumberOrNaN),
    v.number('数量必须是有效数字'),
    v.minValue(0, '数量不能为负数')
  ),
})

export type ReturnFormData = v.InferOutput<typeof ReturnFormSchema>

// ==========================================
// 9. 设备管理模块 Schema
// ==========================================

/**
 * 设备名称验证 Schema
 * 必填，最大长度50字符
 */
export const DeviceNameSchema = v.object({
  device_name: createStringLengthSchema('设备名称', 1, 50)
})

export type DeviceNameFormData = v.InferOutput<typeof DeviceNameSchema>

// ==========================================
// 10. 通用工具函数
// ==========================================

/**
 * 安全的值转换为字符串
 * 避免 [object Object] 问题
 * @param value 要转换的值
 * @param fallback 回退值，默认为 '-'
 * @returns 字符串值或回退值
 */
export const safeString = (value: unknown, fallback = '-'): string => {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  // 对象类型，返回 fallback 而不是 [object Object]
  return fallback
}

export interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

export const toValidationErrors = (detail: unknown): ValidationError[] => {
  if (!Array.isArray(detail)) return []
  return detail.filter((item): item is ValidationError => typeof item === 'object' && item !== null)
}

export const normalizeApiErrorMessage = (detail: unknown, fallback = '操作失败'): string => {
  if (typeof detail !== 'string' || !detail.trim()) return fallback

  if (detail.includes('Invalid credentials') || detail.includes('incorrect')) {
    return '用户名或密码错误'
  }
  if (detail.includes('User account is disabled')) {
    return '账号已被禁用'
  }
  if (detail.includes('Invalid CAS format')) {
    return 'CAS号格式无效'
  }
  if (detail.includes('Invalid specification format')) {
    return '规格格式无效'
  }
  if (detail.includes('Order not found')) {
    return '未找到订单'
  }
  if (detail.includes('Inventory item not found')) {
    return '未找到该库存项'
  }
  if (detail.includes('Cannot edit item while borrowed')) {
    return '借用中的试剂无法编辑，请等待归还后再操作'
  }
  if (detail.includes('Item is borrowed by another user')) {
    return '该物品已被他人借用，请刷新后重试'
  }
  if (detail.includes('Cart is empty')) {
    return '购物车不能为空'
  }
  if (detail.includes('Admin permission required')) {
    return '需要管理员权限才能访问错误日志'
  }
  if (detail.includes('Too many login attempts')) {
    return '登录尝试过多，请 5 分钟后重试'
  }
  if (detail.includes('Incorrect old password')) {
    return '原密码错误'
  }
  if (detail.includes('New password cannot be the same as old password')) {
    return '新密码不能与原密码相同'
  }
  if (detail.includes('Old password required to modify admin password')) {
    return '修改管理员密码需要提供原密码'
  }
  if (detail.includes('Too many requests')) {
    return '请求过于频繁，请稍后再试'
  }
  if (detail.includes('Token expired')) {
    return 'Token已过期，请重新生成'
  }
  if (detail.includes('Invalid CAS number')) {
    return '无效的 CAS 号'
  }
  if (detail.includes('Max announcements allowed')) {
    return '每个管理员最多创建10条公告'
  }
  if (detail.includes('Max visible announcements allowed')) {
    return '每个管理员最多显示5条公告'
  }
  if (detail.includes('Cannot borrow, current status')) {
    return '无法借用，当前状态'
  }
  if (detail.includes('Remaining quantity') && detail.includes('cannot exceed initial quantity')) {
    return '剩余量不能超过初始量'
  }
  if (detail.includes('IP limit reached')) {
    return 'IP 数量已达上限，请先移除其他设备'
  }
  if (detail.includes('Session has been revoked') || detail.includes('session expired')) {
    return '会话已失效，请重新登录'
  }

  return detail
}
