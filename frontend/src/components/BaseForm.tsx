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
  type: 'input' | 'select' | 'checkbox' | 'textarea' | 'number'
  inputType?: 'text' | 'number'  // input 元素的类型，默认 text
  placeholder?: string
  options?: SelectOption[]  // select选项
  readOnly?: boolean
  disabled?: boolean
  colSpan?: number       // 跨列数
  hidden?: boolean      // 是否隐藏字段
  required?: boolean     // 是否必填（用于显示 * 标记）
  checkboxLabel?: React.ReactNode  // checkbox 的自定义标签内容（可以包含图标）
  hideLabel?: boolean  // 是否隐藏标签（用 ::before 占据位置）
}

/**
 * 表单 Schema 定义
 */
export interface FormSchema<T extends Record<string, unknown>> {
  columns: number        // 每行组件数
  fields: FieldSchema<T>[]  // 字段定义
}

/**
 * 简化的 BaseForm Props - 支持直接传递 fields 数组
 */
interface SimpleBaseFormProps<T extends Record<string, unknown>> {
  form: UseFormReturn<T>
  fields: FieldSchema<T>[]
  columns?: number
  disabled?: boolean
  readOnly?: boolean
  loading?: boolean
  // 提交相关 props - 使用 react-hook-form 的 handleSubmit 返回的函数类型
  onSubmit?: (data: T) => void | Promise<void>
  submitText?: string
  loadingText?: string
  isLoading?: boolean
  onCancel?: () => void
}

/**
 * 传统的 BaseForm Props - 使用 schema 对象
 */
interface SchemaBaseFormProps<T extends Record<string, unknown>> {
  schema: FormSchema<T>
  form: UseFormReturn<T>
  disabled?: boolean
  readOnly?: boolean
  loading?: boolean
  // 提交相关 props - 使用 react-hook-form 的 handleSubmit 返回的函数类型
  onSubmit?: (data: T) => void | Promise<void>
  submitText?: string
  loadingText?: string
  isLoading?: boolean
  onCancel?: () => void
}

type BaseFormProps<T extends Record<string, unknown>> = SimpleBaseFormProps<T> | SchemaBaseFormProps<T>

// 判断是否为 Schema 模式
function isSchemaMode<T>(props: BaseFormProps<T>): props is SchemaBaseFormProps<T> {
  return 'schema' in props && !('fields' in props)
}

/**
 * BaseForm - 基于 Schema 配置的表单渲染组件
 * 
 * 两种使用方式：
 * 
 * 1. 简化的字段数组模式：
 * ```tsx
 * <BaseForm
 *   form={form}
 *   fields={[
 *     { name: 'name', label: '名称', type: 'input', required: true },
 *     { name: 'category', label: '分类', type: 'select', options: [...] },
 *   ]}
 *   columns={3}
 *   onSubmit={handleSubmit}
 *   submitText="提交"
 * />
 * ```
 * 
 * 2. Schema 模式：
 * ```tsx
 * const schema: FormSchema<MyFormData> = {
 *   columns: 2,
 *   fields: [
 *     { name: 'name', label: '名称', type: 'input', placeholder: '请输入名称' },
 *     { name: 'category', label: '分类', type: 'select', options: [...] },
 *   ]
 * }
 * 
 * <BaseForm schema={schema} form={form} />
 * ```
 */
function BaseForm<T extends Record<string, unknown>>(props: BaseFormProps<T>) {
  const { form, disabled = false, readOnly = false } = props
  
  // 获取 fields
  const fields = isSchemaMode(props) ? props.schema.fields : props.fields

  const { control, formState: { errors } } = form

  // 获取字段的错误信息
  const getFieldError = (name: string) => {
    const error = errors[name]
    return error?.message as string | undefined
  }

  // 基础输入控件的通用样式
  const getInputClassName = (hasError: boolean, isFieldReadOnly?: boolean) => {
    return cn(
      INPUT_STYLES.lg,
      hasError && 'border-destructive',
      disabled && 'opacity-50 cursor-not-allowed',
      isFieldReadOnly && 'bg-muted cursor-not-allowed'
    )
  }

  // 渲染单个字段
  const renderField = (field: FieldSchema<T>) => {
    // 隐藏字段不渲染
    if (field.hidden) {
      return null
    }

    const hasError = !!getFieldError(field.name as string)
    const isDisabled = disabled || field.disabled
    const isReadOnly = readOnly || field.readOnly

    // 其他类型字段 - 都在 FormField 内部渲染
    const colSpanClass = field.colSpan ? `sm:col-span-${field.colSpan}` : ''
    return (
      <Controller
        key={field.name as string}
        name={field.name}
        control={control}
        render={({ field: controllerField }) => (
          <div className={colSpanClass}>
            <FormField
              label={field.label}
              error={getFieldError(field.name as string)}
              required={field.required}
              hideLabel={field.type === 'checkbox'}
            >
            {field.type === 'textarea' && (
              <textarea
                {...controllerField}
                id={`field-${field.name as string}`}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={cn(getInputClassName(hasError, isReadOnly), "min-h-[80px] resize-y")}
              />
            )}

            {field.type === 'select' && (
              <select
                {...controllerField}
                id={`field-${field.name as string}`}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                disabled={isDisabled}
                className={cn(getInputClassName(hasError, isReadOnly), "w-full")}
              >
                <option value="">{field.placeholder || '请选择'}</option>
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}

            {field.type === 'number' && (
              <Input
                {...controllerField}
                id={`field-${field.name as string}`}
                type="number"
                value={controllerField.value as number ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={getInputClassName(hasError, isReadOnly)}
              />
            )}

            {field.type === 'input' && (
              <Input
                {...controllerField}
                id={`field-${field.name as string}`}
                type={field.inputType || 'text'}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={getInputClassName(hasError, isReadOnly)}
              />
            )}

            {field.type === 'checkbox' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`field-${field.name as string}`}
                  checked={Boolean(controllerField.value)}
                  onCheckedChange={(checked) => controllerField.onChange(checked === true)}
                  disabled={isDisabled}
                />
                <label 
                  htmlFor={`field-${field.name as string}`}
                  className="cursor-pointer text-base"
                >
                  {field.checkboxLabel}
                </label>
              </div>
            )}
            </FormField>
          </div>
        )}
      />
    )
  }

  // 简单渲染：直接用 grid 布局，响应式列数
  // 注意：按钮不在 BaseForm 中渲染，由使用方自行添加
  return (
    <div 
      id="base-form-container"
      className="grid grid-cols-1 sm:grid-cols-3 gap-4"
    >
      {fields.map(renderField)}
    </div>
  )
}

export { BaseForm }
