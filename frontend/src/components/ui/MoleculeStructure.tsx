import { useState, useEffect, useCallback } from 'react'

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
  isDark?: boolean // 依然保留此属性作为手动强制切换的后门
}

type LoadingState = 'idle' | 'loading' | 'ready' | 'error'

// 使用模块级变量存储 Promise，防止单页面并发加载问题
let rdkitLoaderPromise: Promise<any> | null = null

export function MoleculeStructure({ 
  casNumber, 
  width = 300, 
  height = 200, 
  isDark 
}: MoleculeStructureProps) {
  const [svg, setSvg] = useState<string>('')
  const [smiles, setSmiles] = useState<string>('')
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [error, setError] = useState<string>('')

  // 单例模式加载 RDKit.js
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

        if (!window.initRDKitModule) {
          throw new Error('RDKit 模块未初始化')
        }

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

  // 通过 CAS 号获取 SMILES
  const fetchSmiles = useCallback(async (cas: string): Promise<string | null> => {
    try {
      const response = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/property/SMILES/JSON`,
        { headers: { 'Accept': 'application/json' } }
      )
      if (!response.ok) throw new Error('Compound not found')
      
      const data = await response.json()
      return data?.PropertyTable?.Properties?.[0]?.SMILES || null
    } catch (err) {
      console.error('获取 SMILES 失败:', err)
      return null
    }
  }, [])

  useEffect(() => {
    if (!casNumber) {
      setSmiles('')
      setSvg('')
      setLoadingState('idle')
      return
    }

    const initFetch = async () => {
      setLoadingState('loading')
      setError('')
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

    const renderMolecule = async () => {
      try {
        const RDKit = await loadRDKit()
        let mol
        try {
          mol = RDKit.get_mol(smiles)
        } catch (molError) {
          throw new Error('无效的 SMILES 字符串')
        }

        if (!mol) throw new Error('分子对象创建失败')

        // 核心改动：不设置 clearBackground，让 RDKit 输出纯白底图
        const renderOptions = {
          width: width,
          height: height,
          bondLineWidth: 1.5,
          addStereoAnnotation: true
        }

        const rawSvgString = mol.get_svg_with_highlights(JSON.stringify(renderOptions))
        mol.delete()

        if (isActive) {
          setSvg(rawSvgString)
          setLoadingState('ready')
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
  }, [smiles, width, height, loadRDKit])

  // 决定滤镜类的逻辑：支持显式 props 和 Tailwind 自动感应
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
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span>加载结构式...</span>
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
    <div
      // 这里的 bg-white 是至关重要的！加上 CSS 反转后，白底自动变成高级的深灰色 #121212。
      className={`flex items-center justify-center p-2 rounded-md overflow-hidden bg-white transition-all duration-300 ${filterClass}`}
      style={{ width, height }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default MoleculeStructure

//TODO: 改为语义化颜色