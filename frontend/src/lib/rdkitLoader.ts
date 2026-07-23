import { LIB_ASSETS } from '@/lib/staticAssets'

export interface Mol {
  get_svg_with_highlights: (details: string) => string
  get_substruct_match?: (query: Mol) => string
  get_smarts?: () => string
  get_smiles?: () => string
  is_valid: () => boolean
  delete?: () => void
}

export type RDKitModule = {
  get_mol: (input: string) => Mol | null
  get_qmol?: (input: string) => Mol | null
  version: string
}

declare global {
  var RDKit: RDKitModule | undefined
  var initRDKitModule:
    | ((moduleConfig?: { locateFile?: (path: string) => string }) => Promise<RDKitModule>)
    | undefined
}

let rdkitLoaderPromise: Promise<RDKitModule> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadRDKitScript(): Promise<void> {
  const existingScript = document.querySelector<HTMLScriptElement>('#rdkit-script')
  if (existingScript) {
    if (globalThis.initRDKitModule) return
    existingScript.remove()
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = 'rdkit-script'
    script.src = LIB_ASSETS.rdkitScriptUrl
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error('RDKit 脚本加载失败'))
    }
    document.head.appendChild(script)
  })
}

async function initRDKit(): Promise<RDKitModule> {
  await loadRDKitScript()

  let retries = 0
  while (!globalThis.initRDKitModule && retries < 50) {
    await sleep(100)
    retries += 1
  }

  if (!globalThis.initRDKitModule) {
    document.querySelector('#rdkit-script')?.remove()
    throw new Error('RDKit 模块未初始化')
  }

  const rdkit = await globalThis.initRDKitModule({
    locateFile: (path) => {
      if (path.endsWith('.wasm')) {
        return LIB_ASSETS.rdkitWasmUrl
      }
      return `/lib/${path}`
    },
  })
  globalThis.RDKit = rdkit
  return rdkit
}

// RDKit 初始化保持 single-flight，页面空闲预热和结构图渲染共享同一实例。
export async function loadRDKitModule(): Promise<RDKitModule> {
  if (globalThis.RDKit) return globalThis.RDKit
  if (rdkitLoaderPromise) return rdkitLoaderPromise

  rdkitLoaderPromise = initRDKit().catch((error) => {
    rdkitLoaderPromise = null
    throw error
  })
  return rdkitLoaderPromise
}

export async function preloadRDKitModule(): Promise<void> {
  await loadRDKitModule()
}
