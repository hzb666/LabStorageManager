import * as React from "react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { Eye, EyeOff, Keyboard } from "lucide-react"
import { Input } from "./Input"
import { cn } from "@/lib/utils"

/**
 * 密码输入框组件
 * 支持显示/隐藏密码切换
 */
function PasswordInput({
  className,
  onBlur,
  onFocus,
  onKeyDown,
  onKeyUp,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [showPassword, setShowPassword] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isCapsLockOn, setIsCapsLockOn] = useState(false)

  const showCapsLockHint = isFocused && isCapsLockOn

  const updateCapsLockState = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setIsCapsLockOn(event.getModifierState('CapsLock'))
  }

  return (
    <>
      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          className={cn(
            "pr-10",
            // 密码掩码模式增大字符间距
            !showPassword && "tracking-widest",
            // placeholder 保持正常
            "placeholder:tracking-normal",
            className
          )}
          onFocus={(event) => {
            setIsFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setIsFocused(false)
            setIsCapsLockOn(false)
            setIsCapsLockOn(false)
            onBlur?.(event)
          }}
          onKeyDown={(event) => {
            updateCapsLockState(event)
            onKeyDown?.(event)
          }}
          onKeyUp={(event) => {
            updateCapsLockState(event)
            onKeyUp?.(event)
          }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showCapsLockHint && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 animate-in fade-in slide-in-from-top-2 duration-200"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/96 px-3 py-2 shadow-lg backdrop-blur dark:border-2 dark:border-input">
                <Keyboard className="size-4 text-amber-500" />
                <span className="truncate text-sm text-foreground">大写锁定已开启</span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

export { PasswordInput }
