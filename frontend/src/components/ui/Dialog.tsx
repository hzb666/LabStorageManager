import * as React from "react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        // 维持点击遮罩关闭约定，统一所有调用方的退出行为。
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

export function DialogContent({ children, className }: DialogContentProps) {
  return (
    <div
      className={cn(
        // max-h + overflow 组合用于兜底长表单，避免移动端内容超出可视区域后无法滚动。
        "w-[90%] md:w-auto md:min-w-md relative bg-card rounded-lg p-6 max-h-[90vh] overflow-y-auto shadow-lg border border-border text-popover-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

export function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(className)}>{children}</div>
}

export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("font-bold text-2xl flex items-center gap-2 mb-8", className)}>{children}</h2>
}

// 保留这个薄封装，只是为了不打断现有触发器调用面。
export function DialogTrigger({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick}>{children}</div>
}
