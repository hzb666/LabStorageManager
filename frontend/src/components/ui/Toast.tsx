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

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    // 先设置 exiting 状态，播放淡出动画
    setToasts(prev => prev.map(t => 
      t.id === id ? { ...t, exiting: true } : t
    ))
    // 等待动画完成后真正移除
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  useEffect(() => {
    addToastExternal = addToast
    return () => { addToastExternal = null }
  }, [addToast])

  // 使用 ref 追踪已设置定时器的 toast，避免重复创建
  const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // 追踪鼠标悬停状态
  const hoveredRef = React.useRef<Set<string>>(new Set())
  
  // 清除单个 toast 的定时器
  const clearToastTimer = React.useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])
  
  // 设置单个 toast 的定时器
  const setToastTimer = React.useCallback((id: string) => {
    clearToastTimer(id)
    timersRef.current[id] = setTimeout(() => {
      removeToast(id)
      delete timersRef.current[id]
    }, 3500)
  }, [clearToastTimer, removeToast])
  
  // 鼠标进入时清除定时器
  const handleMouseEnter = React.useCallback((id: string) => {
    hoveredRef.current.add(id)
    clearToastTimer(id)
  }, [clearToastTimer])
  
  // 鼠标离开时重新设置定时器
  const handleMouseLeave = React.useCallback((id: string) => {
    hoveredRef.current.delete(id)
    // 只有当 toast 仍然存在且未处于 exiting 状态时才设置定时器
    const toast = toasts.find(t => t.id === id)
    if (toast && !toast.exiting) {
      setToastTimer(id)
    }
  }, [toasts, setToastTimer])
  
  useEffect(() => {
    // 清理已不存在的 toast 的定时器
    Object.keys(timersRef.current).forEach(id => {
      if (!toasts.find(t => t.id === id)) {
        clearToastTimer(id)
      }
    })
    
    // 为每个 toast 设置定时器（如果还没有且不在 exiting 状态）
    toasts.forEach(toast => {
      if (!timersRef.current[toast.id] && !hoveredRef.current.has(toast.id) && !toast.exiting) {
        setToastTimer(toast.id)
      }
    })
  }, [toasts, clearToastTimer, setToastTimer])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 px-6 py-4 rounded-lg border shadow-lg animate-in slide-in-from-right-full fade-in duration-300',
            t.exiting && 'animate-out fade-out duration-300',
            styles[t.type]
          )}
          onMouseEnter={() => handleMouseEnter(t.id)}
          onMouseLeave={() => handleMouseLeave(t.id)}
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
      ))}
    </div>
  )
}
