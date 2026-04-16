/** 统一管理表单字段配置。 */

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import type { FieldValues } from 'react-hook-form'
import type { FieldSchema } from '../components/BaseForm'
import type { PrefixButtonConfig } from '../components/ui/Input'
import type {
  ReagentOrderFormInputData,
  ConsumableOrderFormInputData,
  InventoryFormInputData,
  CommonShelfItemEditRowInputData,
  CommonShelfManualAddInputData,
  CommonShelfGroupEditInputData,
  CommonShelfAddBottlesInputData,
  CommonShelfRemoveOneInputData,
  ChemicalNameMapFormInputData,
  CommonPublicArrivalFormInputData,
  UserUpdateFormData,
  StockInFormInputData,
  ReturnFormInputData,
} from './validationSchemas'
import {
  ORDER_REASON_OPTIONS,
  REAGENT_CATEGORY_OPTIONS,
  REAGENT_BRAND_OPTIONS,
} from './options'
import { CHEMICAL_CATEGORY_LABELS } from './constants'

// 为 `cas_number` 字段统一挂载识别按钮与可选 blur 检查，避免页面重复 map 字段。
export function enhanceCasLookupField<T extends FieldValues>(
  fields: FieldSchema<T>[],
  params: {
    prefixButton: PrefixButtonConfig
    onCasBlur?: (casValue: string) => void
  },
): FieldSchema<T>[] {
  const { prefixButton, onCasBlur } = params

  return fields.map((field) => {
    if (field.name !== 'cas_number') {
      return field
    }

    const originalOnBlur = field.onBlur
    return {
      ...field,
      onBlur: (value: unknown) => {
        originalOnBlur?.(value)
        if (typeof value === 'string') {
          onCasBlur?.(value)
        }
      },
      prefixButton,
    }
  })
}

// ============================================================================
// 库存表单配置
// ============================================================================

// 库存表单默认值
export const defaultInventoryValues: InventoryFormInputData = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  specification: '',
  category: '',
  brand: '',
  purity: '',
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
export function getInventoryFormFields(
  isEdit: boolean,
  initialQuantity?: number,
  config?: {
    categoryOptions?: { label: string; value: string }[]
    brandOptions?: { label: string; value: string }[]
  }
): FieldSchema<InventoryFormInputData>[] {
  const categoryOptions = config?.categoryOptions ?? REAGENT_CATEGORY_OPTIONS
  const brandOptions = config?.brandOptions ?? REAGENT_BRAND_OPTIONS

  // 编辑模式下显示：剩余量 + 规格；添加模式下显示：瓶数 + 规格
  const quantityFields = isEdit && initialQuantity !== undefined
    ? [
      { name: 'remaining_quantity' as const, label: '剩余量', type: 'input' as const, inputType: 'number' as const, required: true, placeholder: '如: 100' },
      { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
    ]
    : [
      { name: 'quantity_bottles' as const, label: '瓶数', type: 'input' as const, inputType: 'number' as const, required: true, placeholder: '如: 1' },
      { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
    ]

  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇' },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'storage_location' as const, label: '存放位置', type: 'input' as const, placeholder: '如: A-1-1 柜' },
    ...quantityFields,
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: brandOptions, placeholder: '输入品牌名称' },
    { name: 'purity' as const, label: '纯度', type: 'input' as const, placeholder: '如: 95%、AR、HPLC' },
    { name: 'category' as const, label: '分类', type: 'autocomplete' as const, options: categoryOptions, placeholder: '输入分类名称' },
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
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调' },
  ]
}

// ============================================================================
// 试剂订单表单配置
// ============================================================================

// 试剂订单默认值；price 和 order_reason 保持空值，交互时再由用户填写。
export const defaultReagentOrderValues = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  category: '',
  brand: '',
  purity: '',
  specification: '',
  quantity: 1,
  price: undefined as unknown as number,
  order_reason: '' as unknown as 'running_out' | 'not_stocked' | 'common_public' | 'not_found' | 'reorder' | 'high_usage' | 'degraded' | 'others',
  is_hazardous: false,
  notes: '',
}

// 耗材订单默认值
export const defaultConsumableOrderValues: ConsumableOrderFormInputData = {
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

// 获取试剂订单表单字段配置
export function getReagentOrderFormFields(): FieldSchema<ReagentOrderFormInputData>[] {
  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇' },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: REAGENT_BRAND_OPTIONS, placeholder: '输入品牌名称' },
    { name: 'purity' as const, label: '纯度', type: 'input' as const, placeholder: '如: 95%、AR、HPLC' },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' },
    {
      name: 'quantity' as const,
      label: '数量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '如: 1'
    },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, required: true, inputType: 'number' as const, placeholder: '如: 100' },
    {
      name: 'order_reason' as const,
      label: '订购原因',
      type: 'select' as const,
      options: ORDER_REASON_OPTIONS,
      required: true,
      placeholder: '请选择订购原因'
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
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调' },
  ]
}

// ============================================================================
// 用户管理表单配置
// ============================================================================

// 角色选项
export const USER_ROLE_OPTIONS: { label: string; value: string }[] = [
  { label: '用户', value: 'user' },
  { label: '管理员', value: 'admin' },
  { label: '公用', value: 'public' },
]

// 用户表单默认值
export const defaultUserValues = {
  username: '',
  password: '',
  full_name: '',
  role: 'user' as 'admin' | 'user' | 'public'
}

// 获取用户创建表单字段配置
export function getUserCreateFormFields(): FieldSchema<{ username: string; password: string; full_name: string}>[] {
  return [
    { name: 'username' as const, label: '用户名', type: 'input' as const, required: true, placeholder: '请输入用户名' },
    { name: 'password' as const, label: '密码', type: 'password' as const, required: true, placeholder: '请输入密码' },
    { name: 'full_name' as const, label: '姓名', type: 'input' as const, required: true, placeholder: '请输入姓名' },
  ]
}

// 获取用户编辑表单字段配置
export function getUserEditFormFields(): FieldSchema<UserUpdateFormData>[] {
  return [
    { name: 'username' as const, label: '用户名', type: 'input' as const, required: true, placeholder: '请输入用户名' },
    { name: 'full_name' as const, label: '姓名', type: 'input' as const, required: true, placeholder: '请输入姓名' },
  ]
}

// ============================================================================
// 耗材订单表单配置
// ============================================================================

// 获取耗材订单表单字段配置
export function getConsumableOrderFormFields(): FieldSchema<ConsumableOrderFormInputData>[] {
  return [
    { name: 'name' as const, label: '耗材名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 一次性手套' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 1, placeholder: '如: Disposable Gloves' },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: M码' },
    { name: 'product_number' as const, label: '货号', type: 'input' as const, placeholder: '如: SKU-12345' },
    {
      name: 'quantity' as const,
      label: '数量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '如: 1'
    },

    { name: 'unit' as const, label: '单位', type: 'input' as const, placeholder: '如: 箱、盒、个' },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, inputType: 'number' as const, placeholder: '选填' },
    { name: 'communication' as const, label: '订购信息', type: 'input' as const, colSpan: 3, placeholder: '如: 已加购物车、定制' },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调' },
  ]
}

// ============================================================================
// 归还表单配置
// ============================================================================

// 归还表单默认值
export const defaultReturnValues = {
  return_mode: 'used' as const,
  return_quantity: '',
}


/** 获取归还表单字段配置。 */
export function getReturnFormFields(
  mode: 'remaining' | 'used',
  maxQuantity: number,
  unit?: string
): FieldSchema<ReturnFormInputData>[] {
  const baseLabel = mode === 'remaining' ? '剩余量' : '使用量'
  const label = unit ? `${baseLabel} (${unit})` : baseLabel
  return [
    {
      name: 'return_quantity' as const,
      label,
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: mode === 'remaining' ? `如: ${maxQuantity}` : `如: 0`,
    },
  ]
}

// ============================================================================
// 入库表单配置
// ============================================================================

// 入库表单默认值
export const defaultStockInValues: StockInFormInputData = {
  remaining_quantity: '',
  storage_location: '',
}

// 获取入库表单字段配置
export function getStockInFormFields(
  unit?: string,
  locationOptions?: { label: string; value: string }[],
): FieldSchema<StockInFormInputData>[] {
  return [
    {
      name: 'remaining_quantity' as const,
      label: unit ? `剩余量 (${unit})` : '剩余量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '请输入剩余量',
    },
    {
      name: 'storage_location' as const,
      label: '库存位置',
      type: locationOptions ? 'autocomplete' as const : 'input' as const,
      options: locationOptions,
      required: true,
      placeholder: '如: A-1-1 柜',
    },
  ]
}

// ============================================================================
// CommonShelf 表单配置
// ============================================================================

const CHEMICAL_CATEGORY_FORM_OPTIONS = Object.entries(CHEMICAL_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function getCommonShelfManualAddFormFields(): FieldSchema<CommonShelfManualAddInputData>[] {
  return [
    { name: 'name_snapshot' as const, label: '名称', type: 'input' as const, required: true, colSpan: 2 },
    { name: 'cas_number' as const, label: 'CAS', type: 'input' as const, required: true },
    { name: 'brand' as const, label: '品牌', type: 'input' as const },
    { name: 'purity' as const, label: '纯度', type: 'input' as const, placeholder: '如 95%、AR、HPLC' },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如 500mL' },
    { name: 'count' as const, label: '瓶数', type: 'number' as const, required: true },
    { name: 'storage_location' as const, label: '位置', type: 'input' as const },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 2 },
  ]
}

export function getCommonShelfEditFormFields(): FieldSchema<CommonShelfGroupEditInputData>[] {
  return [
    { name: 'brand' as const, label: '品牌', type: 'input' as const },
    { name: 'specification' as const, label: '规格', type: 'input' as const },
  ]
}

export function getCommonShelfItemEditFormFields(
  hideLabel = false,
): FieldSchema<CommonShelfItemEditRowInputData>[] {
  return [
    {
      name: 'purity' as const,
      label: '纯度',
      type: 'input' as const,
      hideLabel,
      placeholder: '如 95%、AR、HPLC',
    },
    {
      name: 'storage_location' as const,
      label: '位置',
      type: 'input' as const,
      hideLabel,
      placeholder: '如 A-1-1 柜',
    },
    {
      name: 'notes' as const,
      label: '备注',
      type: 'input' as const,
      hideLabel,
      placeholder: '选填',
    },
  ]
}

export function getCommonPublicArrivalFormFields(
  locationSuggestions: string[],
): FieldSchema<CommonPublicArrivalFormInputData>[] {
  return [
    {
      name: 'storage_location' as const,
      label: '常用货架位置',
      type: 'autocomplete' as const,
      options: locationSuggestions.map((item) => ({ label: item, value: item })),
      required: true,
      placeholder: '输入或选择当前位置',
    },
  ]
}

export function getCommonShelfAddBottlesFormFields(
  locationSuggestions: string[],
): FieldSchema<CommonShelfAddBottlesInputData>[] {
  return [
    { name: 'count' as const, label: '新增瓶数', type: 'number' as const },
    {
      name: 'storage_location' as const,
      label: '位置',
      type: 'autocomplete' as const,
      options: locationSuggestions.map((item) => ({ label: item, value: item })),
      placeholder: '输入或选择当前位置',
    },
  ]
}

export function getCommonShelfRemoveOneFormFields(
  locationOptions: Array<{ value: string; label: string }>,
): FieldSchema<CommonShelfRemoveOneInputData>[] {
  return [
    {
      name: 'storage_location' as const,
      label: '位置',
      type: 'select' as const,
      options: locationOptions,
      placeholder: '请选择位置',
    },
  ]
}

export function getChemicalNameMapFormFields(
  isEdit: boolean,
): FieldSchema<ChemicalNameMapFormInputData>[] {
  return [
    {
      name: 'cas_number' as const,
      label: 'CAS',
      type: 'input' as const,
      disabled: isEdit,
      required: true,
      placeholder: '如 64-17-5',
    },
    {
      name: 'category' as const,
      label: '分类',
      type: 'select' as const,
      options: CHEMICAL_CATEGORY_FORM_OPTIONS,
      required: true,
      placeholder: '请选择分类',
    },
    {
      name: 'name' as const,
      label: '中文名称',
      type: 'input' as const,
      required: true,
      colSpan: 2,
      placeholder: '如 乙醇',
    },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如 Ethanol' },
    { name: 'alias_1' as const, label: '别名1', type: 'input' as const, placeholder: '如 酒精' },
    { name: 'alias_2' as const, label: '别名2', type: 'input' as const, placeholder: '选填' },
    { name: 'alias_3' as const, label: '别名3', type: 'input' as const, placeholder: '选填' },
  ]
}

// ============================================================================
// 设备名称表单配置
// ============================================================================

// 设备名称表单默认值
export const defaultDeviceNameValues = {
  device_name: ''
}

// 获取设备名称表单字段配置
export function getDeviceNameFormFields(): FieldSchema<typeof defaultDeviceNameValues>[] {
  return [
    { name: 'device_name' as const, label: '新设备名称', type: 'input' as const, required: true, placeholder: '请输入设备名称' }
  ]
}
