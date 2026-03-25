import { useState, useEffect, useId } from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
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
  useTransitionStyles,
} from '@floating-ui/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { querySmiles } from '@/lib/chemicalProperties'
import { isSpecialCasValue } from '@/lib/validationSchemas'

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

type MoleculeSvgCacheValue = {
  svg: string
  zoomSvg: string
  naturalSize: { w: number; h: number }
}

type MoleculeSvgState = {
  svg: string
  zoomSvg: string
  canZoom: boolean
}

let rdkitLoaderPromise: Promise<RDKitModule> | null = null

// SVG缓存：内存Map（刷新丢失）
const SVG_MAX_CACHE_SIZE = 100
const svgCache = new Map<string, MoleculeSvgCacheValue>()

/** 统一处理 SVG 内部 id，避免多实例渲染时出现定义引用冲突。 */
function processSvgId(str: string, id: string): string {
  return str
    .replaceAll(/id=['"](.+?)['"]/g, `id="${id}_$1"`)
    .replaceAll(/url\(#(.+?)\)/g, `url(#${id}_$1)`)
}

/** 从 RDKit 输出的 SVG 字符串中提取原始宽高，用于判断是否可放大。 */
function extractNaturalSize(svgString: string): { w: number; h: number } {
  const widthMatch = /width='([\d.]+)px'/.exec(svgString)
  const heightMatch = /height='([\d.]+)px'/.exec(svgString)
  return {
    w: widthMatch ? Number.parseFloat(widthMatch[1]) : 0,
    h: heightMatch ? Number.parseFloat(heightMatch[1]) : 0,
  }
}

/** 将 SVG 文本安全编码为 data URI，供 img 标签直接渲染。 */
function svgToDataUri(svgString: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
}

/** 基于当前结构复杂度选择渲染延时，避免高复杂分子瞬时计算卡顿。 */
function getMoleculeRenderDelay(smiles: string): number {
  if (smiles.length > 45) return 250
  if (smiles.length > 20) return 180
  return 100
}

/** 生成缓存键，确保同一结构在相同尺寸下复用渲染结果。 */
function createCacheKey(smiles: string, width: number, height: number): string {
  return `${smiles}_${width}_${height}`
}

/** 读取缓存并刷新 LRU 顺序，命中时直接返回可渲染数据。 */
function readCachedSvgState(
  cacheKey: string,
  componentId: string,
  width: number,
  height: number
): MoleculeSvgState | null {
  const cached = svgCache.get(cacheKey)
  if (!cached) return null

  svgCache.delete(cacheKey)
  svgCache.set(cacheKey, cached)
  return {
    svg: processSvgId(cached.svg, componentId),
    zoomSvg: processSvgId(cached.zoomSvg, componentId),
    canZoom: cached.naturalSize.w > width || cached.naturalSize.h > height,
  }
}

/** 写入渲染缓存并在超限时淘汰最早条目，控制内存上限。 */
function writeCachedSvgState(cacheKey: string, value: MoleculeSvgCacheValue): void {
  if (svgCache.size >= SVG_MAX_CACHE_SIZE) {
    const oldest = svgCache.keys().next()
    if (!oldest.done) {
      svgCache.delete(oldest.value)
    }
  }
  svgCache.set(cacheKey, value)
}

/** Promise 化延时工具，供渲染节流链路复用。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 加载 RDKit 运行时脚本，保证后续模块初始化可用。 */
async function loadRDKitScript(): Promise<void> {
  if (document.querySelector('#rdkit-script')) return
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = 'rdkit-script'
    script.src = '/lib/RDKit_minimal.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('RDKit 脚本加载失败'))
    document.head.appendChild(script)
  })
}

/** 初始化 RDKit 模块并挂载到全局，供多处渲染链路复用。 */
async function initRDKit(): Promise<RDKitModule> {
  await loadRDKitScript()

  let retries = 0
  while (!globalThis.initRDKitModule && retries < 50) {
    await sleep(100)
    retries += 1
  }

  if (!globalThis.initRDKitModule) {
    throw new Error('RDKit 模块未初始化')
  }

  const rdkit = await globalThis.initRDKitModule()
  globalThis.RDKit = rdkit
  return rdkit
}

/** 获取 RDKit 模块实例并复用进行中的初始化 Promise，避免并发重复初始化。 */
async function loadRDKitModule(): Promise<RDKitModule> {
  if (globalThis.RDKit) return globalThis.RDKit
  if (rdkitLoaderPromise) return rdkitLoaderPromise

  rdkitLoaderPromise = initRDKit().catch((err) => {
    rdkitLoaderPromise = null
    throw err
  })
  return rdkitLoaderPromise
}

/** 调用 RDKit 产出基础图与放大图，并返回可复用的尺寸信息。 */
function renderMoleculeSvgWithRDKit(
  rdkit: RDKitModule,
  smiles: string,
  width: number,
  height: number
): MoleculeSvgCacheValue {
  let mol: Mol | undefined
  try {
    mol = rdkit.get_mol(smiles)
    if (!mol?.is_valid()) {
      throw new Error('无效的分子结构')
    }

    const renderOptions = {
      width,
      height,
      bondLineWidth: 1.5,
      addStereoAnnotation: true,
    }
    const zoomOptions = {
      width: -1,
      height: -1,
      bondLineWidth: 1.5,
      addStereoAnnotation: true,
    }

    const svg = mol.get_svg_with_highlights(JSON.stringify(renderOptions))
    const zoomSvg = mol.get_svg_with_highlights(JSON.stringify(zoomOptions))
    const naturalSize = extractNaturalSize(zoomSvg)
    return { svg, zoomSvg, naturalSize }
  } finally {
    mol?.delete?.()
  }
}

/** 基于 CAS 查询 SMILES，并同步维护加载态、错误态与渲染前置数据。 */
function useMoleculeSourceState(casNumber: string) {
  const [smiles, setSmiles] = useState('')
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!casNumber) return

    let cancelled = false

    /** 写入“特殊 CAS 不适用”状态，保持展示语义和历史实现一致。 */
    const applySpecialCasState = () => {
      setSmiles('')
      setError('生物试剂不适用')
      setLoadingState('error')
    }

    /** 拉取 SMILES 并兜底异常，避免未处理拒绝让界面卡在加载中。 */
    const fetchSmiles = async () => {
      if (isSpecialCasValue(casNumber)) {
        if (!cancelled) {
          applySpecialCasState()
        }
        return
      }

      setError('')
      setSmiles('')
      setLoadingState('loading')
      try {
        const fetchedSmiles = await querySmiles(casNumber)
        if (cancelled) return

        if (!fetchedSmiles) {
          setError('未找到对应的化合物')
          setLoadingState('error')
          return
        }

        setSmiles(fetchedSmiles)
      } catch {
        if (cancelled) return
        setError('未找到对应的化合物')
        setLoadingState('error')
      }
    }

    void fetchSmiles()
    return () => {
      cancelled = true
    }
  }, [casNumber])

  return { smiles, loadingState, setLoadingState, error, setError }
}

/** 根据 SMILES 渲染 SVG 并结合缓存/错误态回填视图数据。 */
function useMoleculeSvgState(args: {
  smiles: string
  width: number
  height: number
  componentId: string
  setLoadingState: (state: LoadingState) => void
  setError: (value: string) => void
}) {
  const { smiles, width, height, componentId, setLoadingState, setError } = args
  const [svg, setSvg] = useState('')
  const [zoomSvg, setZoomSvg] = useState('')
  const [canZoom, setCanZoom] = useState(false)

  useEffect(() => {
    if (!smiles) return

    let isActive = true
    const cacheKey = createCacheKey(smiles, width, height)

    /** 统一把渲染结果写入状态，减少重复赋值分支。 */
    const applySvgState = (state: MoleculeSvgState) => {
      setSvg(state.svg)
      setZoomSvg(state.zoomSvg)
      setCanZoom(state.canZoom)
      setLoadingState('ready')
    }

    /** 优先命中缓存，否则执行 RDKit 渲染并统一落到 ready/error 状态。 */
    const renderMolecule = async () => {
      try {
        const cachedState = readCachedSvgState(cacheKey, componentId, width, height)
        if (cachedState) {
          if (!isActive) return
          applySvgState(cachedState)
          return
        }

        const rdkit = await loadRDKitModule()
        await sleep(getMoleculeRenderDelay(smiles))
        if (!isActive) return

        const rendered = renderMoleculeSvgWithRDKit(rdkit, smiles, width, height)
        writeCachedSvgState(cacheKey, rendered)
        if (!isActive) return

        applySvgState({
          svg: processSvgId(rendered.svg, componentId),
          zoomSvg: processSvgId(rendered.zoomSvg, componentId),
          canZoom: rendered.naturalSize.w > width || rendered.naturalSize.h > height,
        })
      } catch (err) {
        if (!isActive) return
        setError(err instanceof Error ? err.message : '结构式渲染失败')
        setLoadingState('error')
      }
    }

    void renderMolecule()
    return () => {
      isActive = false
    }
  }, [smiles, width, height, componentId, setLoadingState, setError])

  return { svg, zoomSvg, canZoom, setSvg, setZoomSvg, setCanZoom }
}

/** 统一管理悬浮放大层交互，保持主组件只关心渲染组合。 */
function useMoleculeZoom(canZoom: boolean) {
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
            maxHeight: 'calc(100vh - 32px)',
          })
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  const hover = useHover(context, {
    delay: { open: 50, close: 0 },
    enabled: canZoom,
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover])
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 200,
    initial: { transform: 'scale(0.9)', opacity: 0 },
    open: { transform: 'scale(1)', opacity: 1 },
    close: { transform: 'scale(0.9)', opacity: 0 },
  })

  return {
    refs,
    floatingStyles,
    getReferenceProps,
    getFloatingProps,
    isMounted,
    transitionStyles,
  }
}

/** 根据深浅色强制策略生成结构图滤镜 class，避免 JSX 内多层条件。 */
function getFilterClass(isDark: boolean | undefined): string {
  if (isDark === true) return '[filter:invert(0.93)_hue-rotate(180deg)]'
  if (isDark === false) return ''
  return 'dark:[filter:invert(0.93)_hue-rotate(180deg)]'
}

/** 生成结构图区块背景 class，确保加载态和错误态视觉保持一致。 */
function getBaseSurfaceClass(isDark: boolean | undefined): string {
  const darkClass = isDark === true ? 'bg-[#121212]' : ''
  return `flex items-center justify-center rounded-md bg-white dark:bg-[#121212] ${darkClass}`
}

/** 渲染加载占位，复用统一背景和尺寸布局。 */
function MoleculeLoadingView(props: { width: number; height: number; isDark?: boolean }) {
  const { width, height, isDark } = props
  return (
    <div className={getBaseSurfaceClass(isDark)} style={{ width, height }}>
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <span>加载中...</span>
      </div>
    </div>
  )
}

/** 渲染错误占位，集中处理失败文案的展示容器。 */
function MoleculeErrorView(props: {
  width: number
  height: number
  isDark?: boolean
  error: string
}) {
  const { width, height, isDark, error } = props
  return (
    <div className={getBaseSurfaceClass(isDark)} style={{ width, height }}>
      <span className="text-gray-500 text-sm">{error}</span>
    </div>
  )
}

/** 渲染可点击的结构图主体，并绑定提示与悬浮交互。 */
function MoleculePreview(props: {
  width: number
  height: number
  svg: string
  filterClass: string
  canZoom: boolean
  casNumber: string
  setReference: (node: Element | null) => void
  referenceProps: HTMLAttributes<HTMLDivElement>
}) {
  const { width, height, svg, filterClass, canZoom, casNumber, setReference, referenceProps } = props

  /** 打开 ChemicalBook 详情页，保持原有点击行为不变。 */
  const handleClick = () => {
    if (casNumber) {
      window.open(
        `https://www.chemicalbook.com/CAS_${casNumber}.htm`,
        '_blank',
        'noopener,noreferrer'
      )
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={setReference}
          {...referenceProps}
          onClick={handleClick}
          className={`flex items-center justify-center p-2 rounded-md overflow-hidden bg-white transition-none ${filterClass} ${canZoom ? 'cursor-zoom-in' : 'cursor-pointer'}`}
          style={{ width, height }}
        >
          <img
            src={svgToDataUri(svg)}
            alt="分子结构"
            className="max-w-full max-h-full"
            draggable={false}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">点击查看详情</TooltipContent>
    </Tooltip>
  )
}

/** 渲染悬浮放大层，复用浮层定位样式并保持原过渡效果。 */
function MoleculeZoomPortal(props: {
  shouldRender: boolean
  setFloating: (node: Element | null) => void
  floatingProps: HTMLAttributes<HTMLDivElement>
  floatingStyles: CSSProperties
  transitionStyles: CSSProperties
  width: number
  height: number
  zoomSvg: string
  filterClass: string
  isDark?: boolean
}) {
  const {
    shouldRender,
    setFloating,
    floatingProps,
    floatingStyles,
    transitionStyles,
    width,
    height,
    zoomSvg,
    filterClass,
    isDark,
  } = props

  if (!shouldRender) return null

  const forceDarkClass =
    isDark === true
      ? 'bg-[#121212]! border-white/10! shadow-[0_10px_40px_rgba(0,0,0,0.6)]!'
      : ''
  const forceLightClass =
    isDark === false
      ? 'bg-white! border-black/5! shadow-[0_8px_30px_rgb(0,0,0,0.08)]!'
      : ''

  return createPortal(
    <div
      ref={setFloating}
      {...floatingProps}
      className="pointer-events-none z-9999"
      style={{
        ...floatingStyles,
        width: 'max-content',
        height: 'max-content',
        willChange: 'transform',
      }}
    >
      <div
        className={`
          flex items-center justify-center p-4 rounded-xl
          bg-white dark:bg-[#121212]
          border border-black/5 dark:border-white/10
          shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.6)]
          ${forceDarkClass}
          ${forceLightClass}
        `}
        style={{
          ...transitionStyles,
          transformOrigin: 'top left',
          minWidth: width,
          minHeight: height,
          maxWidth: '100%',
          maxHeight: '100%',
          overflow: 'hidden',
          willChange: 'transform, opacity',
        }}
      >
        <div className={`w-full h-full flex items-center justify-center [&>svg]:max-w-full! [&>svg]:h-auto! ${filterClass}`}>
          <img
            src={svgToDataUri(zoomSvg)}
            alt="分子结构放大图"
            className="max-w-full h-auto"
            draggable={false}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}

/** 渲染 CAS 对应分子结构，并在可放大时提供悬浮放大预览。 */
export function MoleculeStructure({
  casNumber,
  width = 300,
  height = 200,
  isDark,
}: Readonly<MoleculeStructureProps>) {
  const componentId = useId().replaceAll(':', '')
  const { smiles, loadingState, setLoadingState, error, setError } =
    useMoleculeSourceState(casNumber)
  const { svg, zoomSvg, canZoom, setSvg, setZoomSvg, setCanZoom } =
    useMoleculeSvgState({
      smiles,
      width,
      height,
      componentId,
      setLoadingState,
      setError,
    })
  const zoom = useMoleculeZoom(canZoom)
  const filterClass = getFilterClass(isDark)

  useEffect(() => {
    if (!casNumber) return
    setSvg('')
    setZoomSvg('')
    setCanZoom(false)
  }, [casNumber, setSvg, setZoomSvg, setCanZoom])

  if (!casNumber) return null
  if (loadingState === 'loading') {
    return <MoleculeLoadingView width={width} height={height} isDark={isDark} />
  }
  if (error || loadingState === 'error') {
    return (
      <MoleculeErrorView
        width={width}
        height={height}
        isDark={isDark}
        error={error}
      />
    )
  }
  if (!svg) return null

  return (
    <>
      <MoleculePreview
        width={width}
        height={height}
        svg={svg}
        filterClass={filterClass}
        canZoom={canZoom}
        casNumber={casNumber}
        setReference={zoom.refs.setReference}
        referenceProps={zoom.getReferenceProps()}
      />
      <MoleculeZoomPortal
        shouldRender={zoom.isMounted && canZoom}
        setFloating={zoom.refs.setFloating}
        floatingProps={zoom.getFloatingProps()}
        floatingStyles={zoom.floatingStyles}
        transitionStyles={zoom.transitionStyles}
        width={width}
        height={height}
        zoomSvg={zoomSvg}
        filterClass={filterClass}
        isDark={isDark}
      />
    </>
  )
}

export default MoleculeStructure
