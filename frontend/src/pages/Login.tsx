import { useEffect, useRef, useState, type BaseSyntheticEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { LogIn, Sun, Moon, ArrowLeft } from 'lucide-react'
import { authAPI } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { useTheme } from '@/hooks/useTheme'
import { useRememberedUser, type RememberedUser } from '@/hooks/useRememberedUser'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
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
  getApiErrorMessage,
  LoginSchema,
  LockScreenSchema,
  type LoginFormData,
} from '@/lib/validationSchemas'
import { AUTH_NOTICE_KEY } from '@/lib/constants'
import { BaseForm, type FieldSchema } from '@/components/BaseForm'
import { getFullImageUrl } from '@/lib/utils'

// 锁屏复验阶段沿用 remembered user，只允许重新输入密码，不在这里切换用户名。
type LockScreenForm = { password: string }

const normalLoginFields: FieldSchema<LoginFormData>[] = [
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

// 锁屏阶段禁止改用户名，切换账号走独立按钮流程，表单只提供密码输入。
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

// 记住的用户信息保存持久化和同步所需字段。
type LoginUser = {
  id: number
  username: string
  full_name?: string | null
  avatar_url?: string | null
}

// 存在记住的用户信息，且当前未提交普通登录、未发生页面跳转时，显示锁屏界面。
function shouldShowLockScreen(
  rememberedUser: RememberedUser | null,
  isLoggingIn: boolean,
  isNavigating: boolean
): rememberedUser is RememberedUser {
  return Boolean(rememberedUser) && !isLoggingIn && !isNavigating
}

// 登录成功后把接口返回用户映射为 remembered user 持久化结构。
function saveRememberedLoginUser(
  saveRememberedUser: (user: RememberedUser) => void,
  user: LoginUser
) {
  saveRememberedUser({
    userId: user.id,
    username: user.username,
    full_name: user.full_name || '',
    avatar_url: user.avatar_url || undefined,
  })
}

// 锁屏登录后，用户名变化则重建记住的用户信息；用户名不变时同步头像和姓名。
function syncRememberedUserAfterLockLogin(
  rememberedUser: RememberedUser,
  user: LoginUser,
  actions: {
    saveRememberedUser: (nextUser: RememberedUser) => void
    clearRememberedUser: () => void
    updateRememberedUser: (updates: Partial<RememberedUser>) => void
  }
) {
  if (user.username !== rememberedUser.username) {
    actions.clearRememberedUser()
    saveRememberedLoginUser(actions.saveRememberedUser, user)
    return
  }

  actions.updateRememberedUser({
    avatar_url: user.avatar_url || undefined,
    full_name: user.full_name || '',
  })
}

// 响应头 `x-redis-status=unavailable` 时提示 Redis 服务不可用。
function showRedisUnavailableNotice(headers?: Record<string, unknown>) {
  if (headers?.['x-redis-status'] === 'unavailable') {
    toast.warning('Redis 服务未连接')
  }
}

function AuthErrorNotice({ error }: Readonly<{ error: string }>) {
  if (!error) {
    return null
  }

  return (
    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
      {error}
    </div>
  )
}

function ThemeToggleButton({ theme, toggleTheme }: Readonly<{
  theme: string
  toggleTheme: () => void
}>) {
  return (
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
  )
}

function LockScreenSummary({ rememberedUser }: Readonly<{ rememberedUser: RememberedUser }>) {
  return (
    <div className="flex flex-col items-center py-4">
      <Avatar className="h-24 w-24 mb-4">
        {rememberedUser.avatar_url ? (
          <AvatarImage
            src={getFullImageUrl(rememberedUser.avatar_url)}
            alt={rememberedUser.username}
          />
        ) : (
          <AvatarFallback className="text-2xl bg-primary text-primary-foreground dark:text-sidebar-foreground">
            {rememberedUser.username?.charAt(0).toUpperCase() || 'U'}
          </AvatarFallback>
        )}
      </Avatar>
      <p className="text-lg font-bold">
        欢迎{rememberedUser.full_name ? `，${rememberedUser.full_name}` : ''}
      </p>
      <p className="text-muted-foreground">{rememberedUser.username}</p>
    </div>
  )
}

// 锁屏视图提供切换用户入口，remembered user 失效时也能退出锁屏。
function LockScreenFormView({
  error,
  form,
  rememberedUser,
  loading,
  onSubmit,
  onSwitchUser,
}: Readonly<{
  error: string
  form: ReturnType<typeof useForm<LockScreenForm>>
  rememberedUser: RememberedUser
  loading: boolean
  onSubmit: (event?: BaseSyntheticEvent) => Promise<void>
  onSwitchUser: () => void
}>) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthErrorNotice error={error} />
      <LockScreenSummary rememberedUser={rememberedUser} />
      <BaseForm
        form={form}
        fields={lockScreenFields}
        layout="stack"
      />
      <div className="flex gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="modern"
              size="lg"
              onClick={onSwitchUser}
              className="shrink-0 h-10 w-10"
            >
              <ArrowLeft className="size-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>切换用户</p>
          </TooltipContent>
        </Tooltip>
        <LoadingButton
          type="submit"
          className="flex-1"
          size="lg"
          isLoading={loading}
          loadingText="登录中..."
        >
          <LogIn className="mr-2 h-4 w-4" />
          登录
        </LoadingButton>
      </div>
    </form>
  )
}

// 普通登录视图不渲染 remembered user 摘要，避免把锁屏态入口和首次登录入口混在一起。
function NormalLoginFormView({
  error,
  form,
  loading,
  onSubmit,
}: Readonly<{
  error: string
  form: ReturnType<typeof useForm<LoginFormData>>
  loading: boolean
  onSubmit: (event?: BaseSyntheticEvent) => Promise<void>
}>) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthErrorNotice error={error} />
      <BaseForm
        form={form}
        fields={normalLoginFields}
        layout="stack"
      />
      <LoadingButton
        type="submit"
        className="w-full mt-2"
        size="lg"
        isLoading={loading}
        loadingText="登录中..."
      >
        <LogIn className="mr-2 h-4 w-4" />
        登录
      </LoadingButton>
    </form>
  )
}

// 页面根据 remembered user 与登录/跳转瞬时状态，在普通登录和锁屏登录之间切换。
export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((state) => state.setAuth)
  const { theme, toggleTheme } = useTheme()
  const { rememberedUser, saveRememberedUser, clearRememberedUser, updateRememberedUser } =
    useRememberedUser()

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const hasShownAuthNotice = useRef(false)

  const isLockScreen = shouldShowLockScreen(rememberedUser, isLoggingIn, isNavigating)

  const formNormal = useForm<LoginFormData>({
    resolver: valibotResolver(LoginSchema),
  })

  const formLock = useForm<LockScreenForm>({
    resolver: valibotResolver(LockScreenSchema),
  })

  useEffect(() => {
    if (hasShownAuthNotice.current) {
      return
    }

    const routeNotice = (location.state as { authNotice?: string } | null)?.authNotice
    let persistedNotice = ''
    try {
      persistedNotice = sessionStorage.getItem(AUTH_NOTICE_KEY) || ''
    } catch {
      persistedNotice = ''
    }

    const notice = persistedNotice || routeNotice
    if (!notice) {
      return
    }

    hasShownAuthNotice.current = true
    toast.warning(notice)
    try {
      sessionStorage.removeItem(AUTH_NOTICE_KEY)
    } catch {
      // 忽略存储异常，保持已有通知行为。
    }
  }, [location.state])

  const onNormalSubmit = async (data: LoginFormData) => {
    setLoading(true)
    setIsLoggingIn(true)
    setError('')
    try {
      const response = await authAPI.login(data.username, data.password)
      showRedisUnavailableNotice(response.headers as Record<string, unknown> | undefined)

      const { user } = response.data
      setAuth(user)
      saveRememberedLoginUser(saveRememberedUser, user)

      setIsNavigating(true)
      navigate('/')
    } catch (err: unknown) {
      const errorMessage = getApiErrorMessage(err, '登录失败，请检查用户名和密码')
      if (errorMessage === '用户名或密码错误') {
        formNormal.setError('username', { message: '' })
        formNormal.setError('password', { message: '用户名或密码错误' })
        setError('')
      } else {
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
      setIsLoggingIn(false)
    }
  }

  const onLockSubmit = async (data: LockScreenForm) => {
    if (!rememberedUser) {
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await authAPI.login(rememberedUser.username, data.password)
      showRedisUnavailableNotice(response.headers as Record<string, unknown> | undefined)

      const { user } = response.data
      setAuth(user)
      syncRememberedUserAfterLockLogin(rememberedUser, user, {
        saveRememberedUser,
        clearRememberedUser,
        updateRememberedUser,
      })
      navigate('/')
    } catch (err: unknown) {
      const errorMessage = getApiErrorMessage(err, '登录失败，请检查密码')
      if (errorMessage === '用户名或密码错误') {
        formLock.setError('password', { message: '密码错误' })
      } else {
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSwitchUser = () => {
    clearRememberedUser()
    setError('')
  }

  const lockScreenContent = rememberedUser ? (
    <LockScreenFormView
      error={error}
      form={formLock}
      rememberedUser={rememberedUser}
      loading={loading}
      onSubmit={formLock.handleSubmit(onLockSubmit)}
      onSwitchUser={handleSwitchUser}
    />
  ) : null

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 [background-image:radial-gradient(circle_at_center,#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)] dark:[background-image:radial-gradient(circle_at_center,#1f2937_1px,transparent_1px)] dark:[mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)]" />
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-start justify-between">
            <div className="text-left p-1">
              <CardTitle className="text-2xl font-bold">实验室库存管理系统</CardTitle>
              {!isLockScreen && <CardDescription>请登录您的账户</CardDescription>}
            </div>
            <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {isLockScreen
            ? lockScreenContent
            : (
              <NormalLoginFormView
                error={error}
                form={formNormal}
                loading={loading}
                onSubmit={formNormal.handleSubmit(onNormalSubmit)}
              />
            )}
        </CardContent>
      </Card>
    </div>
  )
}
