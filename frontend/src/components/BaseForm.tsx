import * as React from "react"
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type UseFormReturn,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"
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
export interface FieldSchema<T extends FieldValues> {
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

type BaseFormLayout = 'grid' | 'flex' | 'stack'

/**
 * 简化的 BaseForm Props - 支持直接传递 fields 数组
 */
interface SimpleBaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined
> {
  form: UseFormReturn<T, unknown, TTransformedValues>
  fields: FieldSchema<T>[]
  columns?: number
  layout?: BaseFormLayout  // 布局模式：grid-网格布局(默认), flex-弹性布局, stack-垂直堆叠
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
interface SchemaBaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined
> {
  schema: FormSchema<T>
  form: UseFormReturn<T, unknown, TTransformedValues>
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

type BaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined
> = SimpleBaseFormProps<T, TTransformedValues> | SchemaBaseFormProps<T, TTransformedValues>

interface FieldRenderState {
  errorMessage?: string
  isDisabled: boolean
  isReadOnly: boolean
  showDisabledStyle: boolean
}

interface FieldRenderContext<T extends FieldValues> {
  field: FieldSchema<T>
  controllerField: ControllerRenderProps<T, FieldPath<T>>
  fieldId: string
  inputClassName: string
  isDisabled: boolean
  isReadOnly: boolean
}

/** 从 react-hook-form 的错误对象中安全读取指定字段的错误信息。 */
function getFieldErrorMessage(errors: unknown, name: string) {
  if (!errors) {
    return undefined
  }

  const errorObject = name.split('.').reduce<unknown>((accumulator, part) => {
    if (accumulator && typeof accumulator === 'object') {
      return (accumulator as Record<string, unknown>)[part]
    }

    return undefined
  }, errors)

  if (
    errorObject &&
    typeof errorObject === 'object' &&
    'message' in errorObject &&
    typeof errorObject.message === 'string'
  ) {
    return errorObject.message
  }

  return undefined
}

/** 统一计算输入类控件的错误态、只读态和整体禁用态样式。 */
function getInputClassName({
  errorMessage,
  isReadOnly,
  showDisabledStyle,
}: Readonly<FieldRenderState>) {
  return cn(
    INPUT_STYLES.lg,
    errorMessage &&
      'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30',
    showDisabledStyle && 'opacity-50 cursor-not-allowed',
    isReadOnly && 'bg-muted cursor-not-allowed'
  )
}

/** 把字段跨列配置映射为静态 Tailwind class，避免运行时动态类名失效。 */
function getColSpanClass(colSpan?: number) {
  switch (colSpan) {
    case 1:
      return 'sm:col-span-1'
    case 2:
      return 'sm:col-span-2'
    case 3:
      return 'sm:col-span-3'
    default:
      return ''
  }
}

/** 根据布局模式生成表单容器 class，统一 grid、flex、stack 三种布局。 */
function getContainerClassName(layout: BaseFormLayout, className?: string) {
  const baseClasses: Record<BaseFormLayout, string> = {
    grid: 'grid grid-cols-1 sm:grid-cols-3 gap-4',
    flex: 'flex flex-wrap gap-4',
    stack: 'space-y-4',
  }

  return `${baseClasses[layout]} ${className || ''}`.trim()
}

/** 为字段生成稳定的 DOM id，方便 label 与输入控件建立关联。 */
function getFieldId(name: string) {
  return `field-${name}`
}

/** 渲染多行文本字段，并沿用统一的错误态和只读/禁用规则。 */
function renderTextareaField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  inputClassName,
  isDisabled,
  isReadOnly,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Textarea
      {...controllerField}
      id={fieldId}
      value={(controllerField.value as string) ?? ''}
      onChange={(event) => controllerField.onChange(event.target.value)}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      className={cn(inputClassName, 'min-h-20 resize-y')}
    />
  )
}

/** 渲染下拉选择字段，并保持占位文案与旧实现一致。 */
function renderSelectField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  inputClassName,
  isDisabled,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Select
      {...controllerField}
      value={(controllerField.value as string) ?? ''}
      onValueChange={controllerField.onChange}
      disabled={isDisabled}
    >
      <SelectTrigger id={fieldId} className={cn(inputClassName, 'w-full min-h-10')}>
        <SelectValue placeholder={field.placeholder || '请选择'} />
      </SelectTrigger>
      <SelectContent>
        {field.options?.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 渲染密码输入字段，并透传自动完成、只读和禁用属性。 */
function renderPasswordField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  inputClassName,
  isDisabled,
  isReadOnly,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <PasswordInput
      {...controllerField}
      id={fieldId}
      value={(controllerField.value as string) ?? ''}
      onChange={(event) => controllerField.onChange(event.target.value)}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      autoComplete={field.autoComplete}
      className={inputClassName}
    />
  )
}

/** 渲染普通输入字段，并保持 onBlur 回调顺序不变。 */
function renderInputField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  inputClassName,
  isDisabled,
  isReadOnly,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Input
      {...controllerField}
      id={fieldId}
      type={field.inputType || 'text'}
      value={(controllerField.value as string) ?? ''}
      onChange={(event) => controllerField.onChange(event.target.value)}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      autoComplete={field.autoComplete}
      className={inputClassName}
      enableTagToggle={field.enableTagToggle}
      prefixButton={field.prefixButton}
      tag={field.tag}
      onBlur={(event) => {
        controllerField.onBlur()
        field.onBlur?.(event.target.value)
      }}
    />
  )
}

/** 渲染自动完成字段，并复用 BaseForm 的统一样式上下文。 */
function renderAutocompleteField<T extends FieldValues>({
  field,
  controllerField,
  inputClassName,
  isDisabled,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Autocomplete
      options={field.options || []}
      value={(controllerField.value as string) ?? ''}
      onChange={controllerField.onChange}
      placeholder={field.placeholder}
      disabled={isDisabled}
      className={inputClassName}
    />
  )
}

/** 渲染复选框字段，并保留标签点击可切换的交互方式。 */
function renderCheckboxField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  isDisabled,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <label htmlFor={fieldId} className="flex items-center gap-2 cursor-pointer text-base h-5">
      <Checkbox
        id={fieldId}
        checked={Boolean(controllerField.value)}
        onCheckedChange={(checked) => controllerField.onChange(checked === true)}
        disabled={isDisabled}
      />
      {field.checkboxLabel}
    </label>
  )
}

interface BaseFormFieldControlProps<T extends FieldValues> extends FieldRenderState {
  field: FieldSchema<T>
  controllerField: ControllerRenderProps<T, FieldPath<T>>
}

/** 根据字段类型分发到具体控件渲染函数，统一字段渲染入口。 */
function BaseFormFieldControl<T extends FieldValues>({
  field,
  controllerField,
  errorMessage,
  isDisabled,
  isReadOnly,
  showDisabledStyle,
}: Readonly<BaseFormFieldControlProps<T>>) {
  const fieldId = getFieldId(field.name as string)
  const inputClassName = getInputClassName({
    errorMessage,
    isDisabled,
    isReadOnly,
    showDisabledStyle,
  })
  const renderContext: FieldRenderContext<T> = {
    field,
    controllerField,
    fieldId,
    inputClassName,
    isDisabled,
    isReadOnly,
  }

  switch (field.type) {
    case 'textarea':
      return renderTextareaField(renderContext)
    case 'select':
      return renderSelectField(renderContext)
    case 'password':
      return renderPasswordField(renderContext)
    case 'input':
      return renderInputField(renderContext)
    case 'autocomplete':
      return renderAutocompleteField(renderContext)
    case 'checkbox':
      return renderCheckboxField(renderContext)
    default:
      return null
  }
}

interface BaseFormFieldRendererProps<T extends FieldValues> {
  control: Control<T>
  field: FieldSchema<T>
  errors: unknown
  disabled: boolean
  readOnly: boolean
}

/** 组合字段级错误、布局、禁用和只读状态后渲染单个字段。 */
function BaseFormFieldRenderer<T extends FieldValues>({
  control,
  field,
  errors,
  disabled,
  readOnly,
}: Readonly<BaseFormFieldRendererProps<T>>) {
  if (field.hidden) {
    return null
  }

  const errorMessage = getFieldErrorMessage(errors, field.name as string)
  const renderState: FieldRenderState = {
    errorMessage,
    isDisabled: disabled || field.disabled === true,
    isReadOnly: readOnly || field.readOnly === true,
    showDisabledStyle: disabled,
  }

  return (
    <Controller
      key={field.name as string}
      name={field.name}
      control={control}
      render={({ field: controllerField }) => (
        <div className={getColSpanClass(field.colSpan)}>
          <FormField
            label={field.label}
            error={errorMessage}
            required={field.required}
            hideLabel={field.type === 'checkbox'}
          >
            <BaseFormFieldControl
              field={field}
              controllerField={controllerField}
              errorMessage={renderState.errorMessage}
              isDisabled={renderState.isDisabled}
              isReadOnly={renderState.isReadOnly}
              showDisabledStyle={renderState.showDisabledStyle}
            />
          </FormField>
        </div>
      )}
    />
  )
}

/** 判断当前 BaseForm 是否使用 schema 模式。 */
function isSchemaMode<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined
>(props: BaseFormProps<T, TTransformedValues>): props is SchemaBaseFormProps<T, TTransformedValues> {
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
/** 统一渲染 schema 模式和 fields 模式的基础表单容器。 */
function BaseForm<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined
>(props: BaseFormProps<T, TTransformedValues>) {
  const layout = 'layout' in props ? props.layout : 'grid'
  const className = 'className' in props ? props.className : ''
  const { form, disabled = false, readOnly = false } = props
  const fields = isSchemaMode(props) ? props.schema.fields : props.fields
  const { control, formState: { errors } } = form

  // 注意：按钮不在 BaseForm 中渲染，由使用方自行添加
  return (
    <div
      id="base-form-container"
      className={getContainerClassName(layout, className)}
    >
      {fields.map((field) => (
        <BaseFormFieldRenderer
          key={field.name as string}
          control={control}
          field={field}
          errors={errors}
          disabled={disabled}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

export { BaseForm }
