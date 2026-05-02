import * as React from "react"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip"
import {
  defaultInputStyles,
  inputConfigs,
  type InputIconButtonStyles,
  type InputStyles,
  type InputTagConfig,
} from "@/lib/inputConfigs"

export interface InputIconButtonConfig {
  onClick: () => void
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  title?: string
  ariaLabel?: string
  ariaPressed?: boolean
  loading?: boolean
  disabled?: boolean
  icon?: React.ElementType
  active?: boolean
  variant?: "default" | "warning"
}

export type PrefixButtonConfig = InputIconButtonConfig
type InputIconButtonPlacement = "prefix" | "suffix"

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  step?: number | string
  min?: number | string
  max?: number | string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  tag?: string
  enableTagToggle?: boolean
  prefixButton?: PrefixButtonConfig
  onValueChange?: (value: string) => void
  styles?: Partial<InputStyles>
}

const DEFAULT_TAG = "[强调]"

function getIconButtonStateClass(
  config: InputIconButtonConfig,
  buttonStyles: InputIconButtonStyles
) {
  if (config.loading) {
    return buttonStyles.loading
  }

  if (config.active && config.variant === "warning") {
    return buttonStyles.warningActive
  }

  if (config.active) {
    return buttonStyles.active
  }

  return buttonStyles.default
}

export function InputIconButton({
  config,
  fallbackIcon,
  placement = "prefix",
  styles = defaultInputStyles,
}: Readonly<{
  config: InputIconButtonConfig
  fallbackIcon?: React.ElementType
  placement?: InputIconButtonPlacement
  styles?: InputStyles
}>) {
  const Icon = config.icon ?? fallbackIcon
  const isDisabled = config.disabled || config.loading
  const tooltipText = config.title || config.ariaLabel || "点击操作"
  const buttonStyles =
    placement === "suffix" ? styles.suffixButton : styles.prefixButton

  const button = (
    <button
      type="button"
      aria-label={config.ariaLabel || config.title || "点击操作"}
      aria-pressed={config.ariaPressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={config.onClick}
      onBlur={config.onBlur}
      disabled={isDisabled}
      className={cn(
        buttonStyles.base,
        getIconButtonStateClass(config, buttonStyles),
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      {config.loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        Icon && (
          <Icon className={cn(buttonStyles.icon, "fill-transparent")} />
        )
      )}
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  )
}

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
  // 修复：0 作为有效值显示为 "0"，不回退为空字符串。
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

// 左侧槽位固定为一个，优先级为 prefixButton > tagToggle > prefix，防止多个入口抢位置。
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
    return (
      <div className={styles.leftArea}>
        <InputIconButton
          config={prefixButton}
          fallbackIcon={DefaultIcon}
          styles={styles}
        />
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
              isActive && activeConfig.filledWhenActive === true ? "fill-current" : "fill-transparent"
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
      onValueChange,
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

    // 输入框里只展示纯文本，真正对外回传时再按当前 tag 状态重组值，避免伪造 React 事件。
    const emitValue = (nextPlainText: string, shouldHaveTag: boolean) => {
      const finalValue = shouldHaveTag ? `${tag}${nextPlainText}` : nextPlainText
      onValueChange?.(finalValue)
    }

    // 标签模式下，显示值和最终存储值是两套表示，这里负责把它们重新对齐。
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!enableTagToggle) {
        if (onValueChange) {
          onValueChange(e.target.value)
          return
        }
        onChange?.(e)
        return
      }

      const nextValue = e.target.value

      if (nextValue === "") {
        emitValue("", false)
        return
      }

      if (!isActive && nextValue.includes(tag)) {
        emitValue(nextValue.replace(tag, ""), true)
        return
      }

      emitValue(nextValue, isActive)
    }

    // 切标签只改存储前缀，不重写当前可见文本，避免用户刚输入的内容被清空。
    const handleStatusToggle = (e: React.MouseEvent) => {
      e.preventDefault()
      emitValue(displayValue, !isActive)
    }

    // 数字步进先兜底异常输入，再做 min/max 钳制，避免空值或脏值把步进器带坏。
    const handleNumberChange = (delta: number) => {
      const parsedValue = displayValue === "" ? 0 : Number(displayValue)
      const currentNum = Number.isFinite(parsedValue) ? parsedValue : 0
      const nextValue = Math.max(numMin, Math.min(numMax, currentNum + delta))
      emitValue(String(nextValue), isActive)
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
