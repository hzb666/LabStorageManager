import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, LogIn, Eye, EyeOff, Sun, Moon } from 'lucide-react'
import { authAPI } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LABEL_STYLES } from '@/lib/constants'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

// 自定义密码输入组件，内部管理显示/隐藏状态
function PasswordInput({ 
  className, 
  ...props 
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [showPassword, setShowPassword] = useState(false)
  
  return (
    <div className="relative">
      <Input
        type={showPassword ? 'text' : 'password'}
        className={cn(
          "pr-10",
          // 密码掩码模式增大字符间距
          !showPassword && "tracking-widest",
          // placeholder 保持正常
          "placeholder:tracking-normal",
          className
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
})

type LoginForm = z.infer<typeof loginSchema>

export function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const { theme, toggleTheme } = useTheme()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setLoading(true)
    setError('')
    try {
      const response = await authAPI.login(data.username, data.password)
      const { user } = response.data
      setAuth(user)
      navigate('/')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      const detail = error.response?.data?.detail || ''
      // 将英文错误信息转换为中文
      if (detail.includes('Invalid credentials') || detail.includes('incorrect')) {
        setError('用户名或密码错误')
      } else {
        setError(detail || '登录失败，请检查用户名和密码')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:[mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-start justify-between">
            <div className="text-left pt-1">
              <CardTitle className="text-2xl font-bold">实验室库存管理系统</CardTitle>
              <CardDescription>请登录您的账户</CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="shrink-0 border-border border"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username" className={LABEL_STYLES.base}>用户名</Label>
              <Input
                id="username"
                {...register('username')}
                placeholder="请输入用户名"
                autoComplete="username"
              />
              {errors.username && (
                <p className="text-sm text-destructive">{String(errors.username.message)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className={LABEL_STYLES.base}>密码</Label>
              <PasswordInput
                id="password"
                {...register('password')}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
              {errors.password && (
                <p className="text-sm text-destructive">{String(errors.password.message)}</p>
              )}
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  登录
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
