import { AUTH_NOTICE_KEY } from '@/lib/constants'
import { disconnectAllSSEConnections } from '@/lib/sseRuntime'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/store/useStore'
import { useSSEStore } from '@/store/sseStore'

type InvalidateReason = {
  notice: string
  skipApi?: boolean
}

const AUTH_CODE_NOTICE_MAP: Record<string, string> = {
  AUTH_MISSING_TOKEN: '登录状态已失效，请重新登录',
  AUTH_INVALID_TOKEN: '登录状态异常，请重新登录',
  AUTH_USER_NOT_FOUND: '用户不存在，请重新登录',
  AUTH_USER_DISABLED: '账号已被禁用',
  AUTH_SESSION_REVOKED: '当前设备已被踢出，请重新登录',
  AUTH_SESSION_EXPIRED: '会话已过期，请重新登录',
  AUTH_SESSION_VERSION_MISMATCH: '账号信息已变更，请重新登录',
  AUTH_SESSION_IP_CHANGED: '登录环境变化，请重新登录',
  AUTH_SESSION_USER_MISMATCH: '登录状态异常，请重新登录',
}

const AUTH_REASON_NOTICE_MAP: Record<string, string> = {
  session_kicked: '当前设备已被踢出，请重新登录',
  kick_other_devices: '当前设备已被踢出，请重新登录',
  device_relogin: '当前设备登录已在其他端刷新，请重新登录',
  session_revoked: '登录状态已失效，请重新登录',
  session_revalidation_failed: '登录状态已失效，请重新登录',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords
  password_changed: '密码已修改，请重新登录',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords
  password_reset: '密码已重置，请重新登录',
  user_deactivated: '账号已被禁用',
}

let invalidationInFlight = false

export const resolveAuthNoticeByCode = (
  authErrorCode: string | undefined,
  fallbackNotice: string
): string => {
  if (!authErrorCode) {
    return fallbackNotice
  }
  return AUTH_CODE_NOTICE_MAP[authErrorCode] ?? fallbackNotice
}

export const resolveAuthNoticeByReason = (
  reason: string | undefined,
  fallbackNotice: string
): string => {
  if (!reason) {
    return fallbackNotice
  }
  return AUTH_REASON_NOTICE_MAP[reason] ?? fallbackNotice
}

export const triggerSessionInvalidation = async ({
  notice,
  skipApi = true,
}: InvalidateReason): Promise<void> => {
  if (invalidationInFlight) {
    return
  }
  invalidationInFlight = true

  try {
    try {
      sessionStorage.setItem(AUTH_NOTICE_KEY, notice)
    } catch {
      toast.warning(notice)
    }

    disconnectAllSSEConnections()
    useSSEStore.getState().reset()
    await useAuthStore.getState().logout({ skipApi, forceLocal: true })
  } finally {
    // 仅用于并发去重，不应永久锁死，避免后续登录周期无法再次触发失效处理。
    invalidationInFlight = false
    if (globalThis.location.pathname !== '/login') {
      globalThis.location.replace('/login')
    }
  }
}
