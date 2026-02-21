import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
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
  success: <CheckCircle className="w-5 h-5 text-green-600" />,
  error: <XCircle className="w-5 h-5 text-red-600" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-600" />,
  info: <Info className="w-5 h-5 text-blue-600" />,
}

const styles: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    addToastExternal = addToast
    return () => { addToastExternal = null }
  }, [addToast])

  // 使用 ref 追踪已设置定时器的 toast，避免重复创建
  const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  
  useEffect(() => {
    // 清理已不存在的 toast 的定时器
    Object.keys(timersRef.current).forEach(id => {
      if (!toasts.find(t => t.id === id)) {
        clearTimeout(timersRef.current[id])
        delete timersRef.current[id]
      }
    })
    
    // 为每个 toast 设置定时器（如果还没有）
    toasts.forEach(toast => {
      if (!timersRef.current[toast.id]) {
        timersRef.current[toast.id] = setTimeout(() => {
          removeToast(toast.id)
          delete timersRef.current[toast.id]
        }, 3500)
      }
    })
  }, [toasts, removeToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg animate-in slide-in-from-right-full fade-in duration-300',
            styles[t.type]
          )}
        >
          <span className="flex-shrink-0 mt-0.5">{icons[t.type]}</span>
          <span className="text-sm flex-1">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="flex-shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
