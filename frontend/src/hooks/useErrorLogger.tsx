/** 前端错误日志收集 Hook。 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { api } from '@/api/client'
import {
  formatLocalDateTimeWithSeconds,
  formatUtcOffsetDateTimeWithSeconds,
  getLocalTimeZoneLabel,
} from '@/lib/utils'
import { persistRuntimeTimeConfig, readRuntimeTimeConfig } from '@/lib/runtimeTimeConfig'
import { useAuthStore } from '@/store/useStore'

// 错误日志条目类型
export interface ErrorLogEntry {
  timestamp: string
  type: 'console' | 'network' | 'unhandled'
  message: string
  stack?: string
  url?: string
  status?: number
}

// 用户环境信息
export interface UserEnvironment {
  browser: string
  os: string
  screen: string
  userAgent: string
  currentUrl: string
  timestamp: string
  timeZone: string
}

// 最大保存的错误日志数量
const MAX_ERROR_LOGS = 50

export const BACKEND_LOG_PLACEHOLDER = '\n--- 后端错误日志 ---\n(点击反馈按钮后自动获取)\n'

export interface BackendErrorLogsResponse {
  logs: string[]
  count: number
}

export interface BugReportTimeConfig {
  displayUtcOffset: string
  displayTimeZone: string
}

interface GetLogsContentOptions {
  reportTime?: Date
  timeConfig?: BugReportTimeConfig
}

type ErrorLogListener = () => void

let errorLogsStore: ErrorLogEntry[] = []
let errorLoggerInstalled = false
const errorLogListeners = new Set<ErrorLogListener>()

// 获取浏览器信息
function getBrowserInfo(): string {
  const ua = navigator.userAgent
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Chrome')) return 'Chrome'
  if (ua.includes('Safari')) return 'Safari'
  if (ua.includes('Edge')) return 'Edge'
  return 'Unknown'
}

// 获取操作系统信息
function getOSInfo(): string {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac')) return 'macOS'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iOS')) return 'iOS'
  return 'Unknown'
}

// 获取用户环境信息
export function getUserEnvironment(): UserEnvironment {
  const now = new Date()

  return {
    browser: getBrowserInfo(),
    os: getOSInfo(),
    screen: `${window.screen.width}x${window.screen.height}`,
    userAgent: navigator.userAgent,
    currentUrl: window.location.href,
    timestamp: formatLocalDateTimeWithSeconds(now),
    timeZone: getLocalTimeZoneLabel(now),
  }
}

// Hook返回类型
interface UseErrorLoggerReturn {
  errorLogs: ErrorLogEntry[]
  clearLogs: () => void
  getLogsContent: (options?: GetLogsContentOptions) => string
}

function subscribeErrorLogs(listener: ErrorLogListener): () => void {
  errorLogListeners.add(listener)
  return () => {
    errorLogListeners.delete(listener)
  }
}

function getErrorLogsSnapshot(): ErrorLogEntry[] {
  return errorLogsStore
}

function notifyErrorLogListeners(): void {
  errorLogListeners.forEach(listener => listener())
}

function addErrorLog(entry: Omit<ErrorLogEntry, 'timestamp'>): void {
  const newEntry: ErrorLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }
  errorLogsStore = [...errorLogsStore, newEntry].slice(-MAX_ERROR_LOGS)
  notifyErrorLogListeners()
}

function clearErrorLogsStore(): void {
  errorLogsStore = []
  notifyErrorLogListeners()
}

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.message
  }
  if (typeof arg !== 'object' || arg === null) {
    return String(arg)
  }
  try {
    return JSON.stringify(arg)
  } catch {
    return Object.prototype.toString.call(arg)
  }
}

function shouldRecordConsoleError(message: string): boolean {
  return !message.includes('ReactDOM.render')
    && !message.includes('Download the React DevTools')
}

function ensureErrorLoggerInstalled(): void {
  if (errorLoggerInstalled) {
    return
  }
  errorLoggerInstalled = true

  const originalError = console.error
  console.error = (...args: unknown[]) => {
    const message = args.map(formatConsoleArg).join(' ')

    if (shouldRecordConsoleError(message)) {
      const entry = {
        type: 'console',
        message,
        stack: args.find(arg => arg instanceof Error)?.stack,
      } satisfies Omit<ErrorLogEntry, 'timestamp'>
      queueMicrotask(() => addErrorLog(entry))
    }

    originalError.apply(console, args)
  }

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const error = event.reason
    addErrorLog({
      type: 'unhandled',
      message: error?.message || String(error),
      stack: error?.stack,
    })
  })

  window.addEventListener('error', (event: ErrorEvent) => {
    addErrorLog({
      type: 'console',
      message: event.message,
      stack: event.error?.stack,
    })
  })

  api.interceptors.request.use(
    (config) => config,
    (error) => {
      addErrorLog({
        type: 'network',
        message: `Request failed: ${error.message}`,
        url: error.config?.url,
      })
      return Promise.reject(error)
    }
  )

  api.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error.response?.status
      const url = error.config?.url

      addErrorLog({
        type: 'network',
        message: `API Error ${status}: ${error.message}`,
        url,
        status,
      })

      return Promise.reject(error)
    }
  )
}

export function useErrorLogger(): UseErrorLoggerReturn {
  const errorLogs = useSyncExternalStore(
    subscribeErrorLogs,
    getErrorLogsSnapshot,
    getErrorLogsSnapshot,
  )
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    ensureErrorLoggerInstalled()
  }, [])
  
  // 清除日志
  const clearLogs = useCallback(() => {
    clearErrorLogsStore()
  }, [])
  
  // 获取日志内容
  const getLogsContent = useCallback((options?: GetLogsContentOptions): string => {
    const env = getUserEnvironment()
    const userInfo = user ? `${user.username} (${user.full_name || user.username})` : '未登录'
    const reportTime = options?.reportTime ?? new Date()
    const reportTimeZone = options?.timeConfig?.displayTimeZone ?? getLocalTimeZoneLabel(reportTime)
    const formatReportTime = (value: string | Date): string => {
      if (!options?.timeConfig) {
        return formatLocalDateTimeWithSeconds(value)
      }
      return formatUtcOffsetDateTimeWithSeconds(value, options.timeConfig.displayUtcOffset)
    }

    let content = `=== 实验室库存管理系统 Bug反馈日志 ===\n`
    content += `提交时间: ${formatReportTime(reportTime)}\n`
    content += `报告时区: ${reportTimeZone}\n`
    content += `浏览器时区: ${env.timeZone}\n`
    content += `用户: ${userInfo}\n`
    content += `浏览器: ${env.browser}\n`
    content += `操作系统: ${env.os}\n`
    content += `屏幕分辨率: ${env.screen}\n`
    content += `当前页面: ${env.currentUrl}\n`
    content += `用户代理: ${env.userAgent}\n`
    content += `\n--- 前端错误日志 (共 ${errorLogs.length} 条) ---\n\n`
    
    if (errorLogs.length === 0) {
      content += '(无前端错误记录)\n\n'
    } else {
      errorLogs.forEach((log, index) => {
        content += `[${index + 1}] ${formatReportTime(log.timestamp)} [${log.type.toUpperCase()}]\n`
        content += `    消息: ${log.message}\n`
        if (log.url) content += `    URL: ${log.url}\n`
        if (log.status) content += `    状态码: ${log.status}\n`
        if (log.stack) {
          content += `    堆栈:\n${log.stack.split('\n').map((line: string) => '        ' + line).join('\n')}\n`
        }
        content += '\n'
      })
    }
    
    content += BACKEND_LOG_PLACEHOLDER
    
    return content
  }, [errorLogs, user])
  
  return {
    errorLogs,
    clearLogs,
    getLogsContent,
  }
}

interface BugReportTimeConfigResponse {
  display_utc_offset?: unknown
  display_timezone?: unknown
}

export async function fetchBugReportTimeConfig(): Promise<BugReportTimeConfig | null> {
  const storedConfig = readRuntimeTimeConfig()

  try {
    const response = await api.get<BugReportTimeConfigResponse>('/runtime/cache-version')
    const displayUtcOffset =
      typeof response.data.display_utc_offset === 'string'
        ? response.data.display_utc_offset.trim()
        : ''
    const displayTimeZone =
      typeof response.data.display_timezone === 'string'
        ? response.data.display_timezone.trim()
        : ''
    if (!displayUtcOffset || !displayTimeZone) {
      return storedConfig
    }
    const config = { displayUtcOffset, displayTimeZone }
    persistRuntimeTimeConfig(config)
    return config
  } catch (error) {
    console.warn('无法获取 bug report 展示时区配置:', error)
    return storedConfig
  }
}

// 获取后端错误日志
export async function fetchBackendErrorLogs(hours: number = 24): Promise<BackendErrorLogsResponse> {
  try {
    const response = await api.get<BackendErrorLogsResponse>('/error-logs', {
      params: { hours },
    })
    return response.data
  } catch (error) {
    // 非管理员场景可能无法获取后端日志
    console.warn('无法获取后端日志:', error)
    return {
      logs: [],
      count: 0,
    }
  }
}
