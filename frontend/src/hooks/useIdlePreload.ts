import { useEffect } from 'react'

type BrowserIdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number
}

const DEFAULT_IDLE_PRELOAD_TIMEOUT_MS = 2500

export function useIdlePreload(
  loader: () => Promise<unknown>,
  enabled: boolean,
  timeoutMs = DEFAULT_IDLE_PRELOAD_TIMEOUT_MS,
): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined
    }

    let cancelled = false
    let started = false
    const preload = () => {
      if (cancelled || started) return

      started = true
      loader().catch(() => undefined)
    }
    const browserWindow = window as BrowserIdleWindow
    const timeoutId = window.setTimeout(preload, timeoutMs)
    const idleHandle = browserWindow.requestIdleCallback?.(preload)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      if (idleHandle !== undefined) {
        browserWindow.cancelIdleCallback?.(idleHandle)
      }
    }
  }, [enabled, loader, timeoutMs])
}
