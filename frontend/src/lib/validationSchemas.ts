/** Valibot 表单校验 Schemas。 */

import * as v from 'valibot'
import { valibotResolver } from '@hookform/resolvers/valibot'
import type { FieldValues, Resolver } from 'react-hook-form'

// 类型化 resolver，补足类型推断。
type GenericValibotSchema<
  TInput extends FieldValues = FieldValues,
  TOutput extends FieldValues = TInput,
> =
  | v.BaseSchema<TInput, TOutput, v.BaseIssue<unknown>>
  | v.BaseSchemaAsync<TInput, TOutput, v.BaseIssue<unknown>>

export function createValibotResolver<
  TInput extends FieldValues,
  TOutput extends FieldValues,
  TSchema extends GenericValibotSchema<TInput, TOutput>,
>(
  schema: TSchema
): Resolver<TInput, unknown, TOutput> {
  return valibotResolver(schema) as Resolver<TInput, unknown, TOutput>
}

const parseNumberOrNaN = (input: string | number): number => {
  if (typeof input === 'number') return input
  const parsed = Number.parseFloat(input)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}


// ==========================================
// 1. 基础通用类型验证
// ==========================================

/** 必填字符串验证。 */
export const createRequiredStringSchema = (fieldName: string) =>
  v.pipe(
    v.string(`${fieldName}不能为空`),
    v.trim(),
    v.nonEmpty(`${fieldName}不能为空`)
  )

/** 字符串长度验证。 */
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

/** 字符串最大长度验证。 */
export const createMaxLengthSchema = (
  fieldName: string,
  max: number
) =>
  v.pipe(
    v.string(),
    v.trim(),
    v.maxLength(max, `${fieldName}最多${max}个字符`)
  )

/** 正整数验证。 */
export const createPositiveNumberSchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.integer(`${fieldName}必须为整数`),
    v.minValue(1, `${fieldName}必须为大于等于1的整数`)
  )

/** 正数验证。 */
export const createQuantitySchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.gtValue(0, `${fieldName}必须大于0`)
  )

/** 非负数验证。 */
export const createNonNegativeNumberSchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`)
  )

/** 剩余量验证。 */
export const createRemainingQuantitySchema = (fieldName: string, maxValue: number) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`),
    v.maxValue(maxValue, `${fieldName}不能超过初始量 (${maxValue})`)
  )

/** 价格验证。 */
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

// 用户名验证 - 替代 validateUsername
export const UsernameSchema = v.pipe(
  v.string('用户名不能为空'),
  v.trim(),
  v.minLength(3, '用户名至少3个字符'),
  v.maxLength(20, '用户名最多20个字符'),
  v.regex(/^\w+$/, '用户名只能包含字母、数字和下划线')
)

/** 规格验证。 */
export const SpecificationSchema = v.pipe(
  v.string('规格不能为空'),
  v.trim(),
  v.nonEmpty('规格不能为空'),
  v.toLowerCase(),
  v.regex(
    /^\d+(\.\d+)?\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$/,
    '规格格式无效'
  )
)

// 规格解析辅助函数 - 从规格字符串提取数值
export function parseSpecification(spec: string): number | null {
  if (!spec) return null
  const match = /^(\d+(?:\.\d+)?)\s*/i.exec(spec)
  return match ? Number.parseFloat(match[1]) : null
}

// ==========================================
// 3. CAS 号高级验证逻辑
// ==========================================

/** 计算并校验 CAS 校验位。 */
export const validateCASLogic = (input: string): boolean => {
  if (typeof input !== 'string') return false
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

export const SPECIAL_CAS_VALUE = '生物试剂'

export const isSpecialCasValue = (input: string): boolean => {
  return input.trim().toUpperCase() === SPECIAL_CAS_VALUE
}

/** CAS 号验证。 */
export const CasNumberSchema = v.pipe(
  v.string('CAS号不能为空'),
  v.trim(),
  v.nonEmpty('CAS号不能为空'),
  v.toUpperCase(),
  v.check((input) => isSpecialCasValue(input) || /^\d{2,7}-\d{2}-\d$/.test(input), 'CAS号格式无效'),
  v.check((input) => isSpecialCasValue(input) || validateCASLogic(input), 'CAS号校验码错误')
)

// CAS 输入预校验（用于自动识别按钮）
export const validateAndNormalizeCASInput = (
  casValue: string
): { normalized: string } | { error: string } => {
  const normalized = casValue.trim().toUpperCase()
  if (!normalized) {
    return { error: '请先输入 CAS 号' }
  }

  if (isSpecialCasValue(normalized)) {
    return { normalized: SPECIAL_CAS_VALUE }
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

/** 订单原因 Schema。 */
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

/** 剩余量基础验证。 */
const RemainingQuantitySchema = v.pipe(
  v.union([
    v.pipe(v.string(), v.trim(), v.minLength(1, '剩余数量不能为空')),
    v.number()
  ], '剩余数量必须是有效数字'),
  v.transform(parseNumberOrNaN),
  v.number('剩余数量必须是有效数字'),
  v.minValue(0, '剩余数量不能为负数')
)

/** 库存表单 Schema。 */
export const InventoryFormSchema = v.object({
  // 基础字段
  name: createStringLengthSchema('名称', 1, 200),
  cas_number: CasNumberSchema,
  english_name: createMaxLengthSchema('英文名称', 200),
  alias: createMaxLengthSchema('别名', 200),
  category: createMaxLengthSchema('分类', 100),
  brand: createMaxLengthSchema('品牌', 100),
  purity: createMaxLengthSchema('纯度', 20),
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

// 库存表单 Schema 类型
export type InventoryFormData = v.InferOutput<typeof InventoryFormSchema>
export type InventoryFormInputData = v.InferInput<typeof InventoryFormSchema>

export const CommonShelfManualAddSchema = v.object({
  cas_number: CasNumberSchema,
  name_snapshot: createStringLengthSchema('名称', 1, 200),
  brand: createMaxLengthSchema('品牌', 100),
  purity: createMaxLengthSchema('纯度', 20),
  specification: SpecificationSchema,
  count: v.pipe(createPositiveNumberSchema('瓶数'), v.maxValue(99, '瓶数不能超过99')),
  storage_location: createMaxLengthSchema('存放位置', 200),
  notes: createMaxLengthSchema('备注', 100),
})

export const CommonShelfItemEditRowSchema = v.object({
  id: v.number(),
  purity: createMaxLengthSchema('纯度', 20),
  storage_location: createMaxLengthSchema('存放位置', 200),
  notes: createMaxLengthSchema('备注', 100),
})

export const CommonShelfGroupEditSchema = v.object({
  brand: createMaxLengthSchema('品牌', 100),
  specification: SpecificationSchema,
  confirm_merge: v.optional(v.boolean()),
})

export const CommonShelfAddBottlesSchema = v.object({
  count: v.pipe(createPositiveNumberSchema('新增瓶数'), v.maxValue(99, '新增瓶数不能超过99')),
  storage_location: createMaxLengthSchema('存放位置', 200),
})

export const CommonShelfRemoveOneSchema = v.object({
  storage_location: createMaxLengthSchema('存放位置', 200),
})

export const ChemicalNameMapSchema = v.object({
  cas_number: CasNumberSchema,
  name: createStringLengthSchema('中文名称', 1, 200),
  english_name: createMaxLengthSchema('英文名称', 200),
  alias_1: createMaxLengthSchema('别名1', 200),
  alias_2: createMaxLengthSchema('别名2', 200),
  alias_3: createMaxLengthSchema('别名3', 200),
  category: v.picklist(
    ['acid', 'base', 'salt', 'solvent', 'other'],
    '分类不能为空'
  ),
})

export type CommonShelfManualAddData = v.InferOutput<typeof CommonShelfManualAddSchema>
export type CommonShelfManualAddInputData = v.InferInput<typeof CommonShelfManualAddSchema>
export type CommonShelfItemEditRowData = v.InferOutput<typeof CommonShelfItemEditRowSchema>
export type CommonShelfItemEditRowInputData = v.InferInput<typeof CommonShelfItemEditRowSchema>
export type CommonShelfGroupEditData = v.InferOutput<typeof CommonShelfGroupEditSchema>
export type CommonShelfGroupEditInputData = v.InferInput<typeof CommonShelfGroupEditSchema>
export type CommonShelfAddBottlesData = v.InferOutput<typeof CommonShelfAddBottlesSchema>
export type CommonShelfAddBottlesInputData = v.InferInput<typeof CommonShelfAddBottlesSchema>
export type CommonShelfRemoveOneData = v.InferOutput<typeof CommonShelfRemoveOneSchema>
export type CommonShelfRemoveOneInputData = v.InferInput<typeof CommonShelfRemoveOneSchema>
export type ChemicalNameMapFormData = v.InferOutput<typeof ChemicalNameMapSchema>
export type ChemicalNameMapFormInputData = v.InferInput<typeof ChemicalNameMapSchema>

// ==========================================
// 5. 订单模块 Schema
// ==========================================

/** 试剂订单 Schema。 */
export const ReagentOrderSchema = v.object({
  name: createStringLengthSchema('名称', 1, 200),
  cas_number: CasNumberSchema,
  english_name: createMaxLengthSchema('英文名称', 200),
  alias: createMaxLengthSchema('别名', 200),
  category: createMaxLengthSchema('分类', 100),
  brand: createMaxLengthSchema('品牌', 100),
  purity: createMaxLengthSchema('纯度', 20),
  specification: SpecificationSchema, // 后端必填
  quantity: v.pipe(createPositiveNumberSchema('数量'), v.maxValue(99, '数量不能超过99')),
  price: createPriceSchema(0.01),  // 必填
  order_reason: OrderReasonSchema,   // 必填
  is_hazardous: v.boolean('危险品必须是布尔值'),
  notes: createMaxLengthSchema('备注', 500)
})

// 耗材订单 Schema
export const ConsumableOrderSchema = v.object({
  name: createStringLengthSchema('名称', 1, 200),
  english_name: createMaxLengthSchema('英文名称', 200),
  product_number: createMaxLengthSchema('货号', 200),  // 选填，最多200字符
  specification: createStringLengthSchema('规格', 1, 100),  // 后端必填
  unit: createMaxLengthSchema('单位', 20),  // 后端新增可选字段
  quantity: createPositiveNumberSchema('数量'),
  price: v.optional(createPriceSchema()),
  communication: v.optional(createMaxLengthSchema('沟通信息', 100)),
  notes: createMaxLengthSchema('备注', 500)
})

// 订单表单 Schema 类型
export type ReagentOrderFormData = v.InferOutput<typeof ReagentOrderSchema>
export type ConsumableOrderFormData = v.InferOutput<typeof ConsumableOrderSchema>
export type ReagentOrderFormInputData = v.InferInput<typeof ReagentOrderSchema>
export type ConsumableOrderFormInputData = v.InferInput<typeof ConsumableOrderSchema>

// ==========================================
// 6. 用户模块 Schema
// ==========================================

// 登录 Schema
export const LoginSchema = v.object({
  username: UsernameSchema,
  password: createStringLengthSchema('密码', 6, 50)
})

// 锁屏模式 Schema（只需密码）
export const LockScreenSchema = v.object({
  password: createStringLengthSchema('密码', 6, 50)
})

// 登录表单类型
export type LoginFormData = v.InferOutput<typeof LoginSchema>


// ==========================================
// 7. 用户管理模块 Schema (Admin)
// ==========================================

// 创建用户 Schema (AdminUsers 页面用)
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

// 更新用户 Schema (AdminUsers 页面用)
export const UserUpdateSchema = v.object({
  username: UsernameSchema,  // 用户名必填
  full_name: createStringLengthSchema('姓名', 1, 100),  // 必填
  role: v.optional(v.picklist(['admin', 'user', 'public']))
})


// 修改密码 Schema
export const ChangePasswordSchema = v.object({
  old_password: createStringLengthSchema('原密码', 6, 50),
  new_password: v.pipe(
    v.string('新密码不能为空'),
    v.minLength(6, '新密码至少6个字符'),
    v.maxLength(50, '新密码最多50个字符')
  ),
  confirm_password: createStringLengthSchema('确认密码', 6, 50)
})

// 带确认的密码 Schema (验证两次密码一致)
export const ChangePasswordWithConfirmSchema = v.pipe(
  ChangePasswordSchema,
  v.forward(
    v.check((input) => input.new_password === input.confirm_password, '两次输入的密码不一致'),
    ['confirm_password']
  )
)

// 用户创建表单类型
export type UserCreateFormData = v.InferOutput<typeof UserCreateSchema>

// 用户更新表单类型
export type UserUpdateFormData = v.InferOutput<typeof UserUpdateSchema>

// 修改密码表单类型
export type ChangePasswordFormData = v.InferOutput<typeof ChangePasswordWithConfirmSchema>

// ==========================================
// 8. 归还模块 Schema
// ==========================================

/** 归还数量验证 Schema。 */
export const createReturnQuantitySchema = (fieldName: string, maxValue: number) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform(parseNumberOrNaN),
    v.number(`${fieldName}必须是有效数字`),
    v.minValue(0, `${fieldName}不能为负数`),
    v.maxValue(maxValue, `${fieldName}不能超过原借用时剩余量 (${maxValue})`)
  )

// 归还表单 Schema
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
export type ReturnFormInputData = v.InferInput<typeof ReturnFormSchema>

// 入库表单 Schema
export const StockInFormSchema = v.object({
  remaining_quantity: createQuantitySchema('剩余量'),
  storage_location: createRequiredStringSchema('库存位置'),
})

export type StockInFormInputData = v.InferInput<typeof StockInFormSchema>
export type StockInFormData = v.InferOutput<typeof StockInFormSchema>

export const CommonPublicArrivalFormSchema = v.object({
  storage_location: createRequiredStringSchema('常用货架位置'),
})

export type CommonPublicArrivalFormInputData = v.InferInput<typeof CommonPublicArrivalFormSchema>
export type CommonPublicArrivalFormData = v.InferOutput<typeof CommonPublicArrivalFormSchema>

// ==========================================
// 9. 设备管理模块 Schema
// ==========================================

/** 设备名称验证 Schema。 */
export const DeviceNameSchema = v.object({
  device_name: createStringLengthSchema('设备名称', 1, 50)
})

export type DeviceNameFormData = v.InferOutput<typeof DeviceNameSchema>

// ==========================================
// 10. 通用工具函数
// ==========================================

/** 安全地把值转成字符串。 */
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

// 统一把后端字段级校验错误映射到表单字段，避免页面重复实现遍历逻辑。
export const applyValidationErrors = (
  validationErrors: ValidationError[],
  setFieldError: (fieldName: string, message: string) => void,
): boolean => {
  if (validationErrors.length === 0) {
    return false
  }

  validationErrors.forEach((errorItem) => {
    const fieldName = errorItem.loc?.[1]
    if (typeof fieldName !== 'string' && typeof fieldName !== 'number') {
      return
    }

    setFieldError(String(fieldName), errorItem.msg || '输入不合法')
  })

  return true
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const pickErrorDetailFromData = (data: unknown): unknown => {
  if (!isRecord(data)) return undefined
  if ('detail' in data) return data.detail
  if ('msg' in data) return data.msg
  if ('message' in data) return data.message
  return undefined
}

// 错误消息映射表 - 使用正则表达式模式匹配
const ERROR_MAPPINGS: Array<{ pattern: RegExp; message: string }> = [
  // 认证相关
  { pattern: /Invalid credentials|incorrect/i, message: '用户名或密码错误' },
  { pattern: /User account is disabled/i, message: '账号已被禁用' },
  { pattern: /Could not validate credentials/i, message: '认证失败，请重新登录' },
  { pattern: /Invalid or expired token/i, message: 'Token 无效或已过期' },
  { pattern: /Token expired/i, message: 'Token已过期，请重新生成' },
  { pattern: /Session expired(?!.*Token)/i, message: '会话已过期，请重新登录' },
  { pattern: /Session has been revoked|session expired/i, message: '会话已失效，请重新登录' },
  { pattern: /Session not found/i, message: '会话不存在' },
  { pattern: /No active session/i, message: '没有活跃的会话' },
  { pattern: /Session has expired/i, message: '会话已过期' },
  { pattern: /Admin privileges required|Admin permission required/i, message: '需要管理员权限' },
  { pattern: /IP address changed/i, message: 'IP 地址已变更，请重新登录' },
  { pattern: /IP limit reached/i, message: 'IP 数量已达上限，请先移除其他设备' },
  { pattern: /Too many login attempts/i, message: '登录尝试过多，请 5 分钟后重试' },
  { pattern: /Too many requests, please retry after 2 seconds/i, message: '下载过于频繁，请 2 秒后重试' },
  { pattern: /Too many requests/i, message: '请求过于频繁，请稍后再试' },

  // 密码相关
  { pattern: /Incorrect old password/i, message: '原密码错误' },
  { pattern: /New password cannot be the same as old password/i, message: '新密码不能与原密码相同' },
  { pattern: /Old password required to modify admin password/i, message: '修改管理员密码需要提供原密码' },

  // 用户相关
  { pattern: /Login failed/i, message: '登录失败' },
  { pattern: /Username already registered/i, message: '用户名已被注册' },
  { pattern: /User not found/i, message: '用户不存在' },
  { pattern: /User is already active/i, message: '用户已是激活状态' },
  { pattern: /Cannot deactivate yourself/i, message: '不能停用自己' },
  { pattern: /Cannot update other users/i, message: '不能修改其他用户的信息' },
  { pattern: /Only admin can update role/i, message: '仅管理员可更新角色' },
  { pattern: /Cannot change other users' username/i, message: '不能修改其他用户的用户名' },
  { pattern: /Cannot delete other user'.*session/i, message: '不能删除其他用户的会话' },
  { pattern: /Cannot update other user'.*session/i, message: '不能修改其他用户的会话' },
  { pattern: /Cannot delete avatar for other users/i, message: '不能删除其他用户的头像' },
  { pattern: /Cannot upload avatar for other users/i, message: '不能为其他用户上传头像' },
  { pattern: /Invalid role:/i, message: '无效的角色' },

  // 库存相关
  { pattern: /Inventory item not found/i, message: '未找到该库存项' },
  { pattern: /Cannot edit item while borrowed/i, message: '借用中的试剂无法编辑，请等待归还后再操作' },
  { pattern: /Item is borrowed by another user/i, message: '该物品已被他人借用，请刷新后重试' },
  { pattern: /Cannot borrow, current status/i, message: '无法借用，当前状态' },
  { pattern: /CommonShelf group not found|Common shelf group not found/i, message: '常用货架分组不存在' },
  { pattern: /No bottle found at selected location/i, message: '所选位置没有可扣减的瓶子' },
  { pattern: /CAS master data already exists/i, message: '该 CAS 主数据已存在' },
  { pattern: /CAS master data not found/i, message: '缺少该 CAS 的主数据，请先录入后再加入常用货架' },
  { pattern: /cannot be deleted/i, message: '该 CAS 主数据已被常用货架引用，不能删除' },
  { pattern: /Item changed by another request, please retry/i, message: '该物品状态已变更，请刷新后重试' },
  { pattern: /No available bottle in this group/i, message: '该分组已无可用瓶数' },
  { pattern: /Item is not borrowed, current status/i, message: '该物品未被借用' },
  { pattern: /You are not the borrower of this item/i, message: '你不是该物品的借用人' },
  { pattern: /Remaining quantity.*cannot exceed initial quantity/i, message: '剩余量不能超过初始量' },
  { pattern: /CAS number is required/i, message: 'CAS 号不能为空' },

  // 订单相关
  { pattern: /Order not found/i, message: '未找到订单' },
  { pattern: /order_reason is required/i, message: '申购原因不能为空' },
  { pattern: /Invalid order_reason/i, message: '申购原因无效' },
  { pattern: /Public account cannot create orders/i, message: '公用账户不能创建订单' },
  { pattern: /Public account cannot edit orders/i, message: '公用账户不能编辑订单' },
  { pattern: /Public account must select a borrower/i, message: '公用账户借用时必须选择借用人' },
  { pattern: /Please select a valid borrower/i, message: '请选择有效借用人' },
  { pattern: /You are not allowed to view this item's borrow history/i, message: '你无权查看该物品的借用历史' },
  { pattern: /Public account cannot delete orders/i, message: '公用账户不能删除订单' },
  { pattern: /Only the order applicant or admin can/i, message: '只有申请人或管理员才能执行此操作' },
  { pattern: /Approved or rejected orders can only be deleted by non-admin users/i, message: '已批准或已驳回订单不可编辑，仅可删除' },
  { pattern: /Status must be changed via workflow endpoints/i, message: '状态必须通过工作流接口变更' },
  { pattern: /Cannot approve order with status/i, message: '当前状态不允许审批订单' },
  { pattern: /Cannot reject order with status/i, message: '当前状态不允许拒绝订单' },
  { pattern: /Cannot complete order with status/i, message: '当前状态不允许完成订单' },
  { pattern: /Cannot confirm arrival for order with status/i, message: '当前状态不允许确认到货' },
  { pattern: /Order missing initial_quantity or unit/i, message: '订单缺少数量或单位，请先编辑订单' },
  { pattern: /remaining_quantity must be greater than 0/i, message: '剩余数量必须大于 0' },
  { pattern: /Invalid order quantity/i, message: '订单数量无效' },
  { pattern: /No enough pending stock items/i, message: '没有足够的待入库物品' },
  { pattern: /Order must be in APPROVED or ARRIVED status to stock in/i, message: '订单必须处于已批准或已到货状态才能入库' },
  { pattern: /Common-public orders are stocked at confirm-arrival time/i, message: '常用订单在确认到货时会直接入常用货架' },
  { pattern: /storage_location is required/i, message: '存储位置不能为空' },
  { pattern: /remaining_quantity is required for ARRIVED orders/i, message: '已到货订单需要填写剩余数量' },

  // 购物车
  { pattern: /Cart is empty/i, message: '购物车不能为空' },

  // SSE / 服务可用性
  { pattern: /No SSE rooms are accessible for current user/i, message: '当前用户没有可用的实时通知通道' },
  { pattern: /Login service temporarily unavailable/i, message: '登录服务暂时不可用，请稍后重试' },

  // 公告相关
  { pattern: /Announcement not found/i, message: '公告不存在' },
  { pattern: /Max \d+ announcements allowed/i, message: '每个管理员最多创建10条公告' },
  { pattern: /Max \d+ visible announcements allowed/i, message: '每个管理员最多显示5条公告' },
  { pattern: /Invalid filename/i, message: '文件名无效' },
  { pattern: /Image not found/i, message: '图片未找到' },
  { pattern: /Storage limit exceeded/i, message: '存储空间已满' },

  // 格式验证
  { pattern: /Invalid CAS format|Invalid CAS number/i, message: 'CAS号格式无效' },
  { pattern: /Invalid specification format/i, message: '规格格式无效' },
  { pattern: /Biological reagents do not support CAS query/i, message: '生物试剂不支持 CAS 查询' },

  // 文件服务相关
  { pattern: /Invalid file type/i, message: '文件类型无效，仅支持 xlsx、xls、csv 格式' },
  { pattern: /File size exceeds/i, message: '文件大小超过限制' },
  { pattern: /File is empty/i, message: '文件为空' },
  { pattern: /Invalid XLSX file format/i, message: '无效的 XLSX 文件格式' },
  { pattern: /Invalid XLS file format/i, message: '无效的 XLS 文件格式' },
  { pattern: /Invalid image type/i, message: '不支持该图像格式，仅支持 JPG、PNG、GIF、WebP' },
  { pattern: /Image size exceeds/i, message: '图片大小超过限制' },
  { pattern: /Invalid filename/i, message: '文件名无效' },
  { pattern: /Image not found/i, message: '图片未找到' },
  { pattern: /Storage limit exceeded/i, message: '存储空间已满' },
  { pattern: /Import failed/i, message: '导入失败' },
]

export const normalizeApiErrorMessage = (detail: unknown, fallback = '操作失败'): string => {
  if (typeof detail !== 'string' || !detail.trim()) return fallback

  // 遍历映射表查找匹配
  for (const { pattern, message } of ERROR_MAPPINGS) {
    if (pattern.test(detail)) {
      return message
    }
  }

  return detail
}

export const extractApiErrorDetail = (error: unknown): unknown => {
  if (error === null || error === undefined) return undefined
  if (typeof error === 'string') return error

  if (!isRecord(error)) return undefined

  if ('response' in error && isRecord(error.response) && 'data' in error.response) {
    const responseData = error.response.data
    const detail = pickErrorDetailFromData(responseData)
    if (detail !== undefined) return detail
    if (typeof responseData === 'string') return responseData
  }

  const directDetail = pickErrorDetailFromData(error)
  if (directDetail !== undefined) return directDetail

  if (typeof error.message === 'string') return error.message
  return undefined
}

export const getApiErrorMessage = (error: unknown, fallback = '操作失败'): string => {
  return normalizeApiErrorMessage(extractApiErrorDetail(error), fallback)
}
