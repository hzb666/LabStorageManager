import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'

import {
  createLibAssetVersion,
  generateStaticAssetsModule,
  syncVersionedLibAssets,
} from './lib-assets.mjs'

async function testCreateLibAssetVersion() {
  const date = new Date('2026-03-31T00:00:00Z')
  assert.equal(createLibAssetVersion(date), '260331')
}

async function testGenerateStaticAssetsModule() {
  const content = generateStaticAssetsModule({
    version: '260331',
    assets: {
      rdkitScriptUrl: '/lib/RDKit_minimal-260331.js',
      rdkitWasmUrl: '/lib/RDKit_minimal-260331.wasm',
      localFontUrl: '/lib/SourceHanSansCN-VF-260331.woff2',
      localFontPreferenceValue: 'source-han-sans-cn-vf-260331',
    },
  })

  assert.ok(content.includes("export const LIB_ASSET_VERSION = '260331'"))
  assert.ok(content.includes("rdkitScriptUrl: '/lib/RDKit_minimal-260331.js'"))
}

async function testSyncVersionedLibAssets() {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'lib-assets-test-'))
  const libDir = path.join(tmpRoot, 'public', 'lib')
  const outputFile = path.join(tmpRoot, 'src', 'lib', 'staticAssets.ts')

  try {
    await mkdir(libDir, { recursive: true })

    await writeFile(path.join(libDir, 'RDKit_minimal.js'), 'console.log("rdkit")')
    await writeFile(path.join(libDir, 'RDKit_minimal.wasm'), 'wasm-binary')
    await writeFile(path.join(libDir, 'SourceHanSansCN-VF.woff2'), 'font-binary')
    await writeFile(path.join(libDir, 'RDKit_minimal-250101.js'), 'stale')

    const result = await syncVersionedLibAssets({
      libDir,
      outputFile,
      version: '260331',
    })

    assert.equal(result.version, '260331')

    await stat(path.join(libDir, 'RDKit_minimal-260331.js'))
    await stat(path.join(libDir, 'RDKit_minimal-260331.wasm'))
    await stat(path.join(libDir, 'SourceHanSansCN-VF-260331.woff2'))

    let staleExists = true
    try {
      await stat(path.join(libDir, 'RDKit_minimal-250101.js'))
    } catch {
      staleExists = false
    }
    assert.equal(staleExists, false)

    const generated = await readFile(outputFile, 'utf8')
    assert.ok(generated.includes("LIB_ASSET_VERSION = '260331'"))
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

async function main() {
  await testCreateLibAssetVersion()
  await testGenerateStaticAssetsModule()
  await testSyncVersionedLibAssets()
  console.log('lib-assets tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
