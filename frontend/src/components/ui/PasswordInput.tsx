import * as React from "react"
import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "./Input"
import { cn } from "@/lib/utils"

/**
 * 密码输入框组件
 * 支持显示/隐藏密码切换
 */
function PasswordInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [showPassword, setShowPassword] = useState(false)

  return (
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
  )
}

export { PasswordInput }
