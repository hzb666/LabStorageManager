import * as React from "react"
import { Controller, type UseFormReturn, type FieldPath } from "react-hook-form"
import { Input } from "./ui/Input"
import { Checkbox } from "./ui/Checkbox"
import { FormField } from "./ui/FormField"
import { cn } from "@/lib/utils"
import { INPUT_STYLES } from "@/lib/constants"

/**
 * Select 选项类型
 */
export interface SelectOption {
  label: string
  value: string | number
}

/**
 * 字段 Schema 定义
 * 描述每个表单字段的配置
 */
export interface FieldSchema<T extends Record<string, unknown>> {
  name: FieldPath<T>           // 字段名
  label: string          // 标签
  type: 'input' | 'select' | 'checkbox' | 'textarea'
  placeholder?: string
  options?: SelectOption[]  // select选项
  readOnly?: boolean
  disabled?: boolean
  colSpan?: number       // 跨列数
}

/**
 * 表单 Schema 定义
 */
export interface FormSchema<T extends Record<string, unknown>> {
  columns: number        // 每行组件数
  fields: FieldSchema<T>[]  // 字段定义
}

/**
 * BaseForm Props
 */
interface BaseFormProps<T extends Record<string, unknown>> {
  schema: FormSchema<T>
  form: UseFormReturn<T>
  disabled?: boolean
  readOnly?: boolean
  loading?: boolean
}

/**
 * BaseForm - 基于 Schema 配置的表单渲染组件
 * 
 * 使用方式：
 * ```tsx
 * const schema: FormSchema<MyFormData> = {
 *   columns: 2,
 *   fields: [
 *     { name: 'name', label: '名称', type: 'input', placeholder: '请输入名称' },
 *     { name: 'category', label: '分类', type: 'select', options: [...] },
 *     { name: 'isHazardous', label: '危险品', type: 'checkbox' },
 *     { name: 'remark', label: '备注', type: 'textarea' },
 *   ]
 * }
 * 
 * <BaseForm schema={schema} form={form} />
 * ```
 */
function BaseForm<T extends Record<string, unknown>>({
  schema,
  form,
  disabled = false,
  readOnly = false,
  loading = false,
}: BaseFormProps<T>) {
  const { control, formState: { errors } } = form

  // 获取字段的错误信息
  const getFieldError = (name: string) => {
    const error = errors[name]
    return error?.message as string | undefined
  }

  // 基础输入控件的通用样式
  const getInputClassName = (hasError: boolean) => {
    return cn(
      INPUT_STYLES.lg,
      hasError && 'border-destructive',
      disabled && 'opacity-50 cursor-not-allowed'
    )
  }

  // 渲染单个字段
  const renderField = (field: FieldSchema<T>) => {
    const hasError = !!getFieldError(field.name)
    const isDisabled = disabled || field.disabled
    const isReadOnly = readOnly || field.readOnly

    // checkbox 特殊处理 - 不需要 Label（已内置）
    if (field.type === 'checkbox') {
      return (
        <Controller
          key={field.name}
          name={field.name}
          control={control}
          render={({ field: controllerField }) => (
            <FormField
              label={field.label}
              error={getFieldError(field.name)}
              required={false}
            >
              <div className="flex items-center gap-2 h-10">
                <Checkbox
                  id={`field-${field.name}`}
                  checked={Boolean(controllerField.value)}
                  onCheckedChange={(checked) => controllerField.onChange(checked === true)}
                  disabled={isDisabled}
                  className={hasError ? 'border-destructive' : ''}
                />
                <label htmlFor={`field-${field.name}`} className="cursor-pointer text-base">
                  {field.label}
                </label>
              </div>
            </FormField>
          )}
        />
      )
    }

    // 其他类型字段 - 都在 FormField 内部渲染
    return (
      <Controller
        key={field.name}
        name={field.name}
        control={control}
        render={({ field: controllerField }) => (
          <FormField
            label={field.label}
            error={getFieldError(field.name)}
            required={false}
            className={field.colSpan ? `col-span-${field.colSpan}` : undefined}
          >
            {field.type === 'textarea' && (
              <textarea
                {...controllerField}
                id={`field-${field.name}`}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={cn(getInputClassName(hasError), "min-h-[80px] resize-y")}
              />
            )}

            {field.type === 'select' && (
              <select
                {...controllerField}
                id={`field-${field.name}`}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                disabled={isDisabled}
                className={cn(getInputClassName(hasError), "w-full")}
              >
                <option value="">{field.placeholder || '请选择'}</option>
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}

            {field.type === 'input' && (
              <Input
                {...controllerField}
                id={`field-${field.name}`}
                type="text"
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={getInputClassName(hasError)}
              />
            )}
          </FormField>
        )}
      />
    )
  }

  // 字段分组 - 按 columns 数量分组
  const fields = schema.fields
  const columns = schema.columns

  // 简单渲染：直接用 grid 布局
  return (
    <div 
      className="grid gap-x-4 gap-y-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {fields.map(renderField)}
    </div>
  )
}

export { BaseForm }
