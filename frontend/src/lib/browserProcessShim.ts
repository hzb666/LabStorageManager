interface BrowserProcessShim {
  browser: boolean
  env: Record<string, string | undefined>
  noDeprecation: boolean
  pid: number
  stderr?: {
    columns?: number
    getColorDepth?: () => number
    isTTY?: boolean
  }
  throwDeprecation: boolean
  traceDeprecation: boolean
  emitWarning?: (message: unknown, ...args: unknown[]) => void
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
}

const browserGlobal = globalThis as unknown as {
  global?: typeof globalThis
  process?: Partial<BrowserProcessShim>
}

const runAsync =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void) => {
      setTimeout(callback, 0)
    }

browserGlobal.process ??= {}
browserGlobal.global ??= globalThis
browserGlobal.process.browser ??= true
browserGlobal.process.env ??= {}
browserGlobal.process.noDeprecation ??= true
browserGlobal.process.pid ??= 0
browserGlobal.process.throwDeprecation ??= false
browserGlobal.process.traceDeprecation ??= false
browserGlobal.process.emitWarning ??= (message: unknown, ...args: unknown[]) => {
  console.warn(message, ...args)
}
browserGlobal.process.nextTick ??= (callback, ...args) => {
  runAsync(() => callback(...args))
}
