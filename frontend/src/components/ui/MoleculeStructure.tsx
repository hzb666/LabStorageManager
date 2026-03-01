import { useState, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { 
  useFloating, 
  autoUpdate, 
  offset, 
  shift, 
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

// 全局缓存（内存级）
const svgCache = new Map<string, { svg: string; zoomSvg: string; naturalSize: { w: number; h: number } }>()
const smilesCache = new Map<string, string>()

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
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  
  const componentId = useId().replace(/:/g, '') 

  // --- Floating UI 配置 (更新为左对齐上对齐) ---
  const [isOpen, setIsOpen] = useState(false)
  
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen && canZoom,
    onOpenChange: setIsOpen,
    placement: 'bottom-start', 
    middleware: [
      // 关键修改：向上偏移原窗口的高度，使其与原窗口 top 齐平；crossAxis: 0 保持 left 齐平
      offset(({ rects }) => ({
        mainAxis: -rects.reference.height,
        crossAxis: 0,
      })),
      // 只需要 shift 确保不管怎么放大，都不会溢出屏幕即可
      shift({ padding: 16 }) 
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
    if (smilesCache.has(cas)) return smilesCache.get(cas)!

    try {
      const response = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/property/SMILES/JSON`,
        { headers: { 'Accept': 'application/json' } }
      )
      if (!response.ok) throw new Error('Compound not found')
      
      const data = await response.json()
      const fetchedSmiles = data?.PropertyTable?.Properties?.[0]?.SMILES || null
      
      if (fetchedSmiles) {
        smilesCache.set(cas, fetchedSmiles)
      }
      return fetchedSmiles
    } catch (err) {
      console.error('获取 SMILES 失败:', err)
      return null
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
        const processSvgId = (str: string) => 
          str.replace(/id=['"](.+?)['"]/g, `id="${componentId}_$1"`)
             .replace(/url\(#(.+?)\)/g, `url(#${componentId}_$1)`)

        setSvg(processSvgId(cached.svg))
        setZoomSvg(processSvgId(cached.zoomSvg))
        setNaturalSize(cached.naturalSize)
        setCanZoom(cached.naturalSize.w > width || cached.naturalSize.h > height)
        setLoadingState('ready')
        return
      }

      try {
        const RDKit = await loadRDKit()

        let delay = 100
        if (smiles.length > 45) {
          delay = 350 
        } else if (smiles.length > 20) {
          delay = 200
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
          svgCache.set(cacheKey, calcResult)

          if (isActive) {
            const processSvgId = (str: string) => 
              str.replace(/id=['"](.+?)['"]/g, `id="${componentId}_$1"`)
                 .replace(/url\(#(.+?)\)/g, `url(#${componentId}_$1)`)

            setSvg(processSvgId(calcResult.svg))
            setZoomSvg(processSvgId(calcResult.zoomSvg))
            setNaturalSize(calcResult.naturalSize)
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
      <div 
        className={`flex items-center justify-center rounded-md bg-white dark:bg-[#121212] ${isDark === true ? 'bg-[#121212]' : ''}`} 
        style={{ width, height }}
      >
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  if (error || loadingState === 'error') {
    return (
      <div 
        className={`flex items-center justify-center rounded-md bg-white dark:bg-[#121212] ${isDark === true ? 'bg-[#121212]' : ''}`} 
        style={{ width, height }}
      >
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
          className={`
            fixed z-[9999] pointer-events-none flex items-center justify-center 
            p-4 rounded-lg shadow-xl bg-white border border-gray-200 dark:border-gray-400
            ${filterClass}
          `}
          style={{
            ...floatingStyles,
            ...transitionStyles,
            transformOrigin: 'top left', // 关键修改：动画缩放基点设置在左上角
            minWidth: width, 
            minHeight: height,
          }}
          dangerouslySetInnerHTML={{ __html: zoomSvg }}
        />,
        document.body
      )}
    </>
  )
}

export default MoleculeStructure