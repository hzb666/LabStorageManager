/**
 * 表单字段配置
 * 统一管理库存、试剂订单和耗材订单的表单字段配置，供 BaseForm 组件使用
 */

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import type { FieldSchema } from '../components/BaseForm'
import type { ReagentOrderFormData, ConsumableOrderFormData, InventoryFormData } from './validationSchemas'
import { ORDER_REASON_OPTIONS, REAGENT_CATEGORY_OPTIONS, REAGENT_BRAND_OPTIONS } from './options'

// ============================================================================
// 库存表单配置
// ============================================================================

/** 库存表单默认值 */
export const defaultInventoryValues: InventoryFormData = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  specification: '',
  category: '',
  brand: '',
  storage_location: '',
  is_hazardous: false,
  notes: '',
  quantity_bottles: 1,
  initial_quantity: undefined,
  unit: undefined,
  remaining_quantity: undefined
}

/**
 * 获取库存表单字段配置
 * @param isEdit 是否为编辑模式
 * @param initialQuantity 初始数量（编辑模式下使用）
 */
export function getInventoryFormFields(isEdit: boolean, initialQuantity?: number): FieldSchema<InventoryFormData>[] {
  // 编辑模式下显示：剩余量 + 规格；添加模式下显示：瓶数 + 规格
  const quantityFields = isEdit && initialQuantity !== undefined
    ? [
      { name: 'remaining_quantity' as const, label: '剩余量', type: 'input' as const, inputType: 'number' as const, required: true, placeholder: '如: 100', min: 0 },
      { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
    ]
    : [
      { name: 'quantity_bottles' as const, label: '瓶数', type: 'input' as const, inputType: 'number' as const, required: true, placeholder: '如: 1', min: 1 },
      { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
    ]

  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇', maxLength: 200 },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol', maxLength: 200 },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精', maxLength: 200 },
    { name: 'storage_location' as const, label: '存放位置', type: 'input' as const, placeholder: '如: A-1-1 柜', maxLength: 200 },
    ...quantityFields,
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: REAGENT_BRAND_OPTIONS, placeholder: '输入品牌名称', maxLength: 100 },
    { name: 'category' as const, label: '分类', type: 'autocomplete' as const, options: REAGENT_CATEGORY_OPTIONS, placeholder: '输入分类名称', maxLength: 100 },
    {
      name: 'is_hazardous' as const,
      label: '危险品',
      type: 'checkbox' as const,
      checkboxLabel: (
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          危险品
        </span>
      )
    },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调', maxLength: 500 },
  ]
}

// ============================================================================
// 试剂订单表单配置
// ============================================================================

// 试剂订单默认值
export const defaultReagentOrderValues: ReagentOrderFormData = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  category: '',
  brand: '',
  specification: '',
  quantity: 1,
  price: 0,
  order_reason: undefined,
  is_hazardous: false,
  notes: '',
}

// 耗材订单默认值
export const defaultConsumableOrderValues: ConsumableOrderFormData = {
  name: '',
  english_name: '',
  product_number: '',
  specification: '',
  unit: '',
  quantity: 1,
  price: undefined,
  communication: '',
  notes: '',
}

/**
 * 获取试剂订单表单字段配置
 * @param isEdit 是否为编辑模式
 */
export function getReagentOrderFormFields(isEdit: boolean): FieldSchema<ReagentOrderFormData>[] {
  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇', maxLength: 200 },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol', maxLength: 200 },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精', maxLength: 200 },
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: REAGENT_BRAND_OPTIONS, placeholder: '输入品牌名称', maxLength: 100 },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml', maxLength: 100 },
    {
      name: 'quantity' as const,
      label: '数量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      min: 1,
      placeholder: '如: 1'
    },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, required: true, inputType: 'number' as const, placeholder: '如: 100' },
    {
      name: 'order_reason' as const,
      label: '申购原因',
      type: 'autocomplete' as const,
      options: ORDER_REASON_OPTIONS,
      placeholder: '输入或选择申购原因'
    },
    {
      name: 'is_hazardous' as const,
      label: '危险品',
      type: 'checkbox' as const,
      checkboxLabel: (
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          危险品
        </span>
      )
    },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调', maxLength: 500 },
  ]
}

// ============================================================================
// 用户管理表单配置
// ============================================================================

/** 角色选项 */
export const USER_ROLE_OPTIONS: { label: string; value: string }[] = [
  { label: '用户', value: 'user' },
  { label: '管理员', value: 'admin' },
]

// 用户表单默认值
export const defaultUserValues = {
  username: '',
  full_name: '',
  role: 'user' as 'admin' | 'user'
}

/**
 * 获取用户创建表单字段配置
 */
export function getUserCreateFormFields(): FieldSchema<{ username: string; full_name: string; role: 'admin' | 'user' }>[] {
  return [
    { name: 'username' as const, label: '用户名', type: 'input' as const, required: true, placeholder: '请输入用户名', maxLength: 20 },
    { name: 'full_name' as const, label: '姓名', type: 'input' as const, required: true, placeholder: '请输入姓名', maxLength: 100 },
    { name: 'role' as const, label: '角色', type: 'select' as const, options: USER_ROLE_OPTIONS, required: true },
  ]
}

/**
 * 获取用户编辑表单字段配置
 */
export function getUserEditFormFields(): FieldSchema<{ username: string; full_name: string; role: 'admin' | 'user' }>[] {
  return [
    { name: 'username' as const, label: '用户名', type: 'input' as const, required: true, placeholder: '请输入用户名', maxLength: 20 },
    { name: 'full_name' as const, label: '姓名', type: 'input' as const, required: true, placeholder: '请输入姓名', maxLength: 100 },
    { name: 'role' as const, label: '角色', type: 'select' as const, options: USER_ROLE_OPTIONS, required: true },
  ]
}

// ============================================================================
// 耗材订单表单配置
// ============================================================================

/**
 * 获取耗材订单表单字段配置
 * @param isEdit 是否为编辑模式
 */
export function getConsumableOrderFormFields(_isEdit: boolean): FieldSchema<ConsumableOrderFormData>[] {
  return [
    { name: 'name' as const, label: '耗材名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 一次性手套', maxLength: 200 },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 1, placeholder: '如: Disposable Gloves', maxLength: 200 },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: M码', maxLength: 100 },
    { name: 'product_number' as const, label: '货号', type: 'input' as const, placeholder: '如: SKU-12345', maxLength: 200 },
    {
      name: 'quantity' as const,
      label: '数量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      min: 1,
      placeholder: '如: 1'
    },

    { name: 'unit' as const, label: '单位', type: 'input' as const, placeholder: '如: 箱、盒、个', maxLength: 20 },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, inputType: 'number' as const, placeholder: '选填' },
    { name: 'communication' as const, label: '订购信息', type: 'input' as const, colSpan: 3, placeholder: '如: 已加购物车、定制', maxLength: 100 },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调', maxLength: 500 },
  ]
}
