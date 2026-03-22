// 化学属性查询工具 - 使用 PubChem PUG REST 获取基础属性
// 缓存: localStorage，10年有效期

import { isSpecialCasValue } from './validationSchemas'
import {
  CHEMICAL_PROPERTIES_CACHE_MAX_SIZE,
  CHEMICAL_PROPERTIES_CACHE_EXPIRY_MS,
  PUBCHEM_RATE_LIMIT,
  PUBCHEM_RATE_WINDOW_MS,
} from './constants'

// ============ 类型定义 ============

export interface ChemicalProperties {
  // 基本属性 (PUG REST)
  smiles?: string
  iupacName?: string
}

interface PUGRestProperty {
  SMILES?: string
  IUPACName?: string
}

interface CachedChemicalProperties {
  value: ChemicalProperties
  expiresAt: number
}

interface ChemicalPropertiesStorage {
  version: number
  data: Record<string, CachedChemicalProperties>
}

// ============ 缓存配置 ============

const CACHE_KEY = 'chemical_properties_cache'
const CHEMICAL_PROPERTIES_STORAGE_VERSION = 1

// 内存缓存
const memoryCache = new Map<string, CachedChemicalProperties>()
const inFlightRequests = new Map<string, Promise<ChemicalProperties | null>>()

// PubChem 全局限流状态：1 秒最多 5 个请求
const recentPubChemRequestTimestamps: number[] = []
let rateLimitQueue: Promise<void> = Promise.resolve()

// ============ 缓存工具函数 ============

function normalizeChemicalProperties(value: Record<string, unknown>): ChemicalProperties {
  return {
    smiles: typeof value.smiles === 'string' ? value.smiles : undefined,
    iupacName: typeof value.iupacName === 'string' ? value.iupacName : undefined,
  }
}

function loadFromStorage(): Map<string, CachedChemicalProperties> {
  try {
    const stored = localStorage.getItem(CACHE_KEY)
    if (!stored) return new Map()

    const parsed = JSON.parse(stored) as ChemicalPropertiesStorage
    if (
      parsed?.version !== CHEMICAL_PROPERTIES_STORAGE_VERSION ||
      !parsed?.data ||
      typeof parsed.data !== 'object'
    ) {
      localStorage.removeItem(CACHE_KEY)
      return new Map()
    }

    const now = Date.now()
    let shouldRewrite = false
    const hydrated = new Map<string, CachedChemicalProperties>()

    for (const [cas, rawEntry] of Object.entries(parsed.data)) {
      if (!rawEntry || typeof rawEntry !== 'object') {
        shouldRewrite = true
        continue
      }

      const entry = rawEntry as CachedChemicalProperties
      if (
        typeof entry.expiresAt !== 'number' ||
        !entry.value ||
        typeof entry.value !== 'object'
      ) {
        shouldRewrite = true
        continue
      }

      const normalizedValue = normalizeChemicalProperties(entry.value as Record<string, unknown>)
      if ('molecularWeight' in (entry.value as Record<string, unknown>)) {
        shouldRewrite = true
      }

      if (entry.expiresAt > now) {
        hydrated.set(cas, {
          value: normalizedValue,
          expiresAt: entry.expiresAt,
        })
      } else {
        shouldRewrite = true
      }
    }

    while (hydrated.size > CHEMICAL_PROPERTIES_CACHE_MAX_SIZE) {
      const oldest = hydrated.keys().next()
      if (oldest.done) break
      hydrated.delete(oldest.value)
      shouldRewrite = true
    }

    if (shouldRewrite) {
      saveToStorage(hydrated)
    }

    return hydrated
  } catch {
    return new Map()
  }
}

function saveToStorage(cache: Map<string, CachedChemicalProperties>): void {
  try {
    const data = Object.fromEntries(cache)
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CHEMICAL_PROPERTIES_STORAGE_VERSION,
      data,
    }))
  } catch (e) {
    console.warn('保存缓存失败:', e)
  }
}

function getCachedProperties(casNumber: string): ChemicalProperties | null {
  const cached = memoryCache.get(casNumber)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    memoryCache.delete(casNumber)
    saveToStorage(memoryCache)
    return null
  }

  memoryCache.delete(casNumber)
  memoryCache.set(casNumber, cached)
  return cached.value
}

function setCachedProperties(casNumber: string, data: ChemicalProperties): void {
  const normalizedData = normalizeChemicalProperties(data as Record<string, unknown>)

  if (memoryCache.has(casNumber)) {
    memoryCache.delete(casNumber)
  }

  while (memoryCache.size >= CHEMICAL_PROPERTIES_CACHE_MAX_SIZE) {
    const oldest = memoryCache.keys().next()
    if (oldest.done) break
    memoryCache.delete(oldest.value)
  }

  memoryCache.set(casNumber, {
    value: normalizedData,
    expiresAt: Date.now() + CHEMICAL_PROPERTIES_CACHE_EXPIRY_MS,
  })
  saveToStorage(memoryCache)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquirePubChemSlot(): Promise<void> {
  while (true) {
    const now = Date.now()

    while (
      recentPubChemRequestTimestamps.length > 0 &&
      now - recentPubChemRequestTimestamps[0] >= PUBCHEM_RATE_WINDOW_MS
    ) {
      recentPubChemRequestTimestamps.shift()
    }

    if (recentPubChemRequestTimestamps.length < PUBCHEM_RATE_LIMIT) {
      recentPubChemRequestTimestamps.push(now)
      return
    }

    const oldest = recentPubChemRequestTimestamps[0]
    const waitMs = PUBCHEM_RATE_WINDOW_MS - (now - oldest) + 1
    await sleep(waitMs)
  }
}

async function withPubChemRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const slotReady = rateLimitQueue.then(async () => {
    await acquirePubChemSlot()
  })

  rateLimitQueue = slotReady.then(
    () => undefined,
    () => undefined
  )

  await slotReady
  return task()
}

// 初始化内存缓存
const storageCache = loadFromStorage()
storageCache.forEach((entry, key) => memoryCache.set(key, entry))

// ============ 主要查询函数 ============

/**
 * 通过 CAS 号获取化合物基础属性
 * 流程: PUG REST (获取 SMILES, IUPACName)
 */
export async function queryCompoundData(casNumber: string): Promise<ChemicalProperties | null> {
  if (!casNumber) return null
  if (isSpecialCasValue(casNumber)) return null

  // 检查内存缓存
  const cached = getCachedProperties(casNumber)
  if (cached) {
    return cached
  }

  const existingRequest = inFlightRequests.get(casNumber)
  if (existingRequest) return existingRequest

  const requestPromise = (async () => {
    try {
      // ============ 步骤1: PUG REST 获取基本属性 ============
      const restUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(casNumber)}/property/SMILES,IUPACName/JSON`
      const restRes = await withPubChemRateLimit(() =>
        fetch(restUrl, { headers: { Accept: 'application/json' } })
      )
      if (!restRes.ok) throw new Error('PUG REST 请求失败')

      const restData = await restRes.json()
      const props: PUGRestProperty = restData?.PropertyTable?.Properties?.[0]
      if (!props) throw new Error('未找到化合物')

      // 基本属性
      const result: ChemicalProperties = {
        smiles: props.SMILES,
        iupacName: props.IUPACName,
      }

      if (result.smiles) {
        setCachedProperties(casNumber, result)
      }

      return result
    } catch (err) {
      console.error('查询化合物属性失败:', err)
      return null
    } finally {
      inFlightRequests.delete(casNumber)
    }
  })()

  inFlightRequests.set(casNumber, requestPromise)
  return requestPromise
}

/** 获取 SMILES */
export async function querySmiles(casNumber: string): Promise<string | null> {
  const data = await queryCompoundData(casNumber)
  return data?.smiles ?? null
}

/** 获取所有基础属性 */
export async function queryChemicalProperties(casNumber: string): Promise<ChemicalProperties | null> {
  return queryCompoundData(casNumber)
}
