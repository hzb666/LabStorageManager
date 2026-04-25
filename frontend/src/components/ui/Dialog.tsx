import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"

const LOCKED_SCROLL_OVERFLOW = "hidden"
const NO_ACTIVE_SCROLL_LOCKS = 0

let activeScrollLocks = NO_ACTIVE_SCROLL_LOCKS
let previousBodyOverflow = ""
let previousDocumentOverflow = ""

function lockBackgroundScroll() {
  if (activeScrollLocks === NO_ACTIVE_SCROLL_LOCKS) {
    previousBodyOverflow = document.body.style.overflow
    previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = LOCKED_SCROLL_OVERFLOW
    document.documentElement.style.overflow = LOCKED_SCROLL_OVERFLOW
  }

  activeScrollLocks += 1
  return unlockBackgroundScroll
}

function unlockBackgroundScroll() {
  activeScrollLocks = Math.max(NO_ACTIVE_SCROLL_LOCKS, activeScrollLocks - 1)
  if (activeScrollLocks > NO_ACTIVE_SCROLL_LOCKS) return

  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousDocumentOverflow
  previousBodyOverflow = ""
  previousDocumentOverflow = ""
}

function useBackgroundScrollLock(open: boolean) {
  React.useEffect(() => {
    if (!open) return undefined

    // 页面滚动可能挂在 body 或 html，两个节点同步加锁。
    return lockBackgroundScroll()
  }, [open])
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  keepMounted?: boolean
}

export function Dialog({ open, onOpenChange, children, keepMounted = false }: DialogProps) {
  useBackgroundScrollLock(open)

  if (!open && !keepMounted) return null

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        !open && "invisible pointer-events-none",
      )}
      aria-hidden={!open}
    >
      {open && (
        <div
          className="fixed inset-0 bg-black/50"
          // 点击遮罩关闭弹窗，保持全局交互一致。
          onClick={() => onOpenChange(false)}
        />
      )}
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
        // max-h + overflow 兜住长表单，移动端超出可视区域仍可滚动。
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

export function DialogCloseButton({
  className,
  type = "button",
  "aria-label": ariaLabel = "关闭弹窗",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type={type}
      variant="ghost"
      size="icon"
      className={cn("absolute right-4 top-4 p-1 size-8", className)}
      aria-label={ariaLabel}
      {...props}
    >
      <X className="size-4" />
    </Button>
  )
}

export function DialogTrigger({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick}>{children}</div>
}
