import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const isNumber = type === "number"

    const handleSpin = React.useCallback((delta: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      const input = e.currentTarget.closest('.number-input-wrapper')?.querySelector('input') as HTMLInputElement
      if (!input) return
      const step = parseFloat(input.step) || 1
      const current = parseFloat(input.value) || 0
      const limit = delta > 0
        ? (input.max ? parseFloat(input.max) : Number.MAX_SAFE_INTEGER)
        : (input.min ? parseFloat(input.min) : Number.MIN_SAFE_INTEGER)
      const newValue = delta > 0 ? Math.min(current + step, limit) : Math.max(current + delta, limit)
      input.value = newValue.toString()
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, [])

    if (isNumber) {
      return (
        <div className="number-input-wrapper relative flex items-center">
          <input
            type="number"
            className={cn(
              "inline-flex h-10 leading-10! w-full rounded-md border dark:border-2 border-input bg-card px-3 pr-10 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent dark:hover:bg-input/50 transition-colors [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]",
              className
            )}
            ref={ref}
            {...props}
          />
          <div className="absolute right-0 top-0 bottom-0 w-6 flex flex-col items-center justify-center border-l border-border bg-transparent select-none">
            <button type="button" className="flex-1 w-full flex items-center justify-center hover:bg-accent transition-colors" onClick={handleSpin(1)}>
              <svg className="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8l-6 6h12z" /></svg>
            </button>
            <div className="h-px w-4 bg-border" />
            <button type="button" className="flex-1 w-full flex items-center justify-center hover:bg-accent transition-colors" onClick={handleSpin(-1)}>
              <svg className="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h12z" /></svg>
            </button>
          </div>
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          "inline-flex h-10 leading-10! w-full rounded-md border dark:border-2 border-input bg-card px-3 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent dark:hover:bg-input/50 transition-colors",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
