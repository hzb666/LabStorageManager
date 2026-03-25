import { useEffect, useRef, useState, type BaseSyntheticEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { Loader2, LogIn, Sun, Moon, ArrowLeft } from 'lucide-react'
import { authAPI } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { useTheme } from '@/hooks/useTheme'
import { useRememberedUser, type RememberedUser } from '@/hooks/useRememberedUser'
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
  getApiErrorMessage,
  LoginSchema,
  LockScreenSchema,
  type LoginFormData,
} from '@/lib/validationSchemas'
import { AUTH_NOTICE_KEY } from '@/lib/constants'
import { BaseForm, type FieldSchema } from '@/components/BaseForm'
import { getFullImageUrl } from '@/lib/utils'

/**
 * 复用登录表单的字段类型。
 * 存在原因：让普通登录相关类型命名与锁屏模式区分开，便于页面内部阅读。
 */
type NormalLoginForm = LoginFormData

/**
 * 描述锁屏模式下只提交密码的表单结构。
 * 存在原因：锁屏登录不需要用户名字段，单独建模可以避免和普通登录混淆。
 */
type LockScreenForm = { password: string }

/**
 * 复用锁屏模式的校验规则。
 * 存在原因：把 schema 绑定到当前页面语义，避免直接在组件内部散落引用。
 */
const lockScreenSchema = LockScreenSchema

/**
 * 定义普通登录表单字段配置。
 * 存在原因：让 BaseForm 通过稳定配置渲染输入项，避免 JSX 内重复声明字段元数据。
 */
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

/**
 * 定义锁屏模式表单字段配置。
 * 存在原因：锁屏模式只展示密码输入框，单独配置后可以和普通登录表单共用渲染组件。
 */
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

/**
 * 描述登录接口返回后当前页面真正关心的用户字段。
 * 存在原因：记住用户逻辑只依赖少量字段，单独收口可以避免直接耦合更大的用户类型。
 */
type LoginUser = {
  id: number
  username: string
  full_name?: string | null
  avatar_url?: string | null
}

/**
 * 描述主题切换按钮所需的入参。
 * 存在原因：把主题状态和切换动作收口到独立组件，减少主页面耦合。
 */
interface ThemeToggleButtonProps {
  theme: string
  toggleTheme: () => void
}

/**
 * 描述通用错误提示组件的入参。
 * 存在原因：普通登录和锁屏登录都需要同一套错误展示结构，统一接口更清晰。
 */
interface AuthErrorNoticeProps {
  error: string
}

/**
 * 描述锁屏模式用户摘要组件的入参。
 * 存在原因：该区域只依赖记住的用户信息，单独定义便于和表单逻辑解耦。
 */
interface LockScreenSummaryProps {
  rememberedUser: RememberedUser
}

/**
 * 描述锁屏登录表单组件的入参。
 * 存在原因：把锁屏模式的错误、提交和切换用户动作显式化，方便复用独立视图。
 */
interface LockScreenFormViewProps {
  error: string
  form: ReturnType<typeof useForm<LockScreenForm>>
  rememberedUser: RememberedUser
  loading: boolean
  onSubmit: (event?: BaseSyntheticEvent) => Promise<void>
  onSwitchUser: () => void
}

/**
 * 描述普通登录表单组件的入参。
 * 存在原因：让普通登录视图只消费必要状态，避免直接依赖页面内部实现细节。
 */
interface NormalLoginFormViewProps {
  error: string
  form: ReturnType<typeof useForm<NormalLoginForm>>
  loading: boolean
  onSubmit: (event?: BaseSyntheticEvent) => Promise<void>
}

/**
 * 计算当前是否应该展示锁屏模式，避免登录成功后导航过程中短暂闪回。
 * 这个函数存在是为了把锁屏判定从页面主体中抽离，降低主组件复杂度。
 */
function shouldShowLockScreen(
  rememberedUser: RememberedUser | null,
  isLoggingIn: boolean,
  isNavigating: boolean
): rememberedUser is RememberedUser {
  return Boolean(rememberedUser) && !isLoggingIn && !isNavigating
}

/**
 * 统一保存登录成功后的记住用户信息，确保普通登录路径复用同一组字段映射。
 * 这个函数存在是为了避免页面内重复拼装 remembered user 对象。
 */
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

/**
 * 同步锁屏登录后的记住用户信息，保持用户名变更与头像更新逻辑不变。
 * 这个函数存在是为了把锁屏模式的分支判断收敛到单一位置。
 */
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

/**
 * 统一处理登录响应里的 Redis 状态提示，避免普通登录和锁屏登录重复判断。
 * 这个函数存在是为了保持提醒文案与行为一致，同时压缩提交流程代码。
 */
function showRedisUnavailableNotice(headers?: Record<string, unknown>) {
  if (headers?.['x-redis-status'] === 'unavailable') {
    toast.warning('Redis 服务未连接')
  }
}

/**
 * 渲染通用的错误提示区域。
 * 这个函数存在是为了让普通登录和锁屏登录共享同一份错误展示结构。
 */
function AuthErrorNotice({ error }: AuthErrorNoticeProps) {
  if (!error) {
    return null
  }

  return (
    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
      {error}
    </div>
  )
}

/**
 * 渲染登录页的主题切换按钮。
 * 这个函数存在是为了把头部小交互从主页面 JSX 中拆开，减少页面主体噪音。
 */
function ThemeToggleButton({ theme, toggleTheme }: ThemeToggleButtonProps) {
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

/**
 * 渲染锁屏模式下的用户摘要。
 * 这个函数存在是为了把头像与欢迎文案从表单主体中独立出来，缩短登录页主函数。
 */
function LockScreenSummary({ rememberedUser }: LockScreenSummaryProps) {
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

/**
 * 渲染锁屏模式登录表单。
 * 这个函数存在是为了把锁屏模式的独立 UI 拆出，降低 Login 主组件长度。
 */
function LockScreenFormView({
  error,
  form,
  rememberedUser,
  loading,
  onSubmit,
  onSwitchUser,
}: LockScreenFormViewProps) {
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

/**
 * 渲染普通登录表单。
 * 这个函数存在是为了让主页面只负责模式切换，而不是同时承载两套表单结构。
 */
function NormalLoginFormView({
  error,
  form,
  loading,
  onSubmit,
}: NormalLoginFormViewProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthErrorNotice error={error} />
      <BaseForm
        form={form}
        fields={normalLoginFields}
        layout="stack"
      />
      <Button type="submit" className="w-full mt-2" size="lg" disabled={loading}>
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
}

/**
 * 登录页负责普通登录与锁屏登录两种模式的编排。
 * 这个函数存在是为了复用记住用户体验，同时保持原有登录成功、提示和跳转行为不变。
 */
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

  const formNormal = useForm<NormalLoginForm>({
    resolver: valibotResolver(LoginSchema),
  })

  const formLock = useForm<LockScreenForm>({
    resolver: valibotResolver(lockScreenSchema),
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

  const onNormalSubmit = async (data: NormalLoginForm) => {
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
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] dark:mask-[radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
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
