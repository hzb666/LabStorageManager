// 化学属性查询工具 - 使用 PubChem PUG REST 获取基础属性
// 缓存: localStorage，10年有效期

// ============ 类型定义 ============

export interface ChemicalProperties {
  // 基本属性 (PUG REST)
  smiles?: string
  molecularWeight?: string
  iupacName?: string
}

interface PUGRestProperty {
  SMILES?: string
  MolecularWeight?: number
  IUPACName?: string
}

// ============ 缓存配置 ============

const CACHE_KEY = 'chemical_properties_cache'
const MAX_CACHE_SIZE = 1000
const CACHE_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000 // 10年
const PUBCHEM_RATE_LIMIT = 5
const PUBCHEM_RATE_WINDOW_MS = 1000

// 内存缓存
const memoryCache = new Map<string, ChemicalProperties>()
const inFlightRequests = new Map<string, Promise<ChemicalProperties | null>>()

// PubChem 全局限流状态：1 秒最多 5 个请求
const recentPubChemRequestTimestamps: number[] = []
let rateLimitQueue: Promise<void> = Promise.resolve()

// ============ 缓存工具函数 ============

function loadFromStorage(): Map<string, ChemicalProperties> {
  try {
    const stored = localStorage.getItem(CACHE_KEY)
    if (!stored) return new Map()

    const { data, timestamp } = JSON.parse(stored)
    if (Date.now() - timestamp > CACHE_EXPIRY_MS) {
      localStorage.removeItem(CACHE_KEY)
      return new Map()
    }

    return new Map(Object.entries(data || {}))
  } catch {
    return new Map()
  }
}

function saveToStorage(cache: Map<string, ChemicalProperties>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data: Object.fromEntries(cache),
      timestamp: Date.now()
    }))
  } catch (e) {
    console.warn('保存缓存失败:', e)
  }
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
storageCache.forEach((value, key) => memoryCache.set(key, value))

// ============ 主要查询函数 ============

/**
 * 通过 CAS 号获取化合物基础属性
 * 流程: PUG REST (获取 SMILES, MolecularWeight, IUPACName)
 */
export async function queryCompoundData(casNumber: string): Promise<ChemicalProperties | null> {
  if (!casNumber) return null

  // 检查内存缓存
  if (memoryCache.has(casNumber)) {
    return memoryCache.get(casNumber) ?? null
  }

  const existingRequest = inFlightRequests.get(casNumber)
  if (existingRequest) return existingRequest

  const requestPromise = (async () => {
    try {
      // ============ 步骤1: PUG REST 获取基本属性 ============
      const restUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(casNumber)}/property/SMILES,MolecularWeight,IUPACName/JSON`
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
        molecularWeight: props.MolecularWeight ? String(props.MolecularWeight) : undefined,
        iupacName: props.IUPACName
      }

      // 保存到缓存
      if (memoryCache.size >= MAX_CACHE_SIZE) {
        const firstKey = memoryCache.keys().next().value
        if (firstKey) memoryCache.delete(firstKey)
      }
      memoryCache.set(casNumber, result)
      saveToStorage(memoryCache)

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
