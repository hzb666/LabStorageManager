import * as React from "react"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { defaultInputStyles, inputConfigs, type InputStyles, type InputTagConfig } from "@/lib/inputConfigs"

export interface PrefixButtonConfig {
  onClick: () => void
  title?: string
  loading?: boolean
  icon?: React.ElementType
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  step?: number | string
  min?: number | string
  max?: number | string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  tag?: string
  enableTagToggle?: boolean
  prefixButton?: PrefixButtonConfig
  styles?: Partial<InputStyles>
}

const DEFAULT_TAG = "[强调]"

// 根据当前标签名获取样式配置，不存在时回退到默认标签配置。
const getActiveConfig = (tag: string): InputTagConfig =>
  inputConfigs[tag] ?? inputConfigs[DEFAULT_TAG]

// 统一推导输入框当前的显示值、激活态和标签样式配置。
const getInputValueState = (
  type: InputProps["type"],
  value: InputProps["value"],
  enableTagToggle: boolean,
  tag: string
) => {
  const isNumber = type === "number"
  const isControlled = value !== undefined
  // 修复：0 是有效值，应该显示为 "0" 而不是空字符串
  const rawValue =
    isControlled && value !== null && value !== undefined ? String(value) : ""
  const isActive = enableTagToggle && rawValue.startsWith(tag)
  const displayValue = isActive ? rawValue.slice(tag.length) : rawValue
  const activeConfig = getActiveConfig(tag)

  return {
    activeConfig,
    DefaultIcon: activeConfig.icon,
    displayValue,
    isActive,
    isControlled,
    isNumber,
  }
}

// 组合输入框的基础样式、标签态样式与左右留白规则。
const getInputClassName = ({
  activeConfig,
  className,
  enableTagToggle,
  isActive,
  isNumber,
  prefix,
  prefixButton,
  styles,
  suffix,
}: {
  activeConfig: InputTagConfig
  className?: string
  enableTagToggle: boolean
  isActive: boolean
  isNumber: boolean
  prefix: React.ReactNode
  prefixButton?: PrefixButtonConfig
  styles: InputStyles
  suffix?: React.ReactNode
}) => {
  const hasLeftArea = Boolean(enableTagToggle || prefix || prefixButton)
  const hasRightArea = Boolean(isNumber || suffix)

  return cn(
    styles.input.base,
    isActive
      ? cn(activeConfig.text, activeConfig.border, activeConfig.focus)
      : styles.input.inactive,
    isNumber && styles.input.numberApperance,
    hasLeftArea ? "pl-10" : "pl-3",
    hasRightArea ? "pr-10" : "pr-3",
    className
  )
}

// 左侧只保留一个槽位，优先级固定为 prefixButton > tagToggle > prefix，避免多个入口抢位置。
const renderLeftArea = ({
  DefaultIcon,
  activeConfig,
  enableTagToggle,
  handleStatusToggle,
  isActive,
  prefix,
  prefixButton,
  styles,
}: {
  DefaultIcon: React.ElementType
  activeConfig: InputTagConfig
  enableTagToggle: boolean
  handleStatusToggle: (e: React.MouseEvent) => void
  isActive: boolean
  prefix: React.ReactNode
  prefixButton?: PrefixButtonConfig
  styles: InputStyles
}) => {
  if (prefixButton) {
    const PrefixButtonIcon = prefixButton.icon ?? DefaultIcon

    return (
      <div className={styles.leftArea}>
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
      </div>
    )
  }

  if (enableTagToggle) {
    return (
      <div className={styles.leftArea}>
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
      </div>
    )
  }

  if (!prefix) {
    return null
  }

  return (
    <div className={styles.leftArea}>
      <div className="pl-1.5">{prefix}</div>
    </div>
  )
}

// 渲染输入框右侧区域，数字输入显示步进器，其余情况按需显示 suffix。
const renderRightArea = ({
  displayValue,
  handleNumberChange,
  isNumber,
  numMax,
  numMin,
  numStep,
  styles,
  suffix,
}: {
  displayValue: string
  handleNumberChange: (delta: number) => void
  isNumber: boolean
  numMax: number
  numMin: number
  numStep: number
  styles: InputStyles
  suffix?: React.ReactNode
}) => {
  if (isNumber) {
    const numericValue = Number(displayValue)

    return (
      <div className={styles.stepper.wrapper}>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => handleNumberChange(numStep)}
          className={styles.stepper.button}
          disabled={numericValue >= numMax}
        >
          <ChevronUp className={styles.stepper.icon} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => handleNumberChange(-numStep)}
          className={styles.stepper.button}
          disabled={numericValue <= numMin}
        >
          <ChevronDown className={styles.stepper.icon} />
        </button>
      </div>
    )
  }

  if (!suffix) {
    return null
  }

  return <div className={styles.suffixArea}>{suffix}</div>
}

// 统一封装带标签切换、前后缀和数字步进能力的输入框组件。
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      step = 1,
      min = 0,
      max = Infinity,
      prefix,
      suffix,
      tag = DEFAULT_TAG,
      enableTagToggle = false,
      prefixButton,
      value,
      onChange,
      styles: customStyles,
      ...props
    },
    ref
  ) => {
    const styles = { ...defaultInputStyles, ...customStyles } as InputStyles
    const numStep = Number(step)
    const numMin = Number(min)
    const numMax = Number(max)
    const { activeConfig, DefaultIcon, displayValue, isActive, isControlled, isNumber } =
      getInputValueState(type, value, enableTagToggle, tag)

    // 输入框里只展示纯文本，真正对外回传时再按当前 tag 状态重组值，避免 UI 和存储格式耦在一起。
    const emitChange = (nextPlainText: string, shouldHaveTag: boolean) => {
      const finalValue = shouldHaveTag ? `${tag}${nextPlainText}` : nextPlainText
      onChange?.({
        target: { ...props, value: finalValue },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    }

    // 标签模式下，显示值和最终存储值是两套表示，这里负责把它们重新对齐。
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!enableTagToggle) {
        return onChange?.(e)
      }

      const nextValue = e.target.value

      if (nextValue === "") {
        emitChange("", false)
        return
      }

      if (!isActive && nextValue.includes(tag)) {
        emitChange(nextValue.replace(tag, ""), true)
        return
      }

      emitChange(nextValue, isActive)
    }

    // 切标签只改存储前缀，不重写当前可见文本，避免用户刚输入的内容被清空。
    const handleStatusToggle = (e: React.MouseEvent) => {
      e.preventDefault()
      emitChange(displayValue, !isActive)
    }

    // 数字步进先兜底异常输入，再做 min/max 钳制，避免空值或脏值把步进器带坏。
    const handleNumberChange = (delta: number) => {
      const parsedValue = displayValue === "" ? 0 : Number(displayValue)
      const currentNum = Number.isFinite(parsedValue) ? parsedValue : 0
      const nextValue = Math.max(numMin, Math.min(numMax, currentNum + delta))
      emitChange(String(nextValue), isActive)
    }

    return (
      <div className={styles.wrapper}>
        {renderLeftArea({
          DefaultIcon,
          activeConfig,
          enableTagToggle,
          handleStatusToggle,
          isActive,
          prefix,
          prefixButton,
          styles,
        })}

        <input
          {...props}
          type={enableTagToggle && isNumber ? "text" : type}
          ref={ref}
          {...(isControlled ? { value: displayValue } : {})}
          onChange={handleInputChange}
          className={getInputClassName({
            activeConfig,
            className,
            enableTagToggle,
            isActive,
            isNumber,
            prefix,
            prefixButton,
            styles,
            suffix,
          })}
        />

        {renderRightArea({
          displayValue,
          handleNumberChange,
          isNumber,
          numMax,
          numMin,
          numStep,
          styles,
          suffix,
        })}
      </div>
    )
  }
)

Input.displayName = "Input"

export { Input }
