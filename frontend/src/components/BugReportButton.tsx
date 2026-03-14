/**
 * BugReportButton - Bug反馈按钮组件
 * 
 * 点击后：
 * 1. 获取前端错误日志
 * 2. 获取后端错误日志（需要管理员权限）
 * 3. 生成日志文件并下载
 * 4. 打开mailto链接
 */
import { useState, useCallback } from 'react'
import { Bug, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useErrorLogger, fetchBackendErrorLogs } from '@/hooks/useErrorLogger'
import { useAuthStore } from '@/store/useStore'
import { setBugButtonHidden } from '@/lib/bugReportButtonStorage'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'

// 收件人邮箱
const RECIPIENT_EMAIL = 'hzb666@88.com'
const EMAIL_SUBJECT = '实验室库存管理系统 - Bug反馈'

interface BugReportButtonProps {
  variant?: 'default' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  showText?: boolean
  className?: string
  title?: string
  onRightClick?: () => void
}

export function BugReportButton({ 
  variant = 'ghost', 
  size = 'default',
  showText = true,
  className = '',
  title = '反馈问题',
  onRightClick
}: BugReportButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { errorLogs, getLogsContent } = useErrorLogger()
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
  
  // 生成文件名
  const generateFileName = (): string => {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `bug_report_${timestamp}.txt`
  }
  
  // 下载日志文件
  const downloadLogFile = (content: string, fileName: string): void => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.style.display = 'none'
    
    document.body.appendChild(link)
    link.click()
    
    // 清理
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
  
  // 创建mailto链接
  const createMailtoLink = (body: string): string => {
    const encodedSubject = encodeURIComponent(EMAIL_SUBJECT)
    const encodedBody = encodeURIComponent(body)
    return `mailto:${RECIPIENT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`
  }
  
  // 处理右键点击 - 隐藏按钮1天
  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setBugButtonHidden(1) // 隐藏1天
    if (onRightClick) {
      onRightClick()
    }
  }, [onRightClick])

  // 处理反馈
  const handleReport = useCallback(async () => {
    setIsLoading(true)
    
    try {
      // 1. 获取前端错误日志内容
      let logContent = getLogsContent()
      
      // 2. 尝试获取后端错误日志
      let backendLogs: string[] = []
      try {
        backendLogs = await fetchBackendErrorLogs(24) // 获取最近24小时的日志
      } catch (error) {
        console.warn('无法获取后端日志:', error)
      }
      
      // 3. 添加后端日志到内容
      if (backendLogs.length > 0) {
        logContent = logContent.replace(
          '\n--- 后端错误日志 ---\n',
          `\n--- 后端错误日志 (共 ${backendLogs.length} 条) ---\n\n` +
          backendLogs.join('\n')
        )
      } else {
        logContent = logContent.replace(
          '\n--- 后端错误日志 ---\n',
          '\n--- 后端错误日志 ---\n(无后端错误记录，或权限不足)'
        )
      }
      
      // 4. 添加用户说明
      const userNote = `\n\n--- 用户说明 ---\n请在此处描述您遇到的问题:\n\n\n\n` +
        `---------------\n` +
        `此邮件由实验室库存管理系统自动生成\n` +
        `生成时间: ${formatTime(new Date())}\n` +
        `用户: ${user?.username || '未登录'}\n`
      
      logContent += userNote
      
      // 5. 下载日志文件
      const fileName = generateFileName()
      downloadLogFile(logContent, fileName)
      
      // 6. 打开mailto链接
      const mailtoBody = `${EMAIL_SUBJECT}\n\n` +
        `***提示: 错误日志文件已自动下载，请作为附件添加到此邮件中。***\n\n` +
        `您好，\n\n` +
        `我在使用实验室库存管理系统时遇到了问题。\n` +
        `文件名: ${fileName}\n\n` +
        `--- 问题描述 ---\n请在此处描述问题...\n\n\n` +
        `此邮件由系统自动生成\n` +
        `生成时间: ${formatTime(new Date())}`
      
      const mailtoLink = createMailtoLink(mailtoBody)
      window.open(mailtoLink, '_blank')
      
    } catch (error) {
      console.error('生成反馈失败:', error)
      alert('生成反馈失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }, [errorLogs, getLogsContent, user])
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={handleReport}
          onContextMenu={handleRightClick}
          disabled={isLoading}
          className={showText ? `justify-start ${className}` : className}
        >
          {isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Bug className="size-5 text-muted-foreground" />
          )}
          {showText && (
            <span className="ml-3">反馈问题</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{title}，右键隐藏</p>
      </TooltipContent>
    </Tooltip>
  )
}

// 带邮件图标的版本
export function BugReportButtonWithMailIcon({ 
  variant = 'ghost', 
  size = 'default' 
}: Omit<BugReportButtonProps, 'showText'>) {
  return (
    <BugReportButton 
      variant={variant} 
      size={size}
      showText={true}
    />
  )
}
