import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown } from "lucide-react"
import { inputConfigs } from "@/lib/inputConfigs"
// 导入上面的 inputConfigs

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  step?: number; min?: number; max?: number;
  prefix?: React.ReactNode; suffix?: React.ReactNode;
  tag?: string; enableTagToggle?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, step = 1, min = 0, max = Infinity, prefix, suffix, tag = "[强调]", enableTagToggle = false, value, onChange, ...props }, ref) => {
    const isNumber = type === "number"
    const rawValue = String(value || "")
    const isActive = enableTagToggle && rawValue.startsWith(tag)
    const displayValue = isActive ? rawValue.slice(tag.length) : rawValue

    const activeConfig = inputConfigs[tag] || inputConfigs["[强调]"]
    const Icon = activeConfig.icon

    const emitChange = (nextPlainText: string, shouldHaveTag: boolean) => {
      const finalValue = shouldHaveTag ? `${tag}${nextPlainText}` : nextPlainText
      onChange?.({ target: { ...props, value: finalValue } } as React.ChangeEvent<HTMLInputElement>)
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!enableTagToggle) return onChange?.(e)
      const val = e.target.value
      // 输入为空时强制不添加标签，允许清空
      if (val === "") {
        emitChange("", false)
        return
      }
      if (!isActive && val.includes(tag)) emitChange(val.replace(tag, ""), true)
      else emitChange(val, isActive)
    }

    const handleStatusToggle = (e: React.MouseEvent) => {
      e.preventDefault()
      emitChange(displayValue, !isActive)
    }

    const handleNumberChange = (delta: number) => {
      const currentNum = displayValue === "" ? 0 : Number(displayValue)
      emitChange(String(Math.max(min, Math.min(max, currentNum + delta))), isActive)
    }

    return (
      <div className="relative flex items-center w-full group">
        {(enableTagToggle || prefix) && (
          <div className="absolute left-1.5 top-1 bottom-1 flex items-center z-10">
            {enableTagToggle ? (
              <button
                type="button"
                onClick={handleStatusToggle}
                // 1. 给按钮加上 group 类，作为固定的触发热区
                className={cn(
                  "group inline-flex h-7 w-7 items-center justify-center rounded outline-none p-0",
                  // 按钮本身只做颜色过渡，绝对不改变大小
                  "transition-colors duration-300 ease-out",
                  isActive
                    ? activeConfig.text
                    : "text-muted-foreground/30 hover:text-muted-foreground/70"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-all duration-300 ease-out",
                    // 2. 将 hover 和 active 的缩放效果转移到内部图标上 (使用 group-hover)
                    "group-hover:scale-110 group-active:scale-90",
                    isActive ? "fill-current" : "fill-transparent"
                  )}
                />
              </button>
            ) : (
              <div className="pl-1.5">{prefix}</div>
            )}
          </div>
        )}

        <input
          {...props}
          type={(enableTagToggle && isNumber) ? "text" : type}
          ref={ref}
          value={displayValue}
          onChange={handleInputChange}
          className={cn(
            // 基础框架：去除繁杂，保留纯粹的 1px 边框和柔和阴影
            "inline-flex h-10 leading-10! w-full rounded-md border bg-card text-base",
            "transition-all duration-300 ease-out",
            "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ring-offset-background",

            // 状态注入：未激活时保持低调，激活时呈现精致的层次感
            isActive
              ? cn(activeConfig.text, activeConfig.border, activeConfig.focus)
              : "border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/30",

            (enableTagToggle || prefix) ? "pl-10" : "pl-3",
            (isNumber || suffix) ? "pr-10" : "pr-3",
            className
          )}
        />

        {/* 数字步进器保持原样... */}
        {isNumber ? (
          <div className="absolute right-1 top-1 bottom-1 w-6 flex flex-col rounded-sm overflow-hidden bg-transparent z-10">
            <button type="button" tabIndex={-1} onClick={() => handleNumberChange(step)} className="flex flex-1 items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed" disabled={Number(displayValue) >= max}>
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" tabIndex={-1} onClick={() => handleNumberChange(-step)} className="flex flex-1 items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed" disabled={Number(displayValue) <= min}>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : suffix ? (
          <div className="absolute right-1 top-1 bottom-1 flex items-center z-10 pr-2">{suffix}</div>
        ) : null}
      </div>
    )
  }
)
Input.displayName = "Input"
export { Input }