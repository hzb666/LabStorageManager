// 化学属性查询工具 - 使用 PubChem API 获取实验属性（仅 HSDB 来源）
// API: PUG REST (获取 CID) + PUG View (获取 Color/Form, Melting Point, Boiling Point)
// 缓存: localStorage，10年有效期

// ============ 类型定义 ============

export interface ChemicalProperties {
  // 基本属性 (PUG REST)
  smiles?: string
  molecularWeight?: string
  iupacName?: string

  // 实验属性 (仅 HSDB 来源)
  colorForm?: string    // 颜色/形态 (Color/Form)
  meltingPoint?: string // 熔点 (Melting Point)
  boilingPoint?: string // 沸点 (Boiling Point)
}

interface PUGRestProperty {
  CID?: number
  SMILES?: string
  MolecularWeight?: number
  IUPACName?: string
}

interface PUGViewReference {
  ReferenceNumber?: number
  SourceName?: string
}

interface PUGViewValue {
  StringWithMarkup?: Array<{ String?: string }>
}

interface PUGViewInformation {
  ReferenceNumber?: number
  Value?: PUGViewValue
}

interface PUGViewSubsection {
  TOCHeading?: string
  Information?: PUGViewInformation[]
}

interface PUGViewSection {
  TOCHeading?: string
  Section?: PUGViewSubsection[]
}

interface PUGViewRecord {
  Reference?: PUGViewReference[]
  Section?: PUGViewSection[]
}

// ============ 缓存配置 ============

const CACHE_KEY = 'chemical_properties_hsdb_cache'
const MAX_CACHE_SIZE = 1000
const CACHE_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000 // 10年

// 内存缓存
const memoryCache = new Map<string, ChemicalProperties>()

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

// 初始化内存缓存
const storageCache = loadFromStorage()
storageCache.forEach((value, key) => memoryCache.set(key, value))

// ============ PUG View 解析函数 ============

/** 动态查找 HSDB 来源的 ReferenceNumber */
function findHSDBRefNumber(record: PUGViewRecord): number | null {
  const refs = record.Reference
  if (!refs) return null

  for (const ref of refs) {
    const name = ref.SourceName?.toLowerCase() || ''
    if (name.includes('hazardous substances data bank') || name.includes('hsdb')) {
      return ref.ReferenceNumber ?? null
    }
  }
  return null
}

// ============ 主要查询函数 ============

/**
 * 通过 CAS 号获取化合物实验属性 (仅 HSDB 来源)
 * 流程: PUG REST (获取 CID) -> PUG View (获取 Color/Form, Melting Point, Boiling Point)
 */
export async function queryCompoundData(casNumber: string): Promise<ChemicalProperties | null> {
  if (!casNumber) return null

  // 检查内存缓存
  if (memoryCache.has(casNumber)) {
    return memoryCache.get(casNumber) ?? null
  }

  try {
    // ============ 步骤1: PUG REST 获取基本属性 ============
    const restUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(casNumber)}/property/SMILES,MolecularWeight,IUPACName/JSON`
    const restRes = await fetch(restUrl, { headers: { 'Accept': 'application/json' } })
    if (!restRes.ok) throw new Error('PUG REST 请求失败')

    const restData = await restRes.json()
    const props: PUGRestProperty = restData?.PropertyTable?.Properties?.[0]
    if (!props?.CID) throw new Error('未找到化合物')

    // 基本属性
    const result: ChemicalProperties = {
      smiles: props.SMILES,
      molecularWeight: props.MolecularWeight ? String(props.MolecularWeight) : undefined,
      iupacName: props.IUPACName
    }

    // ============ 步骤2: PUG View 获取实验属性 (仅 HSDB) ============
    // 分别请求 Color/Form, Melting Point, Boiling Point
    // 每次请求只返回单个属性，数据量小
    // 在第一次请求时缓存 HSDB ReferenceNumber，后续请求复用
    let hsdbRefNumber: number | null = null

    const headings = [
      { key: 'colorForm', heading: 'Color/Form' },
      { key: 'meltingPoint', heading: 'Melting+Point' },
      { key: 'boilingPoint', heading: 'Boiling+Point' }
    ]

    for (const { key, heading } of headings) {
      try {
        const viewUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${props.CID}/JSON?heading=${heading}`
        const viewRes = await fetch(viewUrl, { headers: { 'Accept': 'application/json' } })
        if (!viewRes.ok) continue

        const viewData = await viewRes.json()
        const record = viewData?.Record

        // 首次查找 HSDB ReferenceNumber，后续请求复用
        if (!hsdbRefNumber) {
          hsdbRefNumber = findHSDBRefNumber(record)
        }

        // 使用缓存的 hsdbRefNumber 提取值
        if (hsdbRefNumber && record) {
          const info = record.Section?.[0]?.Section?.[0]?.Information
          if (info) {
            for (const item of info) {
              if (item.ReferenceNumber === hsdbRefNumber) {
                const value = item.Value?.StringWithMarkup?.[0]?.String
                if (value) {
                  if (key === 'colorForm') result.colorForm = value
                  else if (key === 'meltingPoint') result.meltingPoint = value
                  else if (key === 'boilingPoint') result.boilingPoint = value
                }
                break
              }
            }
          }
        }
      } catch {
        // 单个属性请求失败不影响其他属性
      }
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
  }
}

/** 获取 SMILES */
export async function querySmiles(casNumber: string): Promise<string | null> {
  const data = await queryCompoundData(casNumber)
  return data?.smiles ?? null
}

/** 获取颜色/形态 */
export async function queryColorForm(casNumber: string): Promise<string | null> {
  const data = await queryCompoundData(casNumber)
  return data?.colorForm ?? null
}

/** 获取熔点 */
export async function queryMeltingPoint(casNumber: string): Promise<string | null> {
  const data = await queryCompoundData(casNumber)
  return data?.meltingPoint ?? null
}

/** 获取沸点 */
export async function queryBoilingPoint(casNumber: string): Promise<string | null> {
  const data = await queryCompoundData(casNumber)
  return data?.boilingPoint ?? null
}

/** 获取所有实验属性 */
export async function queryChemicalProperties(casNumber: string): Promise<ChemicalProperties | null> {
  return queryCompoundData(casNumber)
}
