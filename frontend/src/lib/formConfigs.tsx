/** 统一管理表单字段配置。 */

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
  CommonShelfQuickOrderInputData,
  CommonShelfRemoveOneInputData,
  ChemicalNameMapFormInputData,
  ConfirmArrivalFormInputData,
  CommonPublicArrivalFormInputData,
  UserUpdateFormData,
  StockInFormInputData,
  ReturnFormInputData,
  ReagentBrandFormInputData,
} from './validationSchemas'
import {
  ORDER_REASON_OPTIONS,
  REAGENT_CATEGORY_OPTIONS,
} from './options'
import { CHEMICAL_CATEGORY_LABELS } from './constants'

type BrandAutocompleteOption = { label: string; value: string }

const EMPTY_BRAND_OPTIONS: BrandAutocompleteOption[] = []
const HAZARDOUS_NAME_ACTIVE_INPUT_CLASS =
  'border-amber-400 focus-visible:border-amber-500 focus-visible:ring-amber-400/30 dark:border-amber-500 dark:focus-visible:border-amber-400 dark:focus-visible:ring-amber-400/30'

function resolveBrandOptions(brandOptions?: BrandAutocompleteOption[]): BrandAutocompleteOption[] {
  return brandOptions ?? EMPTY_BRAND_OPTIONS
}

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
    brandOptions?: BrandAutocompleteOption[]
    requireStorageLocation?: boolean
  }
): FieldSchema<InventoryFormInputData>[] {
  const categoryOptions = config?.categoryOptions ?? REAGENT_CATEGORY_OPTIONS
  const brandOptions = resolveBrandOptions(config?.brandOptions)
  const storageLocationRequired = config?.requireStorageLocation ?? false
  const storageLocationPlaceholder = '如：6-6-6-X'

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
    {
      name: 'name' as const,
      label: '试剂名称',
      type: 'input' as const,
      required: true,
      colSpan: 2,
      placeholder: '如: 乙醇',
      suffixBooleanToggle: {
        name: 'is_hazardous' as const,
        activeInputClassName: HAZARDOUS_NAME_ACTIVE_INPUT_CLASS,
        label: '危险品',
        title: '标记为危险品',
        icon: AlertTriangle,
      },
    },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    {
      name: 'storage_location' as const,
      label: '存放位置',
      type: 'input' as const,
      required: storageLocationRequired,
      placeholder: storageLocationPlaceholder,
    },
    ...quantityFields,
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: brandOptions, required: true, placeholder: '输入品牌名称' },
    { name: 'purity' as const, label: '纯度', type: 'input' as const, placeholder: '如: 95%、AR、HPLC' },
    { name: 'category' as const, label: '分类', type: 'autocomplete' as const, options: categoryOptions, placeholder: '输入分类名称' },
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
export function getReagentOrderFormFields(config?: {
  brandOptions?: BrandAutocompleteOption[]
}): FieldSchema<ReagentOrderFormInputData>[] {
  const brandOptions = resolveBrandOptions(config?.brandOptions)

  return [
    {
      name: 'name' as const,
      label: '试剂名称',
      type: 'input' as const,
      required: true,
      colSpan: 2,
      placeholder: '如: 乙醇',
      suffixBooleanToggle: {
        name: 'is_hazardous' as const,
        activeInputClassName: HAZARDOUS_NAME_ACTIVE_INPUT_CLASS,
        label: '危险品',
        title: '标记为危险品',
        icon: AlertTriangle,
      },
    },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: true, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'purity' as const, label: '纯度', type: 'input' as const, placeholder: '如: 95%、AR、HPLC' },
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: brandOptions, required: true, placeholder: '输入品牌名称' },
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
export const defaultReturnValues: ReturnFormInputData = {
  return_mode: 'used' as const,
  specification: '',
  return_quantity: '',
  notes: '',
}


/** 获取归还表单字段配置。 */
export function getReturnFormFields(
  mode: 'remaining' | 'used',
  maxQuantity: number,
  unit?: string,
  requireSpecification = false
): FieldSchema<ReturnFormInputData>[] {
  const baseLabel = mode === 'remaining' ? '剩余量' : '使用量'
  const label = unit ? `${baseLabel} (${unit})` : baseLabel
  const fields: FieldSchema<ReturnFormInputData>[] = []
  if (requireSpecification) {
    fields.push({
      name: 'specification' as const,
      label: '规格',
      type: 'input' as const,
      required: true,
      placeholder: '如: 500ml',
    })
  }
  fields.push(
    {
      name: 'return_quantity' as const,
      label,
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: mode === 'remaining' ? `如: ${maxQuantity}` : `如: 0`,
    },
    {
      name: 'notes' as const,
      label: '修改备注',
      type: 'input' as const,
      enableTagToggle: true,
      placeholder: '选填，留空则清空备注',
    },
  )
  return fields
}

// ============================================================================
// 入库表单配置
// ============================================================================

const defaultReagentWorkflowValues = {
  name: '',
  cas_number: '',
  english_name: '',
  alias: '',
  category: '',
  brand: '',
  purity: '',
  specification: '',
  is_hazardous: false,
  notes: '',
}

const reagentWorkflowBaseFields = [
  {
    name: 'name',
    label: '试剂名称',
    type: 'input',
    required: true,
    colSpan: 2,
    placeholder: '如: 乙醇',
    suffixBooleanToggle: {
      name: 'is_hazardous',
      activeInputClassName: HAZARDOUS_NAME_ACTIVE_INPUT_CLASS,
      label: '危险品',
      title: '标记为危险品',
      icon: AlertTriangle,
    },
  },
  { name: 'cas_number', label: 'CAS号', type: 'input', required: true, readOnly: true, placeholder: 'CAS号不可修改' },
  { name: 'english_name', label: '英文名称', type: 'input', colSpan: 2, placeholder: '如: Ethanol' },
  { name: 'alias', label: '别名', type: 'input', placeholder: '如: 酒精' },
]

function getReagentWorkflowBaseFields<T extends StockInFormInputData | ConfirmArrivalFormInputData | CommonPublicArrivalFormInputData>(): FieldSchema<T>[] {
  return reagentWorkflowBaseFields as unknown as FieldSchema<T>[]
}

function getReagentWorkflowTrailingFields<T extends StockInFormInputData | ConfirmArrivalFormInputData | CommonPublicArrivalFormInputData>(
  brandOptions?: BrandAutocompleteOption[],
): FieldSchema<T>[] {
  const fields = [
    { name: 'specification', label: '规格', type: 'input', required: true, placeholder: '如: 500ml' },
    { name: 'brand', label: '品牌', type: 'autocomplete', options: resolveBrandOptions(brandOptions), required: true, placeholder: '输入品牌名称' },
    { name: 'purity', label: '纯度', type: 'input', placeholder: '如: 95%、AR、HPLC' },
    { name: 'category', label: '分类', type: 'autocomplete', options: REAGENT_CATEGORY_OPTIONS, placeholder: '输入分类名称' },
    { name: 'notes', label: '备注', type: 'input', colSpan: 3, enableTagToggle: true, placeholder: '输入 [强调] 或点击图标可进行强调' },
  ]

  return fields as unknown as FieldSchema<T>[]
}

// 入库表单默认值
export const defaultStockInValues: StockInFormInputData = {
  ...defaultReagentWorkflowValues,
  remaining_quantity: '',
  storage_location: '',
}

export const defaultConfirmArrivalValues: ConfirmArrivalFormInputData = {
  ...defaultReagentWorkflowValues,
  remaining_quantity: '',
  storage_location: '',
}

export const defaultCommonPublicArrivalValues: CommonPublicArrivalFormInputData = {
  ...defaultReagentWorkflowValues,
  storage_location: '',
}

// 获取入库表单字段配置
export function getStockInFormFields(
  unit?: string,
  locationOptions?: { label: string; value: string }[],
  config?: {
    brandOptions?: BrandAutocompleteOption[]
  },
): FieldSchema<StockInFormInputData>[] {
  return [
    ...getReagentWorkflowBaseFields<StockInFormInputData>(),
    {
      name: 'storage_location' as const,
      label: '存放位置',
      type: locationOptions ? 'autocomplete' as const : 'input' as const,
      options: locationOptions,
      required: true,
      placeholder: '如: A-1-1 柜',
    },
    {
      name: 'remaining_quantity' as const,
      label: unit ? `剩余量 (${unit})` : '剩余量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '如: 100',
    },
    ...getReagentWorkflowTrailingFields<StockInFormInputData>(config?.brandOptions),
  ]
}

export function getConfirmArrivalFormFields(
  unit?: string,
  config?: {
    brandOptions?: BrandAutocompleteOption[]
  },
): FieldSchema<ConfirmArrivalFormInputData>[] {
  return [
    ...getReagentWorkflowBaseFields<ConfirmArrivalFormInputData>(),
    {
      name: 'storage_location' as const,
      label: '存放位置',
      type: 'input' as const,
      placeholder: '暂存则留空即可',
    },
    {
      name: 'remaining_quantity' as const,
      label: unit ? `剩余量 (${unit})` : '剩余量',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '如: 100',
    },
    ...getReagentWorkflowTrailingFields<ConfirmArrivalFormInputData>(config?.brandOptions),
  ]
}

// ============================================================================
// CommonShelf 表单配置
// ============================================================================

const CHEMICAL_CATEGORY_FORM_OPTIONS = Object.entries(CHEMICAL_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function getCommonShelfManualAddFormFields(config?: {
  brandOptions?: BrandAutocompleteOption[]
  hideIdentityFields?: boolean
}): FieldSchema<CommonShelfManualAddInputData>[] {
  const brandOptions = resolveBrandOptions(config?.brandOptions)

  return [
    {
      name: 'name_snapshot' as const,
      label: '名称',
      type: 'input' as const,
      required: true,
      colSpan: 2,
      hidden: config?.hideIdentityFields,
    },
    {
      name: 'cas_number' as const,
      label: 'CAS',
      type: 'input' as const,
      required: true,
      hidden: config?.hideIdentityFields,
    },
    {
      name: 'brand' as const,
      label: '品牌',
      type: 'autocomplete' as const,
      options: brandOptions,
      required: true,
      placeholder: '输入品牌名称',
    },
    {
      name: 'purity' as const,
      label: '纯度',
      type: 'input' as const,
      placeholder: '如 95%、AR、HPLC',
    },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如 500mL' },
    { name: 'count' as const, label: '瓶数', type: 'number' as const, required: true },
    { name: 'storage_location' as const, label: '位置', type: 'input' as const, required: true },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 2 },
  ]
}

export function getCommonShelfEditFormFields(config?: {
  brandOptions?: BrandAutocompleteOption[]
}): FieldSchema<CommonShelfGroupEditInputData>[] {
  const brandOptions = resolveBrandOptions(config?.brandOptions)

  return [
    {
      name: 'brand' as const,
      label: '品牌',
      type: 'autocomplete' as const,
      options: brandOptions,
      required: true,
      placeholder: '输入品牌名称',
    },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true },
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

export function getCommonShelfQuickOrderFormFields(): FieldSchema<CommonShelfQuickOrderInputData>[] {
  return [
    { name: 'quantity' as const, label: '数量', type: 'number' as const, required: true },
    {
      name: 'price' as const,
      label: '单价(元)',
      type: 'input' as const,
      inputType: 'number' as const,
      required: true,
      placeholder: '如 100',
    },
    {
      name: 'purity' as const,
      label: '纯度',
      type: 'input' as const,
      placeholder: '如 95%、AR、HPLC',
    },
    {
      name: 'notes' as const,
      label: '备注',
      type: 'input' as const,
      colSpan: 2,
      enableTagToggle: true,
      placeholder: '选填',
    },
  ]
}

export function getCommonPublicArrivalFormFields(
  locationSuggestions: string[],
  config?: {
    brandOptions?: BrandAutocompleteOption[]
  },
): FieldSchema<CommonPublicArrivalFormInputData>[] {
  return [
    ...getReagentWorkflowBaseFields<CommonPublicArrivalFormInputData>(),
    {
      name: 'storage_location' as const,
      label: '存放位置',
      type: 'autocomplete' as const,
      options: locationSuggestions.map((item) => ({ label: item, value: item })),
      autocompleteMinSearchLength: 1,
      autocompleteShowAllOnFocus: true,
      required: true,
      placeholder: '如: A-1-1 柜',
    },
    ...getReagentWorkflowTrailingFields<CommonPublicArrivalFormInputData>(config?.brandOptions),
  ]
}

export function getCommonShelfAddBottlesFormFields(
  locationSuggestions: string[],
): FieldSchema<CommonShelfAddBottlesInputData>[] {
  return [
    { name: 'count' as const, label: '新增瓶数', type: 'number' as const, required: true },
    {
      name: 'storage_location' as const,
      label: '位置',
      type: 'autocomplete' as const,
      options: locationSuggestions.map((item) => ({ label: item, value: item })),
      autocompleteMinSearchLength: 1,
      autocompleteShowAllOnFocus: true,
      required: true,
      placeholder: '输入或选择当前位置',
    },
    {
      name: 'purity' as const,
      label: '纯度',
      type: 'input' as const,
      placeholder: '如 95%、AR、HPLC',
    },
    { name: 'notes' as const, label: '备注', type: 'input' as const, placeholder: '选填' },
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
      required: true,
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

export function getReagentBrandFormFields(): FieldSchema<ReagentBrandFormInputData>[] {
  return [
    {
      name: 'name' as const,
      label: '品牌名称',
      type: 'input' as const,
      required: true,
      placeholder: '如: 阿拉丁、Sigma',
    },
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
