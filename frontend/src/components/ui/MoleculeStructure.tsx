import { useState, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { 
  useFloating, 
  autoUpdate, 
  offset, 
  shift, 
  flip, 
  size, 
  useHover, 
  useInteractions, 
  useTransitionStyles
} from '@floating-ui/react'

type RDKitModule = {
  get_mol: (smiles: string) => Mol
  version: string
}

// RDKit 模块类型定义扩展
declare global {
  var RDKit: RDKitModule | undefined
  var initRDKitModule: (() => Promise<RDKitModule>) | undefined
}

interface Mol {
  get_svg_with_highlights: (details: string) => string
  is_valid: () => boolean
  delete?: () => void
}

interface MoleculeStructureProps {
  casNumber: string
  width?: number
  height?: number
  isDark?: boolean 
}

type LoadingState = 'idle' | 'loading' | 'ready' | 'error'

let rdkitLoaderPromise: Promise<RDKitModule> | null = null

// SVG缓存：内存Map（刷新丢失）
const SVG_MAX_CACHE_SIZE = 100
const svgCache = new Map<string, { svg: string; zoomSvg: string; naturalSize: { w: number; h: number } }>()

// SMILES缓存：localStorage持久化，格式 {cas: smiles}
const SMILES_STORAGE_KEY = 'molecule_smiles_cache'
const SMILES_MAX_CACHE_SIZE = 1000
const SMILES_EXPIRY_HOURS = 24 * 365 * 10 // 10年

// 辅助函数：从localStorage获取SMILES缓存
function getSmilesFromStorage(): Record<string, string> {
  try {
    const stored = localStorage.getItem(SMILES_STORAGE_KEY)
    if (!stored) return {}
    const data = JSON.parse(stored) as { data: Record<string, string>; timestamp: number }
    if (Date.now() - data.timestamp > SMILES_EXPIRY_HOURS * 60 * 60 * 1000) {
      localStorage.removeItem(SMILES_STORAGE_KEY)
      return {}
    }
    return data.data || {}
  } catch {
    return {}
  }
}

// 辅助函数：保存SMILES到localStorage
function saveSmilesToStorage(data: Record<string, string>) {
  try {
    localStorage.setItem(SMILES_STORAGE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }))
  } catch (e) {
    console.warn('localStorage存储失败:', e)
  }
}

// 初始化SMILES缓存（从localStorage加载）
const smilesCache = new Map<string, string>(Object.entries(getSmilesFromStorage()))

// 全局并发队列与请求去重
const MAX_CONCURRENT_REQUESTS = 3
let activeRequests = 0
const requestQueue: (() => void)[] = []
const pendingRequests = new Map<string, Promise<string | null>>()

const enqueueRequest = <T,>(task: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      activeRequests++
      try {
        await new Promise(res => setTimeout(res, 200)) 
        resolve(await task())
      } catch (error) {
        reject(error)
      } finally {
        activeRequests--
        if (requestQueue.length > 0) {
          const nextTask = requestQueue.shift()
          if (nextTask) nextTask()
        }
      }
    }

    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      execute()
    } else {
      requestQueue.push(execute)
    }
  })
}

// 提取工具函数以降低 Cognitive Complexity
const processSvgId = (str: string, id: string) => 
  str.replaceAll(/id=['"](.+?)['"]/g, `id="${id}_$1"`)
     .replaceAll(/url\(#(.+?)\)/g, `url(#${id}_$1)`)

const extractNaturalSize = (svgString: string) => {
  const widthMatch = new RegExp(/width='([\d.]+)px'/).exec(svgString)
  const heightMatch = new RegExp(/height='([\d.]+)px'/).exec(svgString)
  return {
    w: widthMatch ? Number.parseFloat(widthMatch[1]) : 0,
    h: heightMatch ? Number.parseFloat(heightMatch[1]) : 0
  }
}

const loadRDKitScript = async (): Promise<void> => {
  if (document.querySelector('#rdkit-script')) return
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = 'rdkit-script'
    script.src = '/lib/RDKit_minimal.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('RDKit 脚本加载失败'))
    document.head.appendChild(script)
  })
}

const initRDKit = async (): Promise<RDKitModule> => {
  await loadRDKitScript()

  let retries = 0
  while (!globalThis.initRDKitModule && retries < 50) {
    await new Promise(r => setTimeout(r, 100))
    retries++
  }

  if (!globalThis.initRDKitModule) throw new Error('RDKit 模块未初始化')

  const RDKit = await globalThis.initRDKitModule()
  globalThis.RDKit = RDKit
  return RDKit
}

export function MoleculeStructure({ 
  casNumber, 
  width = 300, 
  height = 200, 
  isDark 
}: Readonly<MoleculeStructureProps>) {
  const [svg, setSvg] = useState<string>('')
  const [zoomSvg, setZoomSvg] = useState<string>('')
  const [smiles, setSmiles] = useState<string>('')
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [error, setError] = useState<string>('')
  
  const [canZoom, setCanZoom] = useState(false)
  const componentId = useId().replaceAll(':', '') 

  const [isOpen, setIsOpen] = useState(false)
  
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen && canZoom,
    onOpenChange: setIsOpen,
    placement: 'bottom-start', 
    strategy: 'fixed', 
    middleware: [
      offset(({ rects }) => ({
        mainAxis: -rects.reference.height,
        crossAxis: 0,
      })),
      flip({ 
        padding: 16,
        fallbackPlacements: ['top-start'], 
      }),
      shift({ 
        padding: 16,
        mainAxis: false, 
        crossAxis: true, 
      }),
      size({
        padding: 16,
        apply({ availableWidth, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${availableWidth}px`, 
            maxHeight: `calc(100vh - 32px)`,
          })
        },
      })
    ],
    whileElementsMounted: autoUpdate, 
  })

  const hover = useHover(context, {
    delay: { open: 50, close: 0 },
    enabled: canZoom
  })

  const { getReferenceProps, getFloatingProps } = useInteractions([hover])

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 200,
    initial: { transform: 'scale(0.9)', opacity: 0 },
    open: { transform: 'scale(1)', opacity: 1 },
    close: { transform: 'scale(0.9)', opacity: 0 },
  })

  const loadRDKit = useCallback(() => {
    if (globalThis.RDKit) return Promise.resolve(globalThis.RDKit)
    if (rdkitLoaderPromise) return rdkitLoaderPromise

    rdkitLoaderPromise = initRDKit().catch(err => {
      rdkitLoaderPromise = null 
      throw err
    })

    return rdkitLoaderPromise
  }, [])

  const fetchSmiles = useCallback(async (cas: string): Promise<string | null> => {
    if (smilesCache.has(cas)) {
      const cachedSmiles = smilesCache.get(cas)!
      smilesCache.delete(cas)
      smilesCache.set(cas, cachedSmiles)
      saveSmilesToStorage(Object.fromEntries(smilesCache))
      return cachedSmiles
    }

    if (pendingRequests.has(cas)) {
      return pendingRequests.get(cas)!
    }

    const fetchTask = enqueueRequest(async () => {
      try {
        const response = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/property/SMILES/JSON`,
          { headers: { 'Accept': 'application/json' } }
        )
        if (!response.ok) throw new Error('Compound not found')
        
        const data = await response.json()
        const fetchedSmiles = data?.PropertyTable?.Properties?.[0]?.SMILES || null
        
        if (fetchedSmiles) {
          if (smilesCache.size >= SMILES_MAX_CACHE_SIZE) {
            const firstKey = smilesCache.keys().next().value
            if (firstKey) smilesCache.delete(firstKey)
          }
          smilesCache.set(cas, fetchedSmiles)
          saveSmilesToStorage(Object.fromEntries(smilesCache))
        }
        return fetchedSmiles
      } catch (err) {
        console.error('获取 SMILES 失败:', err)
        return null
      }
    })

    pendingRequests.set(cas, fetchTask)
    
    try {
      return await fetchTask
    } finally {
      pendingRequests.delete(cas)
    }
  }, [])

  useEffect(() => {
    if (!casNumber) return
    const initFetch = async () => {
      setLoadingState('loading')
      const fetchedSmiles = await fetchSmiles(casNumber)
      if (!fetchedSmiles) {
        setError('未找到对应的化合物')
        setLoadingState('error')
        return
      }
      setSmiles(fetchedSmiles)
    }
    initFetch()
  }, [casNumber, fetchSmiles])

  useEffect(() => {
    if (!smiles) return

    let isActive = true
    const cacheKey = `${smiles}_${width}_${height}`

    const renderMolecule = async () => {
      if (svgCache.has(cacheKey)) {
        const cached = svgCache.get(cacheKey)!
        svgCache.delete(cacheKey)
        svgCache.set(cacheKey, cached)

        setSvg(processSvgId(cached.svg, componentId))
        setZoomSvg(processSvgId(cached.zoomSvg, componentId))
        setCanZoom(cached.naturalSize.w > width || cached.naturalSize.h > height)
        setLoadingState('ready')
        return
      }

      try {
        const RDKit = await loadRDKit()
        const delay = smiles.length > 45 ? 250 : smiles.length > 20 ? 180 : 100
        
        await new Promise(resolve => setTimeout(resolve, delay))
        if (!isActive) return 

        let mol: Mol | undefined
        try {
          mol = RDKit.get_mol(smiles)
          if (!mol?.is_valid()) throw new Error('无效的分子结构')

          const renderOptions = { width, height, bondLineWidth: 1.5, addStereoAnnotation: true }
          const rawSvgString = mol.get_svg_with_highlights(JSON.stringify(renderOptions))

          const zoomOptions = { width: -1, height: -1, bondLineWidth: 1.5, addStereoAnnotation: true }
          const rawZoomSvgString = mol.get_svg_with_highlights(JSON.stringify(zoomOptions))
          
          const sizeInfo = extractNaturalSize(rawZoomSvgString)

          const calcResult = { 
            svg: rawSvgString, 
            zoomSvg: rawZoomSvgString, 
            naturalSize: sizeInfo 
          }
          
          if (svgCache.size >= SVG_MAX_CACHE_SIZE) {
            const firstKey = svgCache.keys().next().value
            if (firstKey) svgCache.delete(firstKey)
          }
          svgCache.set(cacheKey, calcResult)

          if (isActive) {
            setSvg(processSvgId(calcResult.svg, componentId))
            setZoomSvg(processSvgId(calcResult.zoomSvg, componentId))
            setCanZoom(sizeInfo.w > width || sizeInfo.h > height)
            setLoadingState('ready')
          }
        } finally {
          mol?.delete?.()
        }
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : '结构式渲染失败')
          setLoadingState('error')
        }
      }
    }

    renderMolecule()

    return () => { isActive = false }
  }, [smiles, width, height, loadRDKit, componentId])

  let filterClass = 'dark:[filter:invert(0.93)_hue-rotate(180deg)]'
  if (isDark === true) filterClass = '[filter:invert(0.93)_hue-rotate(180deg)]'
  if (isDark === false) filterClass = ''

  if (!casNumber) return null

  if (loadingState === 'loading') {
    return (
      <div className={`flex items-center justify-center rounded-md bg-white dark:bg-[#121212] ${isDark === true ? 'bg-[#121212]' : ''}`} style={{ width, height }}>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  if (error || loadingState === 'error') {
    return (
      <div className={`flex items-center justify-center rounded-md bg-white dark:bg-[#121212] ${isDark === true ? 'bg-[#121212]' : ''}`} style={{ width, height }}>
        <span className="text-gray-500 text-sm">{error}</span>
      </div>
    )
  }

  if (!svg) return null

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`flex items-center justify-center p-2 rounded-md overflow-hidden bg-white transition-none ${filterClass} ${canZoom ? 'cursor-zoom-in' : ''}`}
        style={{ width, height }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {isMounted && canZoom && createPortal(
        <div 
          ref={refs.setFloating}
          {...getFloatingProps()}
          className="pointer-events-none z-9999"
          style={{
            ...floatingStyles, 
            width: 'max-content', 
            height: 'max-content',
            willChange: 'transform' 
          }}
        >
          <div
            className={`
              flex items-center justify-center p-4 rounded-xl 
              bg-white dark:bg-[#121212] 
              border border-black/5 dark:border-white/10 
              shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.6)]
              ${isDark === true ? 'bg-[#121212]! border-white/10! shadow-[0_10px_40px_rgba(0,0,0,0.6)]!' : ''}
              ${isDark === false ? 'bg-white! border-black/5! shadow-[0_8px_30px_rgb(0,0,0,0.08)]!' : ''}
            `}
            style={{
              ...transitionStyles,
              transformOrigin: 'top left', 
              minWidth: width, 
              minHeight: height,
              maxWidth: '100%',  
              maxHeight: '100%', 
              overflow: 'hidden',
              willChange: 'transform, opacity'
            }}
          >
            <div 
              className={`
                w-full h-full flex items-center justify-center 
                [&>svg]:max-w-full! [&>svg]:h-auto! 
                ${filterClass}
              `}
              dangerouslySetInnerHTML={{ __html: zoomSvg }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default MoleculeStructure