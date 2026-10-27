import axios, { AxiosError, AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { toast } from '@/lib/toast'
import { isApiTimeoutError } from '@/lib/validationSchemas'

type StoredResponse = { status_code: number; body: string; headers: Record<string, string> }
type Receipt = { id: string; fingerprint: string; scope: number; started: number; result?: StoredResponse }
type OperationResult = {
  state: 'missing' | 'running' | 'committed' | 'succeeded' | 'failed' | 'uncertain'
  response?: StoredResponse
}
// null 表示本次核实必须停止；undefined 表示暂未拿到结果，可在预算内继续查询。
type StatusResult = OperationResult | null | undefined

declare module 'axios' {
  interface AxiosRequestConfig {
    mutationReceipt?: Receipt
    mutationDeadline?: number
  }
}

const BUSINESS_PREFIX = /^\/(inventory|reagent-orders|consumable-orders|common-shelf|chemical-name-map|reagent-brands|announcements)(\/|$)/
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])
const RESULT_PENDING_MESSAGE = '获取提交结果超时，请刷新查看'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function supportsRecovery(config: InternalAxiosRequestConfig): boolean {
  const path = config.url ?? ''
  if (!WRITE_METHODS.has(config.method ?? '') || path.startsWith('http')) return false
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) return false
  if (BUSINESS_PREFIX.test(path)) {
    return !/\/(export|import\/preview|upload-image|images)(\/|$)/.test(path)
  }
  if (/^\/users(\/|$)/.test(path)) return !/\/(login|logout|avatar|sessions\/refresh)(\/|$)/.test(path)
  return /^\/chem\/structures\/cache\/[^/]+\/manual$/.test(path)
}

// 同一份 JSON 即使键顺序不同，也属于同一提交；请求正文只在内存中比较。
function stableJson(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    return '{' + entries.join(',') + '}'
  }
  return JSON.stringify(value)
}

function requestIdentity(config: InternalAxiosRequestConfig, scope: number) {
  return `${scope}:${config.method}:${config.url?.replace(/\/$/, '')}`
}

function newOperationId() {
  const nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${Date.now().toString(16).padStart(12, '0')}_${nonce}`
}

function operationErrorCode(error: AxiosError) {
  const headers = error.response?.headers
  return headers instanceof AxiosHeaders ? headers.get('X-Error-Code')
    : headers?.['x-error-code'] ?? headers?.['X-Error-Code']
}

function needsConfirmation(error: AxiosError): boolean {
  const status = error.response?.status
  return !error.response || isApiTimeoutError(error) || status === 408 || (status !== undefined && status >= 500)
    || operationErrorCode(error) === 'OPERATION_PENDING'
}

function assertReceiptFresh(receipt: Receipt | undefined, config: InternalAxiosRequestConfig) {
  if (receipt && Date.now() - receipt.started >= RETENTION_MS) {
    throw new AxiosError('原提交已超过结果核实期限，请先检查业务记录，避免重复提交', 'OPERATION_UNRESOLVED', config)
  }
}

class PendingResultError extends AxiosError {
  constructor(config: InternalAxiosRequestConfig) {
    super(RESULT_PENDING_MESSAGE, 'ECONNABORTED', config)
  }
}

/** 同一次提交的请求、查询和重试共用截止时间，避免每个步骤重新等待 3 秒。 */
async function withinDeadline<T>(work: Promise<T>, deadline: number, config: InternalAxiosRequestConfig): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PendingResultError(config)), Math.max(0, deadline - Date.now()))
    })])
  } finally { clearTimeout(timer) }
}

function storedResponse(result: StoredResponse, config: InternalAxiosRequestConfig): AxiosResponse {
  return { config, status: result.status_code, statusText: '', headers: AxiosHeaders.from(result.headers),
    data: result.body ? JSON.parse(result.body) : '' }
}

function validateResponse(response: AxiosResponse): AxiosResponse {
  if (response.status >= 400) {
    throw new AxiosError('请求未完成', AxiosError.ERR_BAD_RESPONSE, response.config, undefined, response)
  }
  return response
}

type RecoveryOptions = {
  getUserId: () => number | null
  foregroundMs?: number
  wait?: (milliseconds: number) => Promise<void>
}

function completedResult(response: StoredResponse): OperationResult {
  return { state: response.status_code < 400 ? 'succeeded' : 'failed', response }
}

function operationKey(config: InternalAxiosRequestConfig): string {
  const receipt = config.mutationReceipt!
  return `${receipt.scope}:${receipt.id}`
}

function createStatusReader(client: AxiosInstance, options: RecoveryOptions) {
  const requests = new Map<string, Promise<StatusResult>>()
  const sameUser = (config: InternalAxiosRequestConfig) => options.getUserId() === config.mutationReceipt?.scope

  const fetchStatus = async (config: InternalAxiosRequestConfig): Promise<StatusResult> => {
    try {
      const response = await withinDeadline(client.get<OperationResult>(`/mutation-operations/${config.mutationReceipt!.id}`, {
        timeout: 1000,
        headers: { 'X-Skip-Auth-Invalidation': '1' },
      }), Date.now() + 1000, config)
      return sameUser(config) ? response.data : null
    } catch (error) {
      if (axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0)) return null
      return undefined
    }
  }

  const read = async (config: InternalAxiosRequestConfig, deadline: number): Promise<StatusResult> => {
    if (!sameUser(config) || Date.now() >= deadline) return null
    if (config.mutationReceipt!.result) return completedResult(config.mutationReceipt!.result)
    const key = operationKey(config)
    let request = requests.get(key)
    if (!request) {
      request = fetchStatus(config).finally(() => { requests.delete(key) })
      requests.set(key, request)
    }
    try {
      const result = await withinDeadline(request, deadline, config)
      return sameUser(config) ? result : null
    } catch { return undefined }
  }
  return { read, sameUser }
}

function createReconciler(client: AxiosInstance, options: RecoveryOptions, cache: (config: InternalAxiosRequestConfig, result: StoredResponse) => boolean, isCurrent: (config: InternalAxiosRequestConfig) => boolean) {
  const checks = new Set<string>()
  const foreground = new Set<InternalAxiosRequestConfig>()
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const { read, sameUser } = createStatusReader(client, options)

  const notifyResult = (config: InternalAxiosRequestConfig, result: StoredResponse) => {
    const isConfirming = [...foreground].some(request => operationKey(request) === operationKey(config))
    if (cache(config, result) && !isConfirming) {
      toast[result.status_code < 400 ? 'success' : 'error'](result.status_code < 400
        ? '已确认上次提交成功，再次点击提交可完成确认或后续步骤'
        : '已确认上次提交未成功，请检查表单后重试')
    }
  }

  const confirm = async (config: InternalAxiosRequestConfig, waitForCompletion: boolean): Promise<StatusResult> => {
    const receipt = config.mutationReceipt!
    const deadline = config.mutationDeadline!
    foreground.add(config)
    try {
      while (sameUser(config) && Date.now() < deadline) {
        const result = await read(config, deadline)
        // 后台可能在本次查询期间先拿到最终结果，旧状态不能覆盖已确认的响应。
        if (receipt.result) return completedResult(receipt.result)
        if (result === null || result?.response || result?.state === 'missing' || !waitForCompletion) return result
        const remaining = deadline - Date.now()
        if (remaining > 0) await wait(Math.min(250, remaining))
      }
      return receipt.result ? completedResult(receipt.result) : undefined
    } finally { foreground.delete(config) }
  }

  const background = (config: InternalAxiosRequestConfig) => {
    const id = operationKey(config)
    if (checks.has(id) || !isCurrent(config)) return
    const check = async () => {
      const started = Date.now()
      // 按本轮开始时间调度，慢查询不会把下一次等待继续累加。
      for (const offset of [0, 1000, 3000]) {
        await wait(Math.max(0, started + offset - Date.now()))
        if (!isCurrent(config)) return
        const result = await read(config, Math.min(started + 4000, Date.now() + 1000))
        if (result === null) return
        if (result?.response) {
          notifyResult(config, result.response)
          return
        }
      }
    }
    checks.add(id)
    check().catch(() => undefined).finally(() => { checks.delete(id) })
  }
  return { read, confirm, background }
}

/** 前台最多等待 3 秒；超时释放提交状态，后台查询到的原响应留给用户再次确认。 */
export function installMutationRecovery(client: AxiosInstance, options: RecoveryOptions) {
  const receipts = new Map<string, Receipt>()
  const currentReceipt = (config: InternalAxiosRequestConfig) => receipts.get(requestIdentity(config, config.mutationReceipt!.scope))
  const isCurrent = (config: InternalAxiosRequestConfig) => {
    const receipt = currentReceipt(config)
    return options.getUserId() === receipt?.scope && receipt?.id === config.mutationReceipt?.id
  }
  const cache = (config: InternalAxiosRequestConfig, result: StoredResponse) => {
    if (!isCurrent(config)) return false
    currentReceipt(config)!.result = result
    return true
  }
  const reconciler = createReconciler(client, options, cache, isCurrent)
  const assertScope = (config: InternalAxiosRequestConfig) => {
    if (options.getUserId() !== config.mutationReceipt?.scope) throw new axios.CanceledError('账号已切换', config)
  }
  const forget = (config: InternalAxiosRequestConfig) => {
    if (currentReceipt(config)?.id === config.mutationReceipt?.id) receipts.delete(requestIdentity(config, config.mutationReceipt!.scope))
  }
  const replay = (config: InternalAxiosRequestConfig, result: StoredResponse) => {
    config.adapter = async request => validateResponse(storedResponse(result, request))
  }

  const resume = async (config: InternalAxiosRequestConfig, fingerprint: string) => {
    const receipt = config.mutationReceipt!
    const result = await reconciler.confirm(config, receipt.fingerprint === fingerprint)
    assertScope(config)
    const response = result?.response
    if (response) cache(config, response)
    if (receipt.fingerprint === fingerprint) {
      if (response) return replay(config, response)
      if (result?.state === 'missing') return
      throw new PendingResultError(config)
    }
    if (response && response.status_code >= 400) { forget(config); return }
    if (response) forget(config)
    else reconciler.background(config)
    throw new AxiosError(response
      ? '上次提交已成功，本次内容尚未提交，请确认后再次操作'
      : '上次提交结果尚未确认，请保持原内容核实结果后再进行新的操作', 'OPERATION_UNRESOLVED', config)
  }

  client.interceptors.request.use(async config => {
    const scope = options.getUserId()
    if (scope === null || !supportsRecovery(config)) return config
    config.mutationDeadline = Date.now() + (options.foregroundMs ?? 3000)
    const identity = requestIdentity(config, scope)
    const data: unknown = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    const fingerprint = stableJson({ params: config.params, data })
    const existing = receipts.get(identity)
    assertReceiptFresh(existing, config)
    if (existing) { config.mutationReceipt = existing; await resume(config, fingerprint) }
    const receipt = receipts.get(identity) ?? { id: newOperationId(), fingerprint, scope, started: Date.now() }
    receipts.set(identity, receipt)
    config.mutationReceipt = receipt
    config.headers.set('Idempotency-Key', receipt.id)
    config.timeout = Math.min(config.timeout || 3000, Math.max(1, config.mutationDeadline - Date.now()))
    const adapter = axios.getAdapter(config.adapter)
    config.adapter = request => withinDeadline(adapter(request), config.mutationDeadline!, request)
    return config
  })

  client.interceptors.response.use(response => {
    if (response.config.mutationReceipt) { assertScope(response.config); forget(response.config) }
    return response
  }, async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config?.mutationReceipt) throw error
    const config = error.config
    if (error.code === 'OPERATION_UNRESOLVED' || operationErrorCode(error) === 'OPERATION_EXPIRED') throw error
    if (!needsConfirmation(error)) { forget(config); throw error }
    if (axios.isCancel(error)) throw error
    const result = error instanceof PendingResultError ? undefined : await reconciler.read(config, config.mutationDeadline!)
    assertScope(config)
    if (result?.response) {
      const response = storedResponse(result.response, config)
      forget(config)
      return validateResponse(response)
    }
    reconciler.background(config)
    throw new PendingResultError(config)
  })
}
