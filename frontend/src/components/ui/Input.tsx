import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react"
// 统一从配置文件导入
import { inputConfigs, defaultInputStyles, type InputStyles } from "@/lib/inputConfigs"

export interface PrefixButtonConfig {
  onClick: () => void
  title?: string
  loading?: boolean
  icon?: React.ElementType // 支持自定义图标
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  step?: number | string; min?: number | string; max?: number | string;
  prefix?: React.ReactNode; suffix?: React.ReactNode;
  tag?: string; enableTagToggle?: boolean;
  prefixButton?: PrefixButtonConfig;
  styles?: Partial<InputStyles>; // 接收外部传入的自定义样式
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({
    className, type, step = 1, min = 0, max = Infinity,
    prefix, suffix, tag = "[强调]", enableTagToggle = false,
    prefixButton, value, onChange, styles: customStyles, ...props
  }, ref) => {

    // 合并传入样式与默认样式
    const styles = { ...defaultInputStyles, ...customStyles } as InputStyles

    // 转换为数字类型，确保数学运算正确
    const numStep = Number(step)
    const numMin = Number(min)
    const numMax = Number(max)

    const isNumber = type === "number"
    const isControlled = value !== undefined
    // 修复：0 是有效值，应该显示为 "0" 而不是空字符串
    const rawValue = isControlled ? (value !== null && value !== undefined ? String(value) : "") : ""
    const isActive = enableTagToggle && rawValue.startsWith(tag)
    const displayValue = isActive ? rawValue.slice(tag.length) : rawValue

    const activeConfig = inputConfigs[tag] || inputConfigs["[强调]"]
    const DefaultIcon = activeConfig.icon

    const emitChange = (nextPlainText: string, shouldHaveTag: boolean) => {
      const finalValue = shouldHaveTag ? `${tag}${nextPlainText}` : nextPlainText
      onChange?.({ target: { ...props, value: finalValue } } as unknown as React.ChangeEvent<HTMLInputElement>)
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!enableTagToggle) return onChange?.(e)

      const val = e.target.value
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
      emitChange(String(Math.max(numMin, Math.min(numMax, currentNum + delta))), isActive)
    }

    const showLeftArea = enableTagToggle || prefix || prefixButton
    const PrefixButtonIcon = prefixButton?.icon || DefaultIcon

    return (
      <div className={styles.wrapper}>
        {showLeftArea && (
          <div className={styles.leftArea}>
            {prefixButton ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={prefixButton.onClick}
                title={prefixButton.title || "点击操作"}
                disabled={prefixButton.loading}
                className={cn(
                  styles.prefixButton.base,
                  prefixButton.loading ? styles.prefixButton.loading : styles.prefixButton.default
                )}
              >
                {prefixButton.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PrefixButtonIcon className={cn(styles.prefixButton.icon, "fill-transparent")} />
                )}
              </button>
            ) : enableTagToggle ? (
              <button
                type="button"
                onClick={handleStatusToggle}
                className={cn(
                  styles.tagButton.base,
                  isActive ? activeConfig.text : styles.tagButton.inactive
                )}
              >
                <DefaultIcon
                  className={cn(
                    styles.tagButton.iconBase,
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
          {...(isControlled ? { value: displayValue } : {})}
          onChange={handleInputChange}
          className={cn(
            styles.input.base,
            isActive
              ? cn(activeConfig.text, activeConfig.border, activeConfig.focus)
              : styles.input.inactive,
            isNumber && styles.input.numberApperance,
            (enableTagToggle || prefix || prefixButton) ? "pl-10" : "pl-3",
            (isNumber || suffix) ? "pr-10" : "pr-3",
            className
          )}
        />

        {isNumber ? (
          <div className={styles.stepper.wrapper}>
            <button type="button" tabIndex={-1} onClick={() => handleNumberChange(numStep)} className={styles.stepper.button} disabled={Number(displayValue) >= numMax}>
              <ChevronUp className={styles.stepper.icon} />
            </button>
            <button type="button" tabIndex={-1} onClick={() => handleNumberChange(-numStep)} className={styles.stepper.button} disabled={Number(displayValue) <= numMin}>
              <ChevronDown className={styles.stepper.icon} />
            </button>
          </div>
        ) : suffix ? (
          <div className={styles.suffixArea}>{suffix}</div>
        ) : null}
      </div>
    )
  }
)
Input.displayName = "Input"
export { Input }
