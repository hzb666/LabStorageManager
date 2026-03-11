import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { Loader2, LogIn, Sun, Moon, ArrowLeft } from 'lucide-react'
import { authAPI } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { useTheme } from '@/hooks/useTheme'
import { useRememberedUser } from '@/hooks/useRememberedUser'
import { Button } from '@/components/ui/Button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'
import { toast } from '@/lib/toast'
import {
  LoginSchema,
  LockScreenSchema,
  normalizeApiErrorMessage,
  type LoginFormData,
} from '@/lib/validationSchemas'
import { BaseForm, type FieldSchema } from '@/components/BaseForm'

// 获取完整的图片URL，处理相对路径和绝对路径
const getFullImageUrl = (url: string): string => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  return `${API_BASE_URL}${url}`
}

// 锁屏模式验证模式（只需密码）
// 锁屏模式使用单独的 schema
const lockScreenSchema = LockScreenSchema

type NormalLoginForm = LoginFormData
type LockScreenForm = { password: string }

// 普通登录表单字段定义
const normalLoginFields: FieldSchema<NormalLoginForm>[] = [
  {
    name: 'username',
    label: '用户名',
    type: 'input',
    placeholder: '请输入用户名',
    autoComplete: 'username',
    required: true,
    maxLength: 20,
  },
  {
    name: 'password',
    label: '密码',
    type: 'password',
    placeholder: '请输入密码',
    autoComplete: 'current-password',
    required: true,
    maxLength: 50,
  },
]

// 锁屏模式表单字段定义
const lockScreenFields: FieldSchema<LockScreenForm>[] = [
  {
    name: 'password',
    label: '密码',
    type: 'password',
    placeholder: '请输入密码',
    autoComplete: 'current-password',
    required: true,
    maxLength: 50,
  },
]

export function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const { theme, toggleTheme } = useTheme()
  const { rememberedUser, saveRememberedUser, clearRememberedUser, updateRememberedUser } = useRememberedUser()

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  // [FIXME] 追踪是否正在等待导航完成，避免登录成功后闪烁显示锁屏
  const [isNavigating, setIsNavigating] = useState(false)

  // 锁屏模式：是否显示锁屏界面（登录过程中不显示）
  // 修复：增加 isNavigating 检查，确保登录成功后等待导航期间不显示锁屏
  const isLockScreen = !!rememberedUser && !isLoggingIn && !isNavigating

  // 普通登录表单
  const formNormal = useForm<NormalLoginForm>({
    resolver: valibotResolver(LoginSchema),
  })
  const { handleSubmit: handleNormalSubmit } = formNormal

  // 锁屏模式表单
  const formLock = useForm<LockScreenForm>({
    resolver: valibotResolver(lockScreenSchema),
  })
  const { handleSubmit: handleLockSubmit } = formLock
  
  // 处理普通登录
  const onNormalSubmit = async (data: NormalLoginForm) => {
    setLoading(true)
    setIsLoggingIn(true)
    setError('')
    try {
      const response = await authAPI.login(data.username, data.password)

      // 检查 Redis 状态头，如果不可用则显示 Toast 提示
      const redisStatus = response.headers?.['x-redis-status']
      if (redisStatus === 'unavailable') {
        toast.warning('Redis 服务未连接')
      }

      const { user } = response.data
      setAuth(user)

      // 保存记住的用户信息
      saveRememberedUser({
        userId: user.id,
        username: user.username,
        full_name: user.full_name || '',
        avatar_url: user.avatar_url,
      })

      // [FIXME] 设置导航状态，防止登录成功后闪烁显示锁屏
      setIsNavigating(true)
      navigate('/')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      const detail = error.response?.data?.detail || ''
      // 将英文错误信息转换为中文
      if (normalizeApiErrorMessage(detail) === '用户名或密码错误') {
        formNormal.setError('username', { message: '' })
        formNormal.setError('password', { message: '用户名或密码错误' })
        setError('')
      } else {
        setError(normalizeApiErrorMessage(detail, '登录失败，请检查用户名和密码'))
      }
    } finally {
      setLoading(false)
      setIsLoggingIn(false)
    }
  }

  // 处理锁屏模式登录
  const onLockSubmit = async (data: LockScreenForm) => {
    if (!rememberedUser) return

    setLoading(true)
    setError('')
    try {
      const response = await authAPI.login(rememberedUser.username, data.password)

      // 检查 Redis 状态头，如果不可用则显示 Toast 提示
      const redisStatus = response.headers?.['x-redis-status']
      if (redisStatus === 'unavailable') {
        toast.warning('Redis 服务未连接')
      }

      const { user } = response.data
      setAuth(user)

      // 检查用户名是否发生变化
      if (user.username !== rememberedUser.username) {
        // 用户名发生变化，清除旧的，保存新的
        clearRememberedUser()
        saveRememberedUser({
          userId: user.id,
          username: user.username,
          full_name: user.full_name || '',
          avatar_url: user.avatar_url,
        })
      } else {
        // 用户名相同，始终更新头像和全名（确保修改后同步更新）
        updateRememberedUser({
          avatar_url: user.avatar_url,
          full_name: user.full_name || '',
        })
      }

      navigate('/')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      const detail = error.response?.data?.detail || ''
      if (normalizeApiErrorMessage(detail) === '用户名或密码错误') {
        // 密码错误显示在输入框下方
        formLock.setError('password', { message: '密码错误' })
      } else {
        // 其他错误显示在页面顶部
        setError(normalizeApiErrorMessage(detail, '登录失败，请检查密码'))
      }
    } finally {
      setLoading(false)
    }
  }

  // 切换用户：清除记住的用户信息，返回普通登录模式
  const handleSwitchUser = () => {
    clearRememberedUser()
    setError('')
  }

  // 渲染锁屏模式
  const renderLockScreen = () => {
    // 锁屏模式下 rememberedUser 一定有值
    if (!rememberedUser) return null

    return (
      <form onSubmit={handleLockSubmit(onLockSubmit)} className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            {error}
          </div>
        )}

        {/* 头像区域 */}
        <div className="flex flex-col items-center py-4">
          <Avatar className="h-24 w-24 mb-4">
            {rememberedUser.avatar_url ? (
              <AvatarImage src={rememberedUser.avatar_url ? getFullImageUrl(rememberedUser.avatar_url) : undefined} alt={rememberedUser.username} />
            ) : (
              <AvatarFallback className="text-2xl bg-primary text-primary-foreground dark:text-sidebar-foreground">
                {rememberedUser.username?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            )}
          </Avatar>
          {/* 欢迎 + 全名 */}
          <p className="text-lg font-semibold">
            欢迎{rememberedUser.full_name ? `，${rememberedUser.full_name}` : ''}
          </p>
          {/* 用户名显示在角色位置 */}
          <p className="text-muted-foreground">{rememberedUser.username}</p>
        </div>

        <BaseForm
          form={formLock}
          fields={lockScreenFields}
          layout="stack"
        />
        {/* 切换用户按钮 */}
        <div className="flex gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="morden"
                size="lg"
                onClick={handleSwitchUser}
                className="shrink-0 h-10 w-10"
              >
                <ArrowLeft className="size-4.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>切换用户</p>
            </TooltipContent>
          </Tooltip>
          <Button type="submit" className="flex-1" size="lg" disabled={loading}>
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
        </div>
      </form>
    )
  }

  // 渲染普通登录模式
  const renderNormalLogin = () => (
    <form onSubmit={handleNormalSubmit(onNormalSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}
      <BaseForm
        form={formNormal}
        fields={normalLoginFields}
        layout="stack"
      />
      <Button type="submit" className="w-full mt-2" size="lg" disabled={loading} >
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
  )

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-start justify-between">
            <div className="text-left p-1">
              <CardTitle className="text-2xl font-bold">实验室库存管理系统</CardTitle>
              {!isLockScreen && (
                <CardDescription>请登录您的账户</CardDescription>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  className="shrink-0 border-border border"
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{theme === 'dark' ? '切换亮色' : '切换暗黑'}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {isLockScreen ? renderLockScreen() : renderNormalLogin()}
        </CardContent>
      </Card>
    </div>
  )
}

// [FIXME]:锁屏模式头像更新