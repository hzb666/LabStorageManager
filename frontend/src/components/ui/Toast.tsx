import React, { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
// 确保这个路径指向你抽离出的 toast.ts 逻辑文件
import { subscribeToToasts, type ToastData, type ToastType } from '@/lib/toast'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="size-6 text-green-600 dark:text-green-400" />,
  error: <XCircle className="size-6 text-red-600 dark:text-red-400" />,
  warning: <AlertTriangle className="size-6 text-yellow-600 dark:text-yellow-400" />,
  info: <Info className="size-6 text-blue-600 dark:text-blue-400" />,
}

const styles: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/50 dark:text-green-200',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/50 dark:text-red-200',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
}

function ToastItem({ toast, onRemove }: Readonly<{ toast: ToastData; onRemove: (id: string) => void }>) {
  // 只保留控制离场的 isExiting 状态，去掉了复杂的 isMounted
  const [isExiting, setIsExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerExit = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => {
      onRemove(toast.id)
    }, 300)
  }, [toast.id, onRemove])

  const startTimer = useCallback(() => {
    timerRef.current = setTimeout(triggerExit, 3500)
  }, [triggerExit])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    startTimer()
    return clearTimer
  }, [startTimer, clearTimer])

  return (
    <div
      className={cn(
        'grid transition-all duration-300 ease-in-out opacity-100 mb-2',
        'grid-rows-[1fr]',
        isExiting && 'grid-rows-[0fr] mb-0! opacity-0! pointer-events-none'
      )}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
    >
      <div className="overflow-hidden min-h-0 rounded-lg">
        <div
          className={cn(
            'flex gap-3 px-6 min-h-16 items-center rounded-lg border shadow-lg',
            'animate-in slide-in-from-right-full fade-in duration-300',
            isExiting && 'animate-out fade-out zoom-out-95 duration-300',
            styles[toast.type]
          )}
        >
          <span className="shrink-0 mt-0.5">{icons[toast.type]}</span>
          <span className="text-lg flex-1 py-3">{toast.message}</span>
          <button
            onClick={triggerExit}
            className="shrink-0 opacity-60 ml-0.5 hover:opacity-100 flex items-center self-center"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  useEffect(() => {
    const handleAdd = (newToast: ToastData) => {
      setToasts((prev) => [newToast, ...prev])
    }
    const unsubscribe = subscribeToToasts(handleAdd)
    return unsubscribe
  }, [])

  const handleRemove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-100 flex flex-col max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={handleRemove} />
      ))}
    </div>
  )
}