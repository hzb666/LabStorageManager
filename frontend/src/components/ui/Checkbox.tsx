import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// 使用 React.memo 优化 Checkbox 组件，避免不必要的重新渲染
const Checkbox = React.memo(React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // 1. 基础样式与瞬间切换的状态（移除了原本的 transition-colors 和 hover:bg-*）
      "peer bg-card h-5 w-5 shrink-0 rounded-sm border border-input accent-card ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",

      // 2. 用 before 伪元素接管 Hover 的颜色过渡
      "relative before:absolute before:inset-0 before:rounded-sm before:bg-accent dark:before:bg-input/50 before:opacity-0 data-[state=unchecked]:hover:before:opacity-100 before:transition-opacity data-[state=checked]:before:duration-0",

      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current pt-0.5")}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
)))

Checkbox.displayName = "Checkbox"

export { Checkbox }
