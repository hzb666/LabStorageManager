import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"

interface DialogMountContextValue {
  keepMounted: boolean
  open: boolean
}

const DialogMountContext = React.createContext<DialogMountContextValue>({
  keepMounted: false,
  open: false,
})

interface DialogProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root> {
  keepMounted?: boolean
}

export function Dialog({ open = false, keepMounted = false, children, ...props }: DialogProps) {
  return (
    <DialogMountContext.Provider value={{ keepMounted, open }}>
      <DialogPrimitive.Root open={open} {...props}>
        {children}
      </DialogPrimitive.Root>
    </DialogMountContext.Provider>
  )
}

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  children: React.ReactNode
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ children, className, ...props }, ref) => {
  const { keepMounted, open } = React.useContext(DialogMountContext)
  const forceMount = keepMounted ? true : undefined

  return (
    <DialogPrimitive.Portal forceMount={forceMount}>
      <DialogPrimitive.Overlay
        forceMount={forceMount}
        className={cn(
          "fixed inset-0 z-50 bg-black/50",
          keepMounted && !open && "hidden"
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        forceMount={forceMount}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[90%] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 text-popover-foreground shadow-lg md:w-auto md:min-w-md",
          keepMounted && !open && "hidden pointer-events-none",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

DialogContent.displayName = "DialogContent"

export function DialogHeader({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <div className={cn(className)}>{children}</div>
}

export function DialogTitle({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <DialogPrimitive.Title className={cn("font-bold text-2xl flex items-center gap-2 mb-8", className)}>
      {children}
    </DialogPrimitive.Title>
  )
}

export function DialogCloseButton({
  className,
  type = "button",
  "aria-label": ariaLabel = "关闭弹窗",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <DialogPrimitive.Close asChild>
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
    </DialogPrimitive.Close>
  )
}

export function DialogTrigger({
  children,
  onClick,
}: Readonly<{ children: React.ReactNode; onClick?: () => void }>) {
  if (React.isValidElement(children)) {
    return (
      <DialogPrimitive.Trigger asChild onClick={onClick}>
        {children}
      </DialogPrimitive.Trigger>
    )
  }

  return (
    <DialogPrimitive.Trigger onClick={onClick}>
      {children}
    </DialogPrimitive.Trigger>
  )
}
