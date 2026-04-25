import {
  isRecord,
  parseJson,
  readLocalStorageItem,
  writeLocalStorageItem,
} from './localStorageCore'

const APP_AUTH_META_STORAGE_KEY = 'app-auth-meta'
let fallbackIdCounter = 0

export type RememberedUser = {
  userId: number
  username: string
  full_name: string
  avatar_url?: string
}

export type DeviceInfo = {
  id: string
  name: string
}

export type AppAuthMetaStorage = {
  version: number
  device: DeviceInfo
  rememberedUser: RememberedUser | null
}

const DEFAULT_APP_AUTH_META_STORAGE: AppAuthMetaStorage = {
  version: 1,
  device: {
    id: '',
    name: '',
  },
  rememberedUser: null,
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRememberedUser(value: unknown): RememberedUser | null {
  if (!isRecord(value)) {
    return null
  }

  const userId = typeof value.userId === 'number' ? value.userId : Number.NaN
  const username = normalizeText(value.username)
  const fullName = normalizeText(value.full_name)
  const avatarUrl = normalizeText(value.avatar_url)

  if (!Number.isFinite(userId) || userId <= 0 || !username) {
    return null
  }

  return {
    userId,
    username,
    full_name: fullName,
    avatar_url: avatarUrl || undefined,
  }
}

function normalizeAppAuthMetaStorage(raw: unknown): AppAuthMetaStorage {
  if (!isRecord(raw)) {
    return { ...DEFAULT_APP_AUTH_META_STORAGE }
  }

  const device = isRecord(raw.device) ? raw.device : {}
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    device: {
      id: normalizeText(device.id),
      name: normalizeText(device.name),
    },
    rememberedUser: normalizeRememberedUser(raw.rememberedUser),
  }
}

function readAppAuthMetaStorageRaw(): AppAuthMetaStorage {
  const parsed = parseJson<unknown>(
    readLocalStorageItem(APP_AUTH_META_STORAGE_KEY),
    DEFAULT_APP_AUTH_META_STORAGE
  )
  return normalizeAppAuthMetaStorage(parsed)
}

export function getAppAuthMeta(): AppAuthMetaStorage {
  return readAppAuthMetaStorageRaw()
}

export function setAppAuthMeta(next: AppAuthMetaStorage): boolean {
  return writeLocalStorageItem(APP_AUTH_META_STORAGE_KEY, JSON.stringify(normalizeAppAuthMetaStorage(next)))
}

export function updateAppAuthMeta(updater: (current: AppAuthMetaStorage) => AppAuthMetaStorage): boolean {
  const current = getAppAuthMeta()
  const next = normalizeAppAuthMetaStorage(updater(current))
  return setAppAuthMeta(next)
}

export function getDeviceInfo(): DeviceInfo {
  const meta = getAppAuthMeta()
  return {
    id: meta.device.id,
    name: meta.device.name,
  }
}

export function ensureDeviceId(generator: () => string): string {
  const current = getAppAuthMeta()
  if (current.device.id) {
    return current.device.id
  }

  const nextId = generator().trim()
  if (!nextId) {
    return ''
  }

  updateAppAuthMeta((meta) => ({
    ...meta,
    device: {
      ...meta.device,
      id: nextId,
    },
  }))
  return nextId
}

export function ensureDeviceName(generator: () => string): string {
  const current = getAppAuthMeta()
  if (current.device.name) {
    return current.device.name
  }

  const nextName = generator().trim()
  if (!nextName) {
    return ''
  }

  updateAppAuthMeta((meta) => ({
    ...meta,
    device: {
      ...meta.device,
      name: nextName,
    },
  }))
  return nextName
}

// 存储不可用时写入当前会话级标识，维持审计链路的设备维度。
export function getDeviceId(): string {
  return ensureDeviceId(generateUUID)
}

// 设备名称只用于展示和审计，首次解析后缓存下来，避免 UA 细节变化导致名称来回跳。
export function getDeviceName(): string {
  return ensureDeviceName(() => parseDeviceName(navigator.userAgent))
}

// 先按浏览器特征命名，再按系统兜底，尽量维持历史设备名称口径不漂移。
function parseDeviceName(userAgent: string): string {
  if (userAgent.includes('Firefox')) {
    return 'Firefox Browser'
  }
  if (userAgent.includes('Edg')) {
    return 'Microsoft Edge'
  }
  if (userAgent.includes('Chrome')) {
    return 'Chrome Browser'
  }
  if (userAgent.includes('Safari')) {
    return 'Safari Browser'
  }

  if (userAgent.includes('Windows')) {
    return 'Windows PC'
  }
  if (userAgent.includes('Mac')) {
    return 'Macintosh'
  }
  if (userAgent.includes('Linux')) {
    return 'Linux PC'
  }
  if (userAgent.includes('Android')) {
    return 'Android Device'
  }
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    return 'iOS Device'
  }

  return 'Unknown Device'
}

function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return generateUUIDFromCryptoValues()
  }
  return generateFallbackUUID()
}

// 没有 `randomUUID` 时仍优先走 Web Crypto，继续保持 RFC4122 形态并避开伪随机实现。
function generateUUIDFromCryptoValues(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// 极端环境下退化为可追踪的确定性标识，保障设备标识持续可用。
function generateFallbackUUID(): string {
  fallbackIdCounter = (fallbackIdCounter + 1) % 0xffff
  const timestampHex = Date.now().toString(16).padStart(12, '0')
  const counterHex = fallbackIdCounter.toString(16).padStart(4, '0')
  const raw = `${timestampHex}${counterHex}`.padEnd(32, '0').slice(0, 32).split('')
  raw[12] = '4'
  raw[16] = ((Number.parseInt(raw[16], 16) & 0x3) | 0x8).toString(16)
  const hex = raw.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function clearDeviceInfo(): void {
  updateAppAuthMeta((meta) => ({
    ...meta,
    device: {
      id: '',
      name: '',
    },
  }))
}

export function getRememberedUser(): RememberedUser | null {
  return getAppAuthMeta().rememberedUser
}

export function setRememberedUser(rememberedUser: RememberedUser): void {
  const normalized = normalizeRememberedUser(rememberedUser)
  if (!normalized) {
    return
  }

  updateAppAuthMeta((meta) => ({
    ...meta,
    rememberedUser: normalized,
  }))
}

export function clearRememberedUser(): void {
  updateAppAuthMeta((meta) => ({
    ...meta,
    rememberedUser: null,
  }))
}
