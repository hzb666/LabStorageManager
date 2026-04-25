import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "./Label"

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  hideLabel?: boolean  // 是否隐藏可见标签
}

/**
 * 表单字段组合组件。
 * 封装标签、控件和错误提示，并支持语义化颜色与深色模式。
 */
const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, label, error, required, children, hideLabel, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("flex flex-col", className)} {...props}>
        {!hideLabel && (
          <Label className="text-base mb-1.5 block">
            {label}
            {required && <span className="text-destructive text-lg leading-4">&thinsp;*</span>}
          </Label>
        )}
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
