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

// RDKit 模块类型定义扩展
declare global {
  interface Window {
    RDKit?: {
      get_mol: (smiles: string) => Mol
      version: string
    }
    initRDKitModule: () => Promise<{
      get_mol: (smiles: string) => Mol
      version: string
    }>
  }
}

interface Mol {
  get_svg_with_highlights: (details: string) => string
  is_valid: () => boolean
  delete: () => void
}

interface MoleculeStructureProps {
  casNumber: string
  width?: number
  height?: number
  isDark?: boolean 
}

type LoadingState = 'idle' | 'loading' | 'ready' | 'error'

let rdkitLoaderPromise: Promise<any> | null = null

// 全局缓存（内存级）及大小限制
const MAX_CACHE_SIZE = 100
const svgCache = new Map<string, { svg: string; zoomSvg: string; naturalSize: { w: number; h: number } }>()
const smilesCache = new Map<string, string>()

// --- 新增：全局并发队列与请求去重 ---
const MAX_CONCURRENT_REQUESTS = 3; // PubChem 建议控制在 3-5 个并发以内
let activeRequests = 0;
const requestQueue: (() => void)[] = [];
const pendingRequests = new Map<string, Promise<string | null>>();

// 简易并发控制器
const enqueueRequest = <T,>(task: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      activeRequests++;
      try {
        // 可选：增加 200ms 的硬性延迟，进一步保护 PubChem API 防御 503
        await new Promise(res => setTimeout(res, 200)); 
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeRequests--;
        if (requestQueue.length > 0) {
          const nextTask = requestQueue.shift();
          if (nextTask) nextTask();
        }
      }
    };

    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      execute();
    } else {
      requestQueue.push(execute);
    }
  });
};
// ------------------------------------

export function MoleculeStructure({ 
  casNumber, 
  width = 300, 
  height = 200, 
  isDark 
}: MoleculeStructureProps) {
  const [svg, setSvg] = useState<string>('')
  const [zoomSvg, setZoomSvg] = useState<string>('')
  const [smiles, setSmiles] = useState<string>('')
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [error, setError] = useState<string>('')
  
  const [canZoom, setCanZoom] = useState(false)
  const componentId = useId().replace(/:/g, '') 

  // --- Floating UI 配置 ---
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
      // 1. 限制 flip：只允许在上下方向翻转，绝对不尝试其他方向，确保 left 永远贴合
      flip({ 
        padding: 16,
        fallbackPlacements: ['top-start'], 
      }),
      // 2. 控制 shift：关闭水平平移，允许垂直平移
      shift({ 
        padding: 16,
        mainAxis: false, // <- 核心修复 1：禁止在水平方向滑动，死死锁住左侧对齐线
        crossAxis: true, // 允许在垂直方向滑动（上下装不下时可以盖住原图）
      }),
      // 3. 计算 size：动态挤压宽度
      size({
        padding: 16,
        apply({ availableWidth, elements }) {
          Object.assign(elements.floating.style, {
            // <- 核心修复 2：availableWidth 会自动计算出“从左侧对齐线到屏幕右边缘”的剩余可用宽度
            // 配合之前写的 [&>svg]:!max-w-full，弹窗一旦碰到屏幕右侧，就不会左移，而是乖乖让内容等比缩小
            maxWidth: `${availableWidth}px`, 
            maxHeight: `calc(100vh - 32px)`,
          });
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
  // -----------------------

  const loadRDKit = useCallback(() => {
    if (window.RDKit) return Promise.resolve(window.RDKit)
    if (rdkitLoaderPromise) return rdkitLoaderPromise

    rdkitLoaderPromise = new Promise(async (resolve, reject) => {
      try {
        if (!document.querySelector('#rdkit-script')) {
          const script = document.createElement('script')
          script.id = 'rdkit-script'
          script.src = '/lib/RDKit_minimal.js'
          script.async = true
          document.head.appendChild(script)

          await new Promise<void>((res, rej) => {
            script.onload = () => res()
            script.onerror = () => rej(new Error('RDKit 脚本加载失败'))
          })
        }

        let retries = 0
        while (!window.initRDKitModule && retries < 50) {
          await new Promise(r => setTimeout(r, 100))
          retries++
        }

        if (!window.initRDKitModule) throw new Error('RDKit 模块未初始化')

        const RDKit = await window.initRDKitModule()
        window.RDKit = RDKit
        resolve(RDKit)
      } catch (err) {
        rdkitLoaderPromise = null 
        reject(err)
      }
    })

    return rdkitLoaderPromise
  }, [])

  const fetchSmiles = useCallback(async (cas: string): Promise<string | null> => {
    // 1. LRU 缓存拦截
    if (smilesCache.has(cas)) {
      const cachedSmiles = smilesCache.get(cas)!
      smilesCache.delete(cas)
      smilesCache.set(cas, cachedSmiles)
      return cachedSmiles
    }

    // 2. 请求去重：如果该 CAS 正在请求中，直接返回同一个 Promise，不重复发请求
    if (pendingRequests.has(cas)) {
      return pendingRequests.get(cas)!;
    }

    // 3. 包装核心请求逻辑进入并发队列
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
          if (smilesCache.size >= MAX_CACHE_SIZE) {
            const firstKey = smilesCache.keys().next().value
            if (firstKey) smilesCache.delete(firstKey)
          }
          smilesCache.set(cas, fetchedSmiles)
        }
        return fetchedSmiles
      } catch (err) {
        console.error('获取 SMILES 失败:', err)
        return null
      }
    });

    // 4. 将本次 Promise 存入 pending 字典，并在结束后清理
    pendingRequests.set(cas, fetchTask);
    
    try {
      return await fetchTask;
    } finally {
      pendingRequests.delete(cas);
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
        
        // LRU 逻辑：命中后先删后加，保持活跃状态在队尾
        svgCache.delete(cacheKey)
        svgCache.set(cacheKey, cached)

        const processSvgId = (str: string) => 
          str.replace(/id=['"](.+?)['"]/g, `id="${componentId}_$1"`)
             .replace(/url\(#(.+?)\)/g, `url(#${componentId}_$1)`)

        setSvg(processSvgId(cached.svg))
        setZoomSvg(processSvgId(cached.zoomSvg))
        setCanZoom(cached.naturalSize.w > width || cached.naturalSize.h > height)
        setLoadingState('ready')
        return
      }

      try {
        const RDKit = await loadRDKit()

        let delay = 100
        if (smiles.length > 45) {
          delay = 250 
        } else if (smiles.length > 20) {
          delay = 180
        }
        
        await new Promise(resolve => setTimeout(resolve, delay))
        if (!isActive) return 

        let mol: Mol | undefined
        try {
          mol = RDKit.get_mol(smiles)
          if (!mol || !mol.is_valid()) throw new Error('无效的分子结构')

          const renderOptions = { width, height, bondLineWidth: 1.5, addStereoAnnotation: true }
          const rawSvgString = mol.get_svg_with_highlights(JSON.stringify(renderOptions))

          const zoomOptions = { width: -1, height: -1, bondLineWidth: 1.5, addStereoAnnotation: true }
          const rawZoomSvgString = mol.get_svg_with_highlights(JSON.stringify(zoomOptions))
          
          const widthMatch = rawZoomSvgString.match(/width='([\d.]+)px'/)
          const heightMatch = rawZoomSvgString.match(/height='([\d.]+)px'/)
          const natWidth = widthMatch ? parseFloat(widthMatch[1]) : 0
          const natHeight = heightMatch ? parseFloat(heightMatch[1]) : 0

          const calcResult = { 
            svg: rawSvgString, 
            zoomSvg: rawZoomSvgString, 
            naturalSize: { w: natWidth, h: natHeight } 
          }
          
          // 容量控制：超出 MAX_CACHE_SIZE 后删除第一个（最老未使用的）元素
          if (svgCache.size >= MAX_CACHE_SIZE) {
            const firstKey = svgCache.keys().next().value
            if (firstKey) svgCache.delete(firstKey)
          }
          svgCache.set(cacheKey, calcResult)

          if (isActive) {
            const processSvgId = (str: string) => 
              str.replace(/id=['"](.+?)['"]/g, `id="${componentId}_$1"`)
                 .replace(/url\(#(.+?)\)/g, `url(#${componentId}_$1)`)

            setSvg(processSvgId(calcResult.svg))
            setZoomSvg(processSvgId(calcResult.zoomSvg))
            setCanZoom(natWidth > width || natHeight > height)
            setLoadingState('ready')
          }
        } finally {
          if (mol && typeof mol.delete === 'function') {
            mol.delete()
          }
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
          className="pointer-events-none z-[9999]"
          style={{
            ...floatingStyles, 
            width: 'max-content', 
            height: 'max-content',
            willChange: 'transform' 
          }}
        >
          {/* 1. 外层容器：锁定背景色与 SVG 反色后一致，仅优化阴影与边框的弥散感 */}
          <div
            className={`
              flex items-center justify-center p-4 rounded-xl 
              bg-white dark:bg-[#121212] 
              border border-black/5 dark:border-white/10 
              shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.6)]
              ${isDark === true ? '!bg-[#121212] !border-white/10 !shadow-[0_10px_40px_rgba(0,0,0,0.6)]' : ''}
              ${isDark === false ? '!bg-white !border-black/5 !shadow-[0_8px_30px_rgb(0,0,0,0.08)]' : ''}
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
            {/* 2. 内层容器：专职处理反色，确保 SVG 背景与外层完美融合 */}
            <div 
              className={`
                w-full h-full flex items-center justify-center 
                [&>svg]:!max-w-full [&>svg]:!h-auto 
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