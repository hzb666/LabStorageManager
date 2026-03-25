export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastData {
  id: string
  message: string
  type: ToastType
}

type Listener = (toast: ToastData) => void
const listeners = new Set<Listener>()
let fallbackToastCounter = 0

/** 生成 toast 唯一标识，优先使用 Web Crypto，避免伪随机告警。 */
function generateToastId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(8)
    globalThis.crypto.getRandomValues(bytes)
    const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${Date.now().toString(16)}-${suffix}`
  }

  fallbackToastCounter = (fallbackToastCounter + 1) % 0xffff
  const counter = fallbackToastCounter.toString(16).padStart(4, '0')
  return `${Date.now().toString(16)}-${counter}`
}

/** 暴露订阅接口，供 ToastContainer 监听并渲染通知事件。 */
export const subscribeToToasts = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 统一分发 toast 事件，保持原有调用签名和通知时序。 */
export function toast(message: string, type: ToastType = 'info') {
  const id = generateToastId()
  listeners.forEach((listener) => listener({ id, message, type }))
}

toast.success = (message: string) => toast(message, 'success')
toast.error = (message: string) => toast(message, 'error')
toast.warning = (message: string) => toast(message, 'warning')
toast.info = (message: string) => toast(message, 'info')
