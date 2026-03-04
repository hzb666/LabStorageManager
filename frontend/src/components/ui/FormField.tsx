import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "./Label"

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  hideLabel?: boolean  // 是否隐藏标签（用 ::before 占据位置）
}

/**
 * FormField - 表单字段组合组件
 * 封装 Label + Input/Select + ErrorMessage 的组合
 * 支持语义化颜色和 dark mode
 * 
 * 使用示例:
 * ```tsx
 * <FormField label="规格" required error={formErrors.specification}>
 *   <Input
 *     id="add_spec"
 *     value={formData.specification}
 *     onChange={(e) => handleChange('specification', e.target.value)}
 *     className={cn(INPUT_STYLES.lg, error && 'border-destructive')}
 *   />
 * </FormField>
 * ```
 */
const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, label, error, required, children, hideLabel, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("flex flex-col", className)} {...props}>
        <Label className={cn("text-base mb-1.5 block", hideLabel && "before:content-[''] before:h-[22px] before:block")}>
          {hideLabel ? '' : label}
          {required && !hideLabel && <span className="text-destructive text-lg leading-4">&thinsp;*</span>}
        </Label>
        {children}
        {error && (
          <p className="text-sm text-destructive mt-1">{error}</p>
        )}
      </div>
    )
  }
)
FormField.displayName = "FormField"

export { FormField }
