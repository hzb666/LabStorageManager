/**
 * useErrorLogger - 前端错误日志收集Hook
 * 
 * 自动捕获前端控制台错误和网络请求错误
 * 日志仅保存在内存中，页面刷新后清除（保护隐私）
 */
import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
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
}

// 最大保存的错误日志数量
const MAX_ERROR_LOGS = 50

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
  return {
    browser: getBrowserInfo(),
    os: getOSInfo(),
    screen: `${window.screen.width}x${window.screen.height}`,
    userAgent: navigator.userAgent,
    currentUrl: window.location.href,
    timestamp: new Date().toISOString(),
  }
}

// Hook返回类型
interface UseErrorLoggerReturn {
  errorLogs: ErrorLogEntry[]
  clearLogs: () => void
  getLogsContent: () => string
}

export function useErrorLogger(): UseErrorLoggerReturn {
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])
  const user = useAuthStore((state) => state.user)
  
  // 格式化时间
  const formatTime = (date: Date): string => {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
  
  // 添加错误日志
  const addErrorLog = useCallback((entry: Omit<ErrorLogEntry, 'timestamp'>) => {
    const newEntry: ErrorLogEntry = {
      ...entry,
      timestamp: formatTime(new Date()),
    }
    
    setErrorLogs(prev => {
      const newLogs = [...prev, newEntry]
      // 保持最大数量限制
      if (newLogs.length > MAX_ERROR_LOGS) {
        return newLogs.slice(-MAX_ERROR_LOGS)
      }
      return newLogs
    })
  }, [])
  
  // 捕获console.error
  useEffect(() => {
    const originalError = console.error
    
    console.error = (...args: unknown[]) => {
      // 避免重复记录React错误
      const message = args.map(arg => {
        if (arg instanceof Error) return arg.message
        if (typeof arg === 'object') return JSON.stringify(arg)
        return String(arg)
      }).join(' ')
      
      // 过滤掉一些常见的无关错误
      if (!message.includes('ReactDOM.render') && 
          !message.includes('Download the React DevTools')) {
        addErrorLog({
          type: 'console',
          message,
          stack: args.find(arg => arg instanceof Error)?.stack,
        })
      }
      
      originalError.apply(console, args)
    }
    
    return () => {
      console.error = originalError
    }
  }, [addErrorLog])
  
  // 捕获未处理的Promise拒绝
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason
      addErrorLog({
        type: 'unhandled',
        message: error?.message || String(error),
        stack: error?.stack,
      })
    }
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [addErrorLog])
  
  // 捕获全局错误
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addErrorLog({
        type: 'console',
        message: event.message,
        stack: event.error?.stack,
      })
    }
    
    window.addEventListener('error', handleError)
    
    return () => {
      window.removeEventListener('error', handleError)
    }
  }, [addErrorLog])
  
  // 拦截API请求错误
  useEffect(() => {
    const originalRequest = api.interceptors.request.use(
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
    
    const originalResponse = api.interceptors.response.use(
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
    
    return () => {
      api.interceptors.request.eject(originalRequest)
      api.interceptors.response.eject(originalResponse)
    }
  }, [addErrorLog])
  
  // 清除日志
  const clearLogs = useCallback(() => {
    setErrorLogs([])
  }, [])
  
  // 获取日志内容
  const getLogsContent = useCallback((): string => {
    const env = getUserEnvironment()
    const userInfo = user ? `${user.username} (${user.full_name || user.username})` : '未登录'
    
    let content = `=== 实验室库存管理系统 Bug反馈日志 ===\n`
    content += `提交时间: ${formatTime(new Date())}\n`
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
        content += `[${index + 1}] ${log.timestamp} [${log.type.toUpperCase()}]\n`
        content += `    消息: ${log.message}\n`
        if (log.url) content += `    URL: ${log.url}\n`
        if (log.status) content += `    状态码: ${log.status}\n`
        if (log.stack) {
          content += `    堆栈:\n${log.stack.split('\n').map((line: string) => '        ' + line).join('\n')}\n`
        }
        content += '\n'
      })
    }
    
    content += `\n--- 后端错误日志 ---\n`
    content += `(点击反馈按钮后自动获取)\n`
    
    return content
  }, [errorLogs, user])
  
  return {
    errorLogs,
    clearLogs,
    getLogsContent,
  }
}

// 获取后端错误日志
export async function fetchBackendErrorLogs(hours: number = 24): Promise<string[]> {
  try {
    const response = await api.get<{ logs: string[]; count: number }>('/error-logs', {
      params: { hours },
    })
    return response.data.logs
  } catch (error) {
    // 如果不是管理员，可能无法获取后端日志
    console.warn('无法获取后端日志:', error)
    return []
  }
}
