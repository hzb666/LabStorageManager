import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'

// 初始化主题的组件 - 确保页面有正确的主题
function ThemeInitializer() {
  useEffect(() => {
    // 读取保存的主题设置
    const savedTheme = localStorage.getItem('theme') || 'light'
    const root = document.documentElement
    if (savedTheme === 'dark') {
      root.classList.add('dark')
      root.style.colorScheme = 'dark'
    } else {
      root.classList.remove('dark')
      root.style.colorScheme = 'light'
    }
  }, [])
  return null
}

export function NotFoundPage() {
  return (
    <>
      <ThemeInitializer />
      <div className="flex min-h-svh w-full items-center justify-center px-4">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:[mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
        
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <CircleQuestionMark className="size-5 text-muted-foreground" />
              </div>
              <div className="text-left">
                <CardTitle className="text-xl font-bold">页面未找到</CardTitle>
                <CardDescription>您访问的页面不存在</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                variant="morden"
                onClick={() => window.history.back()}
                className="flex-1"
                size="lg"
              >
                返回
              </Button>
              <Button asChild className="flex-1" size="lg">
                <Link to="/">
                  首页
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
