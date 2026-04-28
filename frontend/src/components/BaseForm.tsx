import * as React from "react";
import {
  Controller,
  useWatch,
  type Control,
  type ControllerRenderProps,
  type UseFormReturn,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  Input,
  InputIconButton,
  type PrefixButtonConfig,
} from "./ui/Input";
import { Checkbox } from "./ui/Checkbox";
import { FormField } from "./ui/FormField";
import { Autocomplete, type AutocompleteOption } from "./ui/AutoComplete";
import { Textarea } from "./ui/Textarea";
import { PasswordInput } from "./ui/PasswordInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";
import { cn } from "@/lib/utils";
import { INPUT_STYLES } from "@/lib/constants";

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface FieldSchema<T extends FieldValues> {
  name: FieldPath<T>;
  label: string;
  type:
    | "input"
    | "password"
    | "select"
    | "checkbox"
    | "textarea"
    | "number"
    | "autocomplete";
  inputType?: "text" | "number";
  placeholder?: string;
  options?: AutocompleteOption[];
  autocompleteMinSearchLength?: number;
  autocompleteShowAllOnFocus?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  colSpan?: number;
  hidden?: boolean;
  required?: boolean;
  checkboxLabel?: React.ReactNode;
  hideLabel?: boolean;
  maxLength?: number;
  enableTagToggle?: boolean;
  tag?: string;
  prefixButton?: PrefixButtonConfig;
  suffixBooleanToggle?: {
    name: FieldPath<T>;
    label: string;
    title?: string;
    icon?: React.ElementType;
    activeInputClassName?: string;
  };
  autoComplete?: string;
  onBlur?: (value: unknown) => void;
}

export interface FormSchema<T extends Record<string, unknown>> {
  columns: number;
  fields: FieldSchema<T>[];
}

type BaseFormLayout = "grid" | "flex" | "stack";

interface SimpleBaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> {
  form: UseFormReturn<T, unknown, TTransformedValues>;
  fields: FieldSchema<T>[];
  columns?: number;
  layout?: BaseFormLayout;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  onSubmit?: (data: T) => void | Promise<void>;
  submitText?: string;
  loadingText?: string;
  isLoading?: boolean;
  onCancel?: () => void;
}

interface SchemaBaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> {
  schema: FormSchema<T>;
  form: UseFormReturn<T, unknown, TTransformedValues>;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  onSubmit?: (data: T) => void | Promise<void>;
  submitText?: string;
  loadingText?: string;
  isLoading?: boolean;
  onCancel?: () => void;
}

type BaseFormProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> =
  | SimpleBaseFormProps<T, TTransformedValues>
  | SchemaBaseFormProps<T, TTransformedValues>;

interface FieldRenderState {
  errorMessage?: string;
  activeInputClassName?: string;
  isDisabled: boolean;
  isReadOnly: boolean;
  showDisabledStyle: boolean;
}

interface FieldRenderContext<T extends FieldValues> {
  field: FieldSchema<T>;
  controllerField: ControllerRenderProps<T, FieldPath<T>>;
  fieldId: string;
  inputClassName: string;
  isDisabled: boolean;
  isReadOnly: boolean;
  suffix?: React.ReactNode;
}

// 从 react-hook-form 的错误对象中安全读取指定字段的错误信息。
function getFieldErrorMessage(errors: unknown, name: string) {
  if (!errors) {
    return undefined;
  }

  const errorObject = name.split(".").reduce<unknown>((accumulator, part) => {
    if (accumulator && typeof accumulator === "object") {
      return (accumulator as Record<string, unknown>)[part];
    }

    return undefined;
  }, errors);

  if (
    errorObject &&
    typeof errorObject === "object" &&
    "message" in errorObject &&
    typeof errorObject.message === "string"
  ) {
    return errorObject.message;
  }

  return undefined;
}

// 统一计算输入类控件的错误态、只读态和整体禁用态样式。
function getInputClassName({
  activeInputClassName,
  errorMessage,
  isReadOnly,
  showDisabledStyle,
}: Readonly<FieldRenderState>) {
  return cn(
    INPUT_STYLES.lg,
    activeInputClassName && !errorMessage && activeInputClassName,
    errorMessage &&
      "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
    showDisabledStyle && "opacity-50 cursor-not-allowed",
    isReadOnly && "bg-muted cursor-not-allowed",
  );
}

// 把字段跨列配置映射为静态 Tailwind class，避免运行时动态类名失效。
function getColSpanClass(colSpan?: number) {
  switch (colSpan) {
    case 1:
      return "sm:col-span-1";
    case 2:
      return "sm:col-span-2";
    case 3:
      return "sm:col-span-3";
    default:
      return "";
  }
}

// 根据布局模式生成表单容器 class，统一 grid、flex、stack 三种布局。
function getContainerClassName(
  layout: BaseFormLayout,
  className?: string,
  columns?: number,
) {
  const gridColumnsClass = getGridColumnsClass(columns);
  const baseClasses: Record<BaseFormLayout, string> = {
    grid: `grid grid-cols-1 ${gridColumnsClass} gap-4`,
    flex: "flex flex-wrap gap-4",
    stack: "space-y-4",
  };

  return `${baseClasses[layout]} ${className || ""}`.trim();
}

// 将外部 columns 约束到 1-4 列，使用静态 class 兼容 Tailwind 编译。
function getGridColumnsClass(columns?: number) {
  switch (columns) {
    case 1:
      return "sm:grid-cols-1";
    case 2:
      return "sm:grid-cols-2";
    case 4:
      return "sm:grid-cols-4";
    case 3:
    default:
      return "sm:grid-cols-3";
  }
}

// 为字段生成稳定的 DOM id，方便 label 与输入控件建立关联。
function getFieldId(name: string) {
  return `field-${name}`;
}

// 渲染多行文本字段，并沿用统一的错误态和只读/禁用规则。
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
      value={(controllerField.value as string) ?? ""}
      onChange={(event) => controllerField.onChange(event.target.value)}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      className={cn(inputClassName, "min-h-20 resize-y")}
    />
  );
}

// 渲染下拉选择字段，并保持占位文案与旧实现一致。
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
      value={(controllerField.value as string) ?? ""}
      onValueChange={controllerField.onChange}
      disabled={isDisabled}
    >
      <SelectTrigger
        id={fieldId}
        className={cn(inputClassName, "w-full min-h-10")}
      >
        <SelectValue placeholder={field.placeholder || "请选择"} />
      </SelectTrigger>
      <SelectContent>
        {field.options?.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// 渲染密码输入字段，并透传自动完成、只读和禁用属性。
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
      value={(controllerField.value as string) ?? ""}
      onChange={(event) => controllerField.onChange(event.target.value)}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      autoComplete={field.autoComplete}
      className={inputClassName}
    />
  );
}

// 渲染普通输入字段，并保持 onBlur 回调顺序不变。
function renderInputField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  inputClassName,
  isDisabled,
  isReadOnly,
  suffix,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Input
      {...controllerField}
      id={fieldId}
      type={field.type === "number" ? "number" : field.inputType || "text"}
      value={controllerField.value ?? ""}
      onChange={(event) => {
        controllerField.onChange(event.target.value)
      }}
      placeholder={field.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      aria-label={field.hideLabel ? field.label : undefined}
      autoComplete={field.autoComplete}
      className={inputClassName}
      enableTagToggle={field.enableTagToggle}
      prefixButton={field.prefixButton}
      suffix={suffix}
      tag={field.tag}
      onBlur={(event) => {
        // 先走 RHF 的 touched/校验，再通知外部回调，避免字段级副作用抢在表单状态更新之前。
        controllerField.onBlur();
        field.onBlur?.(event.target.value);
      }}
    />
  );
}

interface BooleanSuffixToggleProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> {
  control: Control<T, unknown, TTransformedValues>;
  field: FieldSchema<T>;
  disabled: boolean;
}

function BooleanSuffixToggle<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
>({
  control,
  field,
  disabled,
}: Readonly<BooleanSuffixToggleProps<T, TTransformedValues>>) {
  const toggleConfig = field.suffixBooleanToggle;
  if (!toggleConfig) {
    return null;
  }

  return (
    <Controller
      name={toggleConfig.name}
      control={control}
      render={({ field: toggleField }) => {
        const checked = Boolean(toggleField.value);

        return (
          <InputIconButton
            config={{
              active: checked,
              ariaLabel: toggleConfig.title || toggleConfig.label,
              ariaPressed: checked,
              disabled,
              icon: toggleConfig.icon,
              onBlur: toggleField.onBlur,
              onClick: () => toggleField.onChange(!checked),
              title: toggleConfig.title || toggleConfig.label,
              variant: "warning",
            }}
            placement="suffix"
          />
        );
      }}
    />
  );
}

// 渲染自动完成字段，并复用 BaseForm 的统一样式上下文。
function renderAutocompleteField<T extends FieldValues>({
  field,
  controllerField,
  inputClassName,
  isDisabled,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <Autocomplete
      options={field.options || []}
      value={(controllerField.value as string) ?? ""}
      onChange={controllerField.onChange}
      placeholder={field.placeholder}
      disabled={isDisabled}
      className={inputClassName}
      minSearchLength={field.autocompleteMinSearchLength}
      showAllOnFocus={field.autocompleteShowAllOnFocus}
    />
  );
}

// 渲染复选框字段，标签点击可切换。
function renderCheckboxField<T extends FieldValues>({
  field,
  controllerField,
  fieldId,
  isDisabled,
}: Readonly<FieldRenderContext<T>>) {
  return (
    <label
      htmlFor={fieldId}
      className="flex items-center gap-2 cursor-pointer text-base h-5"
    >
      <Checkbox
        id={fieldId}
        checked={Boolean(controllerField.value)}
        onCheckedChange={(checked) =>
          controllerField.onChange(checked === true)
        }
        disabled={isDisabled}
      />
      {field.checkboxLabel}
    </label>
  );
}

interface BaseFormFieldControlProps<
  T extends FieldValues,
> extends FieldRenderState {
  field: FieldSchema<T>;
  controllerField: ControllerRenderProps<T, FieldPath<T>>;
  suffix?: React.ReactNode;
}

// 根据字段类型分发到具体控件渲染函数，统一字段渲染入口。
function BaseFormFieldControl<T extends FieldValues>({
  field,
  controllerField,
  errorMessage,
  activeInputClassName,
  isDisabled,
  isReadOnly,
  showDisabledStyle,
  suffix,
}: Readonly<BaseFormFieldControlProps<T>>) {
  const fieldId = getFieldId(field.name as string);
  const inputClassName = getInputClassName({
    activeInputClassName,
    errorMessage,
    isDisabled,
    isReadOnly,
    showDisabledStyle,
  });
  const renderContext: FieldRenderContext<T> = {
    field,
    controllerField,
    fieldId,
    inputClassName,
    isDisabled,
    isReadOnly,
    suffix,
  };

  switch (field.type) {
    case "textarea":
      return renderTextareaField(renderContext);
    case "select":
      return renderSelectField(renderContext);
    case "password":
      return renderPasswordField(renderContext);
    case "input":
    case "number":
      return renderInputField(renderContext);
    case "autocomplete":
      return renderAutocompleteField(renderContext);
    case "checkbox":
      return renderCheckboxField(renderContext);
    default:
      return null;
  }
}

interface BaseFormFieldRendererProps<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> {
  control: Control<T, unknown, TTransformedValues>;
  field: FieldSchema<T>;
  errors: unknown;
  disabled: boolean;
  readOnly: boolean;
}

// 组合字段级错误、布局、禁用和只读状态后渲染单个字段。
function BaseFormFieldRenderer<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
>({
  control,
  field,
  errors,
  disabled,
  readOnly,
}: Readonly<BaseFormFieldRendererProps<T, TTransformedValues>>) {
  const watchedToggleValue = useWatch({
    control,
    name: field.suffixBooleanToggle?.name ?? field.name,
  });

  if (field.hidden) {
    return null;
  }

  const errorMessage = getFieldErrorMessage(errors, field.name as string);
  const renderState: FieldRenderState = {
    activeInputClassName:
      field.suffixBooleanToggle?.activeInputClassName && Boolean(watchedToggleValue)
        ? field.suffixBooleanToggle.activeInputClassName
        : undefined,
    errorMessage,
    isDisabled: disabled || field.disabled === true,
    isReadOnly: readOnly || field.readOnly === true,
    showDisabledStyle: disabled,
  };
  const suffix = field.suffixBooleanToggle ? (
    <BooleanSuffixToggle<T, TTransformedValues>
      control={control}
      field={field}
      disabled={renderState.isDisabled || renderState.isReadOnly}
    />
  ) : undefined;

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
            hideLabel={field.hideLabel || field.type === "checkbox"}
          >
            <BaseFormFieldControl
              field={field}
              controllerField={controllerField}
              errorMessage={renderState.errorMessage}
              activeInputClassName={renderState.activeInputClassName}
              isDisabled={renderState.isDisabled}
              isReadOnly={renderState.isReadOnly}
              suffix={suffix}
              showDisabledStyle={renderState.showDisabledStyle}
            />
          </FormField>
        </div>
      )}
    />
  );
}

// 判断当前 BaseForm 是否使用 schema 模式。
function isSchemaMode<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
>(
  props: BaseFormProps<T, TTransformedValues>,
): props is SchemaBaseFormProps<T, TTransformedValues> {
  return "schema" in props && !("fields" in props);
}

function BaseForm<
  T extends FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
>(props: BaseFormProps<T, TTransformedValues>) {
  const layout: BaseFormLayout =
    ("layout" in props ? props.layout : "grid") ?? "grid";
  const className = ("className" in props ? props.className : "") ?? "";
  const { form, disabled = false, readOnly = false } = props;
  const fields = isSchemaMode(props) ? props.schema.fields : props.fields;
  const columns = isSchemaMode(props) ? props.schema.columns : props.columns;
  const {
    control,
    formState: { errors },
  } = form;

  // BaseForm 负责字段区，按钮区和操作区由调用方按页面语义摆放。
  return (
    <div
      id="base-form-container"
      className={getContainerClassName(layout, className, columns)}
    >
      {fields.map((field) => (
        <BaseFormFieldRenderer<T, TTransformedValues>
          key={field.name as string}
          control={control}
          field={field}
          errors={errors}
          disabled={disabled}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

export { BaseForm };
