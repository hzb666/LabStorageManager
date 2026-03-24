import * as React from "react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

/** 提供最小职责的弹窗遮罩层与开关编排。 */
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      {children}
    </div>
  )
}

interface DialogContentProps {
  children: React.ReactNode
  className?: string
}

/** 渲染弹窗主体容器，并保留外部传入的尺寸与滚动样式。 */
export function DialogContent({ children, className }: DialogContentProps) {
  return (
    <div
      className={cn(
        "w-[90%] md:w-auto md:min-w-md relative bg-card rounded-lg p-6 max-h-[90vh] overflow-y-auto shadow-lg border border-border text-popover-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

/** 渲染弹窗头部容器，供各页面按需组合标题区。 */
export function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(className)}>{children}</div>
}

/** 渲染弹窗标题，并提供默认的间距与字号。 */
export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("font-bold text-2xl flex items-center gap-2 mb-8", className)}>{children}</h2>
}

/** 提供最轻量的触发器封装，保持旧调用方式兼容。 */
export function DialogTrigger({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick}>{children}</div>
}
