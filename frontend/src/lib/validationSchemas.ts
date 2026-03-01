/**
 * Valibot 验证 Schemas
 * 基于 inputValidation.ts 中的验证逻辑，使用 Valibot Pipeline 模式封装
 * 参考文档: docs/plans/输入验证与状态管理.md
 * 
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

// 重新导出 valibotResolver 方便使用
export { valibotResolver }

// ==========================================
// 1. 基础通用类型验证
// ==========================================

/**
 * 必填字符串验证 - 替代 validateRequired
 * @param fieldName 字段中文名称
 */
export const createRequiredStringSchema = (fieldName: string) =>
  v.pipe(
    v.string(`${fieldName}必须是字符串`),
    v.trim(),
    v.minLength(1, `${fieldName}不能为空`)
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
 * 正整数验证 (>=1) - 用于瓶数等必须为整数的字段
 * 支持字符串和数字输入，在 handleSubmit 中手动转换
 * @param fieldName 字段中文名称
 */
export const createPositiveNumberSchema = (fieldName: string) =>
  v.pipe(
    v.union([v.string(), v.number()], `${fieldName}必须是有效数字`),
    v.transform((input) => {
      if (typeof input === 'number') return input
      const num = parseFloat(input)
      return isNaN(num) ? input : num
    }),
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
    v.transform((input) => {
      if (typeof input === 'number') return input
      const num = parseFloat(input)
      return isNaN(num) ? input : num
    }),
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
    v.transform((input) => {
      if (typeof input === 'number') return input
      const num = parseFloat(input)
      return isNaN(num) ? input : num
    }),
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
    v.transform((input) => {
      if (typeof input === 'number') return input
      const num = parseFloat(input)
      return isNaN(num) ? input : num
    }),
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
    v.transform((input) => {
      if (typeof input === 'number') return input
      const num = parseFloat(input)
      return isNaN(num) ? input : num
    }),
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
  v.regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线')
)

/**
 * 密码验证 - 仅验证底线
 * 强度计算由组件自行处理
 */
export const PasswordBaseSchema = v.pipe(
  v.string('密码不能为空'),
  v.minLength(6, '密码至少6个字符')
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
  const match = spec.match(/^(\d+\.?\d*)\s*/i)
  return match ? parseFloat(match[1]) : null
}

// ==========================================
// 3. CAS 号高级验证逻辑
// ==========================================

/**
 * CAS 校验码计算逻辑
 * CAS号格式：三部分组成，第一部分2-6位数字，第二部分2位数字，第三部分1位校验码
 * 校验码计算：将第一二部分的数字从右到左依次乘以1,2,3...，求和后取模10
 */
const validateCASLogic = (input: string): boolean => {
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
    const digit = parseInt(digits[i], 10)
    const multiplier = i + 1
    sum += digit * multiplier
  }

  const calculatedCheckDigit = sum % 10
  const actualCheckDigit = parseInt(thirdPart, 10)

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
  v.regex(/^\d{2,6}-\d{2}-\d$/, 'CAS号格式无效'),
  v.check((input) => validateCASLogic(input), 'CAS号校验码错误')
)

// ==========================================
// 4. 库存模块 Schema
// ==========================================

/**
 * 统一库存表单 Schema（用于手动入库和编辑）
 * 包含所有库存相关字段
 * - 添加模式：name, specification, quantity_bottles 为必填
 * - 编辑模式：remaining_quantity 为必填
 */
export const InventoryFormSchema = v.object({
  // 基础字段
  name: createRequiredStringSchema('名称'),
  cas_number: CasNumberSchema,
  english_name: v.optional(v.string()),
  alias: v.optional(v.string()),
  category: v.optional(v.string()),
  brand: v.optional(v.string()),
  specification: SpecificationSchema, // 必填
  storage_location: v.optional(v.string()),
  notes: v.optional(v.string()),

  // 数量相关
  quantity_bottles: v.optional(createPositiveNumberSchema('瓶数')),
  initial_quantity: v.optional(createNonNegativeNumberSchema('初始数量')),
  remaining_quantity: v.optional(createNonNegativeNumberSchema('剩余数量')),

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
 */
export const ReagentOrderSchema = v.object({
  name: createRequiredStringSchema('名称'),
  cas_number: CasNumberSchema,
  english_name: v.optional(v.string()),
  alias: v.optional(v.string()),
  category: v.optional(v.string()),
  brand: v.optional(v.string()),
  specification: v.optional(SpecificationSchema),
  quantity: createPositiveNumberSchema('数量'),
  price: v.optional(createPriceSchema()),
  supplier: v.optional(v.string()),
  notes: v.optional(v.string())
})

/**
 * 耗材订单 Schema
 */
export const ConsumableOrderSchema = v.object({
  name: createRequiredStringSchema('名称'),
  english_name: v.optional(v.string()),
  alias: v.optional(v.string()),
  category: v.optional(v.string()),
  brand: v.optional(v.string()),
  specification: v.optional(SpecificationSchema),
  quantity: createPositiveNumberSchema('数量'),
  price: v.optional(createPriceSchema()),
  notes: v.optional(v.string())
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
  username: createRequiredStringSchema('用户名'),
  password: createRequiredStringSchema('密码')
})

/**
 * 登录表单类型
 */
export type LoginFormData = v.InferOutput<typeof LoginSchema>

/**
 * 用户创建/更新 Schema
 */
export const UserSchema = v.object({
  username: UsernameSchema,
  password: PasswordBaseSchema,
  full_name: v.optional(v.string()),
  role: v.optional(v.picklist(['admin', 'user']))
})

/**
 * 用户表单 Schema 类型
 */
export type UserFormData = v.InferOutput<typeof UserSchema>
