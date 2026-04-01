import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'

const DEFAULT_LIB_DIR = path.resolve(process.cwd(), 'public/lib')
const DEFAULT_OUTPUT_FILE = path.resolve(process.cwd(), 'src/lib/staticAssets.ts')

const ASSET_DEFINITIONS = [
  {
    sourceName: 'RDKit_minimal.js',
    generatedName: (version) => `RDKit_minimal-${version}.js`,
    property: 'rdkitScriptUrl',
    preferenceValue: null,
  },
  {
    sourceName: 'RDKit_minimal.wasm',
    generatedName: (version) => `RDKit_minimal-${version}.wasm`,
    property: 'rdkitWasmUrl',
    preferenceValue: null,
  },
  {
    sourceName: 'SourceHanSansCN-VF.woff2',
    generatedName: (version) => `SourceHanSansCN-VF-${version}.woff2`,
    property: 'localFontUrl',
    preferenceValue: (version) => `source-han-sans-cn-vf-${version}`,
  },
]

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function createLibAssetVersion(date = new Date()) {
  return `${pad2(date.getFullYear() % 100)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createGeneratedFileMatcher(sourceName) {
  const parsed = path.parse(sourceName)
  return new RegExp(`^${escapeRegExp(parsed.name)}-\\d{6}${escapeRegExp(parsed.ext)}$`)
}

function createAssetMap(version) {
  const assets = {}

  for (const definition of ASSET_DEFINITIONS) {
    assets[definition.property] = `/lib/${definition.generatedName(version)}`
    if (definition.preferenceValue) {
      assets.localFontPreferenceValue = definition.preferenceValue(version)
    }
  }

  return assets
}

export function generateStaticAssetsModule({ version, assets }) {
  return [
    `export const LIB_ASSET_VERSION = '${version}'`,
    '',
    'export const LIB_ASSETS = {',
    `  rdkitScriptUrl: '${assets.rdkitScriptUrl}',`,
    `  rdkitWasmUrl: '${assets.rdkitWasmUrl}',`,
    `  localFontUrl: '${assets.localFontUrl}',`,
    `  localFontPreferenceValue: '${assets.localFontPreferenceValue}',`,
    '} as const',
    '',
  ].join('\n')
}

async function ensureSourceAssetsExist(libDir) {
  for (const definition of ASSET_DEFINITIONS) {
    const sourcePath = path.join(libDir, definition.sourceName)
    try {
      const sourceStat = await stat(sourcePath)
      if (!sourceStat.isFile()) {
        throw new Error(`${definition.sourceName} 不是文件`)
      }
    } catch {
      throw new Error(`缺少源资源文件: ${sourcePath}`)
    }
  }
}

async function removeStaleGeneratedAssets(libDir, currentVersion) {
  const fileNames = await readdir(libDir)

  await Promise.all(
    ASSET_DEFINITIONS.flatMap((definition) =>
      fileNames
        .filter((fileName) => {
          const matcher = createGeneratedFileMatcher(definition.sourceName)
          return matcher.test(fileName) && fileName !== definition.generatedName(currentVersion)
        })
        .map((fileName) => rm(path.join(libDir, fileName), { force: true }))
    )
  )
}

async function writeGeneratedAssets(libDir, version) {
  await Promise.all(
    ASSET_DEFINITIONS.map(async (definition) => {
      const sourcePath = path.join(libDir, definition.sourceName)
      const generatedPath = path.join(libDir, definition.generatedName(version))
      await copyFile(sourcePath, generatedPath)
    })
  )
}

export async function syncVersionedLibAssets({
  libDir = DEFAULT_LIB_DIR,
  outputFile = DEFAULT_OUTPUT_FILE,
  version = createLibAssetVersion(),
} = {}) {
  await ensureSourceAssetsExist(libDir)
  await removeStaleGeneratedAssets(libDir, version)
  await writeGeneratedAssets(libDir, version)

  const assets = createAssetMap(version)
  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, generateStaticAssetsModule({ version, assets }))

  return { version, assets }
}

async function main() {
  const version = process.env.LIB_ASSET_VERSION || createLibAssetVersion()
  const result = await syncVersionedLibAssets({ version })
  console.log(`Generated versioned lib assets for ${result.version}`)
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
