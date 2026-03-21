import * as React from "react"
import { Controller, type UseFormReturn, type FieldPath } from "react-hook-form"
import { Input, type PrefixButtonConfig } from "./ui/Input"
import { Checkbox } from "./ui/Checkbox"
import { FormField } from "./ui/FormField"
import { Autocomplete, type AutocompleteOption } from "./ui/AutoComplete"
import { Textarea } from "./ui/Textarea"
import { PasswordInput } from "./ui/PasswordInput"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select"
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
  type: 'input' | 'password' | 'select' | 'checkbox' | 'textarea' | 'number' | 'autocomplete'
  inputType?: 'text' | 'number'  // input 元素的类型，默认 text
  placeholder?: string
  options?: AutocompleteOption[]  // select/autocomplete选项
  readOnly?: boolean
  disabled?: boolean
  colSpan?: number       // 跨列数
  hidden?: boolean      // 是否隐藏字段
  required?: boolean     // 是否必填（用于显示 * 标记）
  checkboxLabel?: React.ReactNode  // checkbox 的自定义标签内容（可以包含图标）
  hideLabel?: boolean  // 是否隐藏标签（用 ::before 占据位置）
  maxLength?: number   // 文本字段的最大字符数
  enableTagToggle?: boolean  // 是否开启状态功能（如 [强调] 前缀）
  tag?: string        // 标签前缀（默认 [强调]），与 enableTagToggle 配合使用
  prefixButton?: PrefixButtonConfig  // 输入框左侧按钮配置
  autoComplete?: string  // 自动完成属性（如 "username", "current-password" 等）
  onBlur?: (value: unknown) => void // 输入框失焦回调（用于按需触发查询）
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
  layout?: 'grid' | 'flex' | 'stack'  // 布局模式：grid-网格布局(默认), flex-弹性布局, stack-垂直堆叠
  className?: string   // 自定义容器类名
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
function isSchemaMode<T extends Record<string, unknown>>(props: BaseFormProps<T>): props is SchemaBaseFormProps<T> {
  return 'schema' in props && !('fields' in props)
}

/**
 * BaseForm - 基于 Schema 配置的表单渲染组件
 * * 两种使用方式：
 * * 1. 简化的字段数组模式：
 * ```tsx
 * <BaseForm
 * form={form}
 * fields={[
 * { name: 'name', label: '名称', type: 'input', required: true },
 * { name: 'category', label: '分类', type: 'select', options: [...] },
 * ]}
 * columns={3}
 * onSubmit={handleSubmit}
 * submitText="提交"
 * />
 * ```
 * * 2. Schema 模式：
 * ```tsx
 * const schema: FormSchema<MyFormData> = {
 * columns: 2,
 * fields: [
 * { name: 'name', label: '名称', type: 'input', placeholder: '请输入名称' },
 * { name: 'category', label: '分类', type: 'select', options: [...] },
 * ]
 * }
 * * <BaseForm schema={schema} form={form} />
 * ```
 */
function BaseForm<T extends Record<string, unknown>>(props: BaseFormProps<T>) {
  // 获取 layout 和 className（从 props 中解构）
  const layout = 'layout' in props ? props.layout : 'grid'
  const className = 'className' in props ? props.className : ''
  const { form, disabled = false, readOnly = false } = props

  // 获取 fields
  const fields = isSchemaMode(props) ? props.schema.fields : props.fields

  const { control, formState: { errors } } = form

  // ==========================================
  // 🛠️ 核心修复区域：安全的错误获取逻辑 (严格类型版)
  // ==========================================
  const getFieldError = (name: string) => {
    // 1. 防御性保护
    if (!errors) return undefined;

    // 2. 解析嵌套路径（使用 unknown 泛型替代 any）
    const errorObj = name.split('.').reduce<unknown>((acc, part) => {
      // 只有当 acc 是对象时，才安全地向下读取属性
      if (acc && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, errors);

    // 3. 严格类型校验：判断提取出的对象是否有 message 且为 string 类型
    if (
      errorObj &&
      typeof errorObj === 'object' &&
      'message' in errorObj &&
      typeof errorObj.message === 'string'
    ) {
      return errorObj.message;
    }

    return undefined;
  }

  // 基础输入控件的通用样式
  const getInputClassName = (hasError: boolean, isFieldReadOnly?: boolean) => {
    return cn(
      INPUT_STYLES.lg,
      hasError && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30',
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

    const hasError = getFieldError(field.name as string) !== undefined
    const isDisabled = disabled || field.disabled
    const isReadOnly = readOnly || field.readOnly

    // 其他类型字段 - 都在 FormField 内部渲染
    // 使用 switch 确保 Tailwind JIT 编译器能识别静态类名
    const colSpanClass = (() => {
      switch (field.colSpan) {
        case 1: return 'sm:col-span-1'
        case 2: return 'sm:col-span-2'
        case 3: return 'sm:col-span-3'
        default: return ''
      }
    })()
    
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
                <Textarea
                  {...controllerField}
                  id={`field-${field.name as string}`}
                  value={(controllerField.value as string) ?? ''}
                  onChange={(e) => controllerField.onChange(e.target.value)}
                  placeholder={field.placeholder}
                  disabled={isDisabled}
                  readOnly={isReadOnly}
                  className={cn(getInputClassName(hasError, isReadOnly), "min-h-20 resize-y")}
                />
              )}

              {field.type === 'select' && (
                <Select
                  {...controllerField}
                  value={(controllerField.value as string) ?? ''}
                  onValueChange={controllerField.onChange}
                  disabled={isDisabled}
                >
                  <SelectTrigger id={`field-${field.name as string}`} className={cn(getInputClassName(hasError, isReadOnly), "w-full min-h-10")}>
                    <SelectValue placeholder={field.placeholder || '请选择'} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map(opt => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

            {field.type === 'password' && (
              <PasswordInput
                {...controllerField}
                id={`field-${field.name as string}`}
                value={(controllerField.value as string) ?? ''}
                onChange={(e) => controllerField.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                autoComplete={field.autoComplete}
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
                  autoComplete={field.autoComplete}
                  className={getInputClassName(hasError, isReadOnly)}
                  enableTagToggle={field.enableTagToggle}
                  prefixButton={field.prefixButton}
                  tag={field.tag}
                  onBlur={(e) => {
                    controllerField.onBlur()
                    field.onBlur?.(e.target.value)
                  }}
                />
              )}

              {field.type === 'autocomplete' && (
                <Autocomplete
                  options={field.options || []}
                  value={(controllerField.value as string) ?? ''}
                  onChange={controllerField.onChange}
                  placeholder={field.placeholder}
                  disabled={isDisabled}
                  className={getInputClassName(hasError, isReadOnly)}
                />
              )}

              {field.type === 'checkbox' && (
                <label
                  htmlFor={`field-${field.name as string}`}
                  className="flex items-center gap-2 cursor-pointer text-base h-5"
                >
                  <Checkbox
                    id={`field-${field.name as string}`}
                    checked={Boolean(controllerField.value)}
                    onCheckedChange={(checked) => controllerField.onChange(checked === true)}
                    disabled={isDisabled}
                  />
                  {field.checkboxLabel}
                </label>
              )}
            </FormField>
          </div>
        )}
      />
    )
  }

  // 根据布局模式生成容器类名
  const getContainerClassName = () => {
    const baseClasses: Record<string, string> = {
      grid: 'grid grid-cols-1 sm:grid-cols-3 gap-4',
      flex: 'flex flex-wrap gap-4',
      stack: 'space-y-4',
    }
    const currentLayout = layout || 'grid'
    return `${baseClasses[currentLayout]} ${className || ''}`.trim()
  }

  // 注意：按钮不在 BaseForm 中渲染，由使用方自行添加
  return (
    <div
      id="base-form-container"
      className={getContainerClassName()}
    >
      {fields.map(renderField)}
    </div>
  )
}

export { BaseForm }
