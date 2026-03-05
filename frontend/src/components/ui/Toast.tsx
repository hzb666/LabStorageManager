import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
  exiting?: boolean
}

let addToastExternal: ((message: string, type: ToastType) => void) | null = null

export function toast(message: string, type: ToastType = 'info') {
  if (addToastExternal) {
    addToastExternal(message, type)
  }
}

toast.success = (message: string) => toast(message, 'success')
toast.error = (message: string) => toast(message, 'error')
toast.warning = (message: string) => toast(message, 'warning')
toast.info = (message: string) => toast(message, 'info')

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

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const hoveredRef = React.useRef<Set<string>>(new Set())

  const clearToastTimer = React.useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    clearToastTimer(id)
    setToasts(prev => prev.map(t =>
      t.id === id ? { ...t, exiting: true } : t
    ))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [clearToastTimer])

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  useEffect(() => {
    addToastExternal = addToast
    return () => { addToastExternal = null }
  }, [addToast])

  const setToastTimer = React.useCallback((id: string) => {
    clearToastTimer(id)
    timersRef.current[id] = setTimeout(() => {
      removeToast(id)
    }, 3500)
  }, [clearToastTimer, removeToast])

  const handleMouseEnter = React.useCallback((id: string) => {
    hoveredRef.current.add(id)
    clearToastTimer(id)
  }, [clearToastTimer])

  const handleMouseLeave = React.useCallback((id: string) => {
    hoveredRef.current.delete(id)
    const toast = toasts.find(t => t.id === id)
    if (toast && !toast.exiting) {
      setToastTimer(id)
    }
  }, [toasts, setToastTimer])

  useEffect(() => {
    const currentIds = new Set(toasts.map(t => t.id))
    Object.keys(timersRef.current).forEach(id => {
      if (!currentIds.has(id)) clearToastTimer(id)
    })

    toasts.forEach(toast => {
      if (!timersRef.current[toast.id] && !hoveredRef.current.has(toast.id) && !toast.exiting) {
        setToastTimer(toast.id)
      }
    })
  }, [toasts, clearToastTimer, setToastTimer])

  if (toasts.length === 0) return null

  return (
    // 使用 padding-bottom 而不是 gap，方便后续高度计算
    <div className="fixed top-4 right-4 z-[100] flex flex-col max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'grid transition-all duration-300 ease-in-out opacity-100 mb-2',
            // 使用 grid-template-rows 实现完美的高度塌陷动画
            'grid-rows-[1fr]',
            t.exiting && 'grid-rows-[0fr] !mb-0 !opacity-0 pointer-events-none'
          )}
          onMouseEnter={() => handleMouseEnter(t.id)}
          onMouseLeave={() => handleMouseLeave(t.id)}
        >
          {/* 必须加 min-height: 0 才能让 grid-rows-[0fr] 生效 */}
          <div className="overflow-hidden min-h-0 rounded-lg">
            <div
              className={cn(
                'flex gap-3 px-6 h-16 items-center rounded-lg border shadow-lg',
                'animate-in slide-in-from-right-full fade-in duration-300',
                t.exiting && 'animate-out fade-out zoom-out-95 duration-300', styles[t.type]
              )}
            >
              <span className="shrink-0 mt-0.5">{icons[t.type]}</span>
              <span className="text-lg flex-1">{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                className="shrink-0 opacity-60 ml-0.5 hover:opacity-100 flex items-center self-center"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}