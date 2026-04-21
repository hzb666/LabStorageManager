import * as React from "react"
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

    // 同时锁 body/html，兼容浏览器把页面滚动挂在不同根节点。
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
          // 维持点击遮罩关闭约定，统一所有调用方的退出行为。
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
