import * as React from "react"
import { cn } from "@/lib/utils"
import { defaultInputStyles, type InputStyles } from "@/lib/inputConfigs"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  styles?: Partial<InputStyles>;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, styles: customStyles, ...props }, ref) => {
    const styles = { ...defaultInputStyles, ...customStyles } as InputStyles

    return (
      <textarea
        data-slot="textarea"
        ref={ref}
        className={cn(
          styles.input.base,
          styles.input.inactive,
          // 去掉 !h-auto 允许拖拽改变高度，保留其他 ! 强制覆盖单行居中排版
          "h-auto min-h-16 resize-y block w-full !py-2 !px-3 !leading-normal",
          // 仅保留颜色和阴影的过渡，解决拖拽卡顿
          "transition-[color,box-shadow,border-color]",
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }