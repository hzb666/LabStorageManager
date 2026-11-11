import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = fileURLToPath(new URL('..', import.meta.url))
const { outputFiles } = await build({
  absWorkingDir: directory, tsconfig: 'tsconfig.app.json',
  stdin: {
    contents: `export { handleCreatedListEvent, handleUpdatedListEvent } from '@/hooks/useListSSE'
      export { processSeqByConnection, attachBusinessEventListeners } from '@/hooks/useSSE'
      export { useSSEStore } from '@/store/sseStore'`,
    resolveDir: directory, loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.env': JSON.stringify({ DEV: false }) },
  plugins: [{
    name: 'test-private-event-handlers',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]use(List)?SSE\.ts$/ }, async ({ path }) => ({
        contents: await readFile(path, 'utf8') + (path.endsWith('useListSSE.ts')
          ? '\nexport { handleCreatedListEvent, handleUpdatedListEvent }'
          : '\nexport { processSeqByConnection, attachBusinessEventListeners }'),
        loader: 'ts',
      }))
    },
  }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
const { handleCreatedListEvent, handleUpdatedListEvent, processSeqByConnection, attachBusinessEventListeners, useSSEStore } = module.exports

test('room and query staleness share one version map without clearing another room', () => {
  const store = useSSEStore.getState()
  store.reset()
  store.markRoomStale('inventory')
  store.markStaleKey('inventory::query')
  store.markStaleKey('orders::query')
  assert.ok(store.hasStaleKey('inventory'))
  assert.ok(store.hasStaleKey('inventory::query'))
  store.clearRoomStale('inventory')
  assert.equal(store.hasStaleKey('inventory'), false)
  assert.equal(store.hasStaleKey('inventory::query'), false)
  assert.ok(store.hasStaleKey('orders::query'))
  assert.equal(store.hasStaleKey('toString'), false)
  store.reset()
})

const row = (changes = {}) => ({ id: 1, name: '乙醇', remaining_quantity: 20, updated_at: '2026-10-28T10:01:00.000000Z', ...changes })
function list(changes = {}) {
  let data = { pages: [{ data: [row()], total: 1 }], pageParams: [0] }
  let stale = 0
  const context = { loadedIds: new Set([1]), searchKeyword: '', searchFields: ['name'], statusFilter: 'all', isAtListStart: true, ...changes }
  const runtime = {
    markStale: () => { stale++ }, moveUpdatedRowToStartWhenUnsorted: false,
    onSafePatchRef: { current: undefined }, queryKeyRef: { current: ['inventory'] },
    queryClient: { getQueryData: () => data, setQueryData: (_, next) => { data = next } },
  }
  const dispatch = (handler, item) => handler({ context, runtime, item, itemId: item.id, event: { data: { item } } })
  return {
    update: item => dispatch(handleUpdatedListEvent, item),
    create: item => dispatch(handleCreatedListEvent, item),
    get data() { return data.pages[0] }, get stale() { return stale },
  }
}

test('late snapshots cannot roll back newer HTTP or SSE values; uncertain versions request a refresh', () => {
  const state = list()
  state.update(row({ remaining_quantity: 10, updated_at: '2026-10-28T10:02:00.000000Z' }))
  state.update(row({ remaining_quantity: 30 }))
  assert.equal(state.data.data[0].remaining_quantity, 10)
  assert.equal(state.stale, 0)
  state.update({ id: 1, remaining_quantity: 40 })
  assert.equal(state.data.data[0].remaining_quantity, 10)
  assert.equal(state.stale, 1)
})

test('sub-millisecond timestamps fall back to HTTP without overwriting a row', () => {
  const state = list()
  state.update(row({ updated_at: '2026-10-28T10:01:00.000001Z', remaining_quantity: 30 }))
  assert.equal(state.data.data[0].remaining_quantity, 20)
  assert.equal(state.stale, 1)
})

test('a created event already included by HTTP never duplicates the row or total', () => {
  const state = list()
  state.create(row())
  state.create(row())
  assert.equal(state.data.data.length, 1)
  assert.equal(state.data.total, 1)
  assert.equal(state.stale, 0)
  state.create(row({ id: 2 }))
  assert.equal(state.data.data.length, 2)
  assert.equal(state.data.total, 2)
})

test('searching and sorting allow unrelated changes but defer changed search or sort values', () => {
  const state = list({ searchKeyword: '乙醇', sortBy: 'name' })
  state.update(row({ remaining_quantity: 15 }))
  assert.equal(state.data.data[0].remaining_quantity, 15)
  assert.equal(state.stale, 0)
  state.update(row({ name: '乙醇溶液' }))
  assert.equal(state.stale, 1)
  assert.equal(state.data.data[0].name, '乙醇')
})

test('reading away from the start or interacting keeps row positions stable', () => {
  for (const options of [{ isAtListStart: false }, { isInteracting: true }, { isFetching: true }]) {
    const state = list(options)
    state.create(row({ id: 2 }))
    assert.equal(state.data.data.length, 1)
    assert.equal(state.stale, 1)
  }
  const editing = list({ isInteracting: true })
  editing.update(row({ remaining_quantity: 5 }))
  assert.equal(editing.data.data[0].remaining_quantity, 20)
  assert.equal(editing.stale, 1)
  const fetching = list({ isFetching: true })
  fetching.update(row({ remaining_quantity: 5 }))
  assert.equal(fetching.data.data[0].remaining_quantity, 20)
  assert.equal(fetching.stale, 1)
})

test('Redis/local source changes reset the watermark once and resume accepting subsequent events', () => {
  const refs = { lastSequenceSourceByRoomRef: { current: {} }, lastSeqByRoomRef: { current: {} } }
  const receive = (sequenceSource, seq) => processSeqByConnection({ ...refs, room: 'inventory', sequenceSource, seq })
  assert.equal(receive('redis', 500).hasGap, false)
  assert.deepEqual(receive('local:worker', 1), { hasGap: true, isDuplicateOrOld: false })
  assert.deepEqual(receive('local:worker', 2), { hasGap: false, isDuplicateOrOld: false })
  assert.equal(receive('local:worker', 2).isDuplicateOrOld, true)
  assert.equal(receive('redis', 501).hasGap, true)
  assert.equal(receive('redis', 502).isDuplicateOrOld, false)
})

test('refresh completion cannot clear an update received while the refresh was in flight', () => {
  useSSEStore.getState().reset()
  const key = 'inventory::current'
  useSSEStore.getState().markStaleKey(key)
  const version = useSSEStore.getState().staleVersions[key]
  useSSEStore.getState().markStaleKey(key)
  useSSEStore.getState().clearStaleKey(key, version)
  assert.equal(useSSEStore.getState().hasStaleKey(key), true)
  useSSEStore.getState().clearStaleKey(key, useSSEStore.getState().staleVersions[key])
  assert.equal(useSSEStore.getState().hasStaleKey(key), false)
  useSSEStore.getState().markStaleKey(key)
  useSSEStore.getState().clearStaleKey(key, version)
  assert.equal(useSSEStore.getState().hasStaleKey(key), true)
  useSSEStore.getState().clearAllStale()
  assert.deepEqual(useSSEStore.getState().staleVersions, {})
})

test('a recovered Redis subscription resets old sequence tracking even without an intervening local event', () => {
  const listeners = new Map()
  const received = []
  let stale = 0
  const refs = {
    lastSequenceSourceByRoomRef: { current: { inventory: 'redis' } },
    lastSeqByRoomRef: { current: { inventory: 500 } },
  }
  attachBusinessEventListeners({
    ...refs, es: { addEventListener: (name, listener) => listeners.set(name, listener) },
    handlersRef: { current: { 'inventory.updated': event => received.push(event) } },
    markRoomStale: () => { stale++ }, stableEventTypes: ['inventory.updated'], stableRooms: ['inventory'],
  })
  listeners.get('stale')()
  listeners.get('inventory.updated')({ data: JSON.stringify({ room: 'inventory', seq_source: 'redis', seq: 1 }) })
  assert.equal(stale, 1)
  assert.equal(received.length, 1)
  assert.equal(refs.lastSeqByRoomRef.current.inventory, 1)
})
