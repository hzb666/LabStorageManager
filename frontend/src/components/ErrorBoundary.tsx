import React from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  private ensureErrorTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light'
    const root = document.documentElement
    if (savedTheme === 'dark') {
      root.classList.add('dark')
      root.style.colorScheme = 'dark'
    } else {
      root.classList.remove('dark')
      root.style.colorScheme = 'light'
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.ensureErrorTheme()
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    globalThis.location.reload()
  }

  handleBack = () => {
    if (globalThis.history.length > 1) {
      globalThis.history.back()
    } else {
      // 如果没有历史记录，跳转到首页
      globalThis.location.href = '/'
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-svh w-full items-center justify-center px-4">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
            
            <Card className="w-full max-w-sm">
              <CardHeader className="space-y-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <CircleAlert className="size-5 text-destructive" />
                  </div>
                  <div className="text-left">
                    <CardTitle className="text-xl font-bold">页面出现错误</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md mb-6">
                  {this.state.error?.message || '发生了未知错误，请刷新页面重试。'}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="morden"
                    onClick={this.handleBack}
                    className="flex-1"
                    size="lg"
                  >
                    返回
                  </Button>
                  <Button
                    onClick={this.handleReload}
                    className="flex-1"
                    size="lg"
                  >
                    刷新页面
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
      )
    }

    return this.props.children
  }
}
