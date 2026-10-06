import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const frontendDirectory = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  absWorkingDir: frontendDirectory,
  tsconfig: 'tsconfig.app.json',
  stdin: {
    contents: `
      import { createElement } from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { InventoryReadOnlyContext, useInventoryReadOnly, useInventorySnapshotCreatedAt } from '@/lib/inventoryReadOnly'
      export { resolveRuntimeMaintenanceMode, resolveRuntimeInventoryReadOnly, resolveRuntimeSnapshotCreatedAt } from '@/lib/cacheVersionBootstrap'
      function Probe() { return createElement('span', null, String(useInventoryReadOnly()) + ':' + (useInventorySnapshotCreatedAt() || '')) }
      export const renderMode = (readOnly, snapshotCreatedAt = null) => renderToStaticMarkup(
        createElement(InventoryReadOnlyContext.Provider, { value: { enabled: readOnly, snapshotCreatedAt } }, createElement(Probe))
      )
    `,
    loader: 'tsx', resolveDir: frontendDirectory,
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.env': JSON.stringify({ DEV: false }) },
  plugins: [{
    name: 'runtime-boundaries',
    setup(builder) {
      const mocks = {
        '@/lib/apiConfig': 'export const buildBackendUrl = (path) => path',
        '@/lib/runtimeTimeConfig': 'export const persistRuntimeTimeConfig = () => {}',
        '@/lib/sseRuntime': 'export const disconnectAllSSEConnections = () => {}',
        '@/store/sseStore': 'export const useSSEStore = {}',
      }
      builder.onResolve({ filter: /^@\// }, ({ path }) => (
        path in mocks ? { path, namespace: 'mock' } : undefined
      ))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
        contents: mocks[path], loader: 'ts',
      }))
    },
  }],
})

function loadRuntime() {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  return module.exports
}

test('runtime reads maintenance and inventory mode from a single uncached request', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({
      maintenance_mode: false,
      inventory_read_only: true,
      snapshot_created_at: '2026-10-05T12:00:00Z',
    }) }
  }
  try {
    const runtime = loadRuntime()
    assert.deepEqual(await Promise.all([
      runtime.resolveRuntimeMaintenanceMode(), runtime.resolveRuntimeInventoryReadOnly(),
      runtime.resolveRuntimeSnapshotCreatedAt(),
    ]), [false, true, '2026-10-05T12:00:00Z'])
    assert.equal(requests.length, 1)
    assert.equal(requests[0].options.cache, 'no-store')
    assert.equal(runtime.renderMode(true, '2026-10-05T12:00:00Z'), '<span>true:2026-10-05T12:00:00Z</span>')
    assert.equal(runtime.renderMode(false), '<span>false:</span>')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('missing read-only flag preserves normal mode; full maintenance remains independent', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ maintenance_mode: true }) })
  try {
    const runtime = loadRuntime()
    assert.equal(await runtime.resolveRuntimeMaintenanceMode(), true)
    assert.equal(await runtime.resolveRuntimeInventoryReadOnly(), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
