/**
 * 订单表单字段配置
 * 统一管理试剂订单和耗材订单的表单字段配置，供 BaseForm 组件使用
 */

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import type { FieldSchema } from '../components/BaseForm'
import type { ReagentOrderFormData, ConsumableOrderFormData } from './validationSchemas'
import { ORDER_REASON_OPTIONS, REAGENT_CATEGORY_OPTIONS, REAGENT_BRAND_OPTIONS } from './options'

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
  alias: '',
  category: '',
  brand: '',
  specification: '',
  unit: '',
  quantity: 1,
  price: 0,
  notes: '',
}

/**
 * 获取试剂订单表单字段配置
 * @param isEdit 是否为编辑模式
 */
export function getReagentOrderFormFields(isEdit: boolean): FieldSchema<ReagentOrderFormData>[] {
  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇' },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: !isEdit, readOnly: isEdit, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'category' as const, label: '分类', type: 'autocomplete' as const, options: REAGENT_CATEGORY_OPTIONS, placeholder: '输入分类名称' },
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: REAGENT_BRAND_OPTIONS, placeholder: '输入品牌名称' },
    { name: 'specification' as const, label: '规格', type: 'input' as const, placeholder: '如: 500ml' },
    { 
      name: 'quantity' as const, 
      label: '数量', 
      type: 'input' as const, 
      inputType: 'number' as const,
      required: true, 
      min: 1,
      placeholder: '如: 1' 
    },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, inputType: 'number' as const, placeholder: '如: 100' },
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
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, placeholder: '其他说明...' },
  ]
}

/**
 * 获取耗材订单表单字段配置
 * @param isEdit 是否为编辑模式
 */
export function getConsumableOrderFormFields(_isEdit: boolean): FieldSchema<ConsumableOrderFormData>[] {
  return [
    { name: 'name' as const, label: '耗材名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 一次性手套' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Disposable Gloves' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 实验手套' },
    { name: 'category' as const, label: '分类', type: 'autocomplete' as const, options: REAGENT_CATEGORY_OPTIONS, placeholder: '输入分类名称' },
    { name: 'brand' as const, label: '品牌', type: 'autocomplete' as const, options: REAGENT_BRAND_OPTIONS, placeholder: '输入品牌名称' },
    { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: M码' },
    { name: 'unit' as const, label: '单位', type: 'input' as const, placeholder: '如: 箱、盒、个' },
    { 
      name: 'quantity' as const, 
      label: '数量', 
      type: 'input' as const, 
      inputType: 'number' as const,
      required: true, 
      min: 1,
      placeholder: '如: 1' 
    },
    { name: 'price' as const, label: '单价(元)', type: 'input' as const, inputType: 'number' as const, placeholder: '如: 50' },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, placeholder: '其他说明...' },
  ]
}
