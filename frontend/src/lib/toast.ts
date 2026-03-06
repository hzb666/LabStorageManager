export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastData {
  id: string
  message: string
  type: ToastType
}

type Listener = (toast: ToastData) => void
const listeners = new Set<Listener>()

// 暴露一个订阅方法给组件用
export const subscribeToToasts = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 核心的全局调用函数
export function toast(message: string, type: ToastType = 'info') {
  const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
  listeners.forEach((listener) => listener({ id, message, type }))
}

toast.success = (message: string) => toast(message, 'success')
toast.error = (message: string) => toast(message, 'error')
toast.warning = (message: string) => toast(message, 'warning')
toast.info = (message: string) => toast(message, 'info')