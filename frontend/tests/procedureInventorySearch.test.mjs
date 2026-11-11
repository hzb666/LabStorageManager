import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = fileURLToPath(new URL('..', import.meta.url))
const mocks = {
  'test-runtime': `export const runtime = {user:{id:1},navigation:[],notifications:[],saved:[],extractCalls:0,resolveCalls:0}`,
  react: `
    export * from 'react-real'
    export {default} from 'react-real'
    export const hooks = {cells:[],cursor:0,effects:[],cleanups:[]}
    export function useState(initial) {
      const index=hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index]=typeof initial==='function'?initial():initial
      return [hooks.cells[index],value=>{hooks.cells[index]=typeof value==='function'?value(hooks.cells[index]):value}]
    }
    export function useMemo(factory,deps) {
      const index=hooks.cursor++, previous=hooks.cells[index]
      if (!previous || deps.some((dep,i)=>!Object.is(dep,previous.deps[i]))) hooks.cells[index]={deps,value:factory()}
      return hooks.cells[index].value
    }
    export const useCallback=(fn,deps)=>useMemo(()=>fn,deps)
    export const useRef=initial=>useMemo(()=>({current:initial}),[])
    export const useEffect=(effect,deps)=>useMemo(()=>{hooks.effects.push(effect)},deps)
  `,
  'react-router-dom': `import {runtime} from 'test-runtime';export const useNavigate=()=>target=>runtime.navigation.push(target)`,
  '@/api/client': `
    import {runtime} from 'test-runtime'
    export const procedureInventorySearchAPI={
      extract:()=>{runtime.extractCalls++;return runtime.extraction.promise},
      resolve:()=>{runtime.resolveCalls++;return runtime.resolution.promise},
    }
  `,
  '@/store/useStore': `
    import {runtime} from 'test-runtime'
    export const useAuthStore=Object.assign(selector=>selector({user:runtime.user}),{getState:()=>({user:runtime.user})})
  `,
  '@/lib/toast': `import {runtime} from 'test-runtime';export const toast={success:message=>runtime.notifications.push(['success',message]),error:message=>runtime.notifications.push(['error',message])}`,
  '@/lib/validationSchemas': `export const getApiErrorMessage=(error,fallback)=>error.message||fallback`,
  '@/lib/storage/procedureInventorySearchStorage': `
    import {runtime} from 'test-runtime'
    export const saveProcedureInventorySearchResult=(result,userId)=>{runtime.saved.push({result,userId});return 'result-id'}
  `,
}
const { outputFiles } = await build({
  absWorkingDir: directory, tsconfig: 'tsconfig.app.json',
  stdin: {
    contents: `export {useProcedureInventorySearch} from '@/components/ProcedureInventorySearchButton'
      export {hooks} from 'react';export {runtime} from 'test-runtime'`,
    resolveDir: directory, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  define: { 'import.meta.env': JSON.stringify({ DEV: false }) },
  plugins: [{
    name: 'procedure-search-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^react-real$/ }, () => ({ path: 'react', external: true }))
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: 'mock' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js', resolveDir: directory }))
      builder.onLoad({ filter: /ProcedureInventorySearchButton\.tsx$/ }, async ({ path }) => ({
        contents: await readFile(path, 'utf8') + '\nexport {useProcedureInventorySearch}', loader: 'tsx',
      }))
    },
  }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
const { hooks, runtime, useProcedureInventorySearch } = module.exports
const result = { rejected: false, cas_query: '64-17-5', analysis_items: [], formatted_text: '加入乙醇' }
const extraction = { rejected: false, reagents: [], formatted_text: '加入乙醇' }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function render() {
  hooks.cursor = 0
  const state = useProcedureInventorySearch(1)
  for (const effect of hooks.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup) hooks.cleanups.push(cleanup)
  }
  return state
}
function setup() {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup()
  hooks.cells = []; hooks.effects = []
  Object.assign(runtime, { user: { id: 1 }, navigation: [], notifications: [], saved: [], extractCalls: 0, resolveCalls: 0, extraction: deferred(), resolution: deferred() })
  const state = render()
  state.setOpen(true)
  state.setText('加入乙醇并搅拌。')
  return render()
}
async function finish(task) {
  runtime.extraction.resolve({ data: extraction })
  await new Promise(setImmediate)
  runtime.resolution.resolve({ data: result })
  await task
  return render()
}

test('an open dialog enters the result page once the query completes', async () => {
  const state = setup()
  const completed = await finish(state.handleSubmit())
  assert.equal(runtime.navigation.length, 1)
  assert.equal(completed.open, false)
  assert.deepEqual(runtime.notifications, [])
  assert.equal(runtime.saved[0].userId, 1)
})

test('closing while pending prevents navigation; the next trigger opens the retained result without querying again', async () => {
  const state = setup()
  const task = state.handleSubmit()
  state.setOpen(false) // Deliberately before rerender: completion must read the latest open state.
  const completed = await finish(task)
  assert.equal(runtime.navigation.length, 0)
  assert.equal(completed.hasResult, true)
  assert.equal(completed.submitting, false)
  assert.equal(runtime.notifications[0][0], 'success')
  completed.setOpen(true)
  assert.equal(runtime.navigation[0].pathname, '/inventory')
  assert.equal(new URLSearchParams(runtime.navigation[0].search).get('search'), '64-17-5')
  assert.equal(runtime.saved[0].result, result)
  assert.equal(runtime.extractCalls, 1)
  assert.equal(runtime.resolveCalls, 1)
  const viewed = render()
  assert.equal(viewed.hasResult, false)
  viewed.setOpen(true)
  assert.equal(render().open, true)
})

test('reopening before completion resumes waiting and opens the result normally', async () => {
  const state = setup()
  const task = state.handleSubmit()
  state.setOpen(false)
  state.setOpen(true)
  await finish(task)
  assert.equal(runtime.navigation.length, 1)
  assert.deepEqual(runtime.notifications, [])
})

test('background failure is visible through a toast and leaves the original input available to retry', async () => {
  const state = setup()
  const task = state.handleSubmit()
  state.setOpen(false)
  runtime.extraction.resolve({ data: extraction })
  await new Promise(setImmediate)
  runtime.resolution.reject(new Error('查询服务超时'))
  await task
  const completed = render()
  assert.deepEqual(runtime.notifications, [['error', '查询服务超时']])
  assert.equal(completed.submitting, false)
  assert.equal(completed.hasResult, false)
  completed.setOpen(true)
  assert.equal(render().text, '加入乙醇并搅拌。')
  assert.deepEqual(runtime.navigation, [])
})

test('background text rejection notifies the user without starting CAS resolution', async () => {
  const state = setup()
  const task = state.handleSubmit()
  state.setOpen(false)
  runtime.extraction.resolve({ data: { rejected: true, message: '文本不像化学实验步骤' } })
  await task
  assert.deepEqual(runtime.notifications, [['error', '文本不像化学实验步骤']])
  assert.equal(runtime.resolveCalls, 0)
  assert.equal(render().hasResult, false)
})

test('switching accounts or unmounting rejects late results and notifications', async () => {
  for (const unmount of [false, true]) {
    const state = setup()
    const task = state.handleSubmit()
    runtime.extraction.resolve({ data: extraction })
    await new Promise(setImmediate)
    if (unmount) hooks.cleanups.forEach(cleanup => cleanup())
    else runtime.user = { id: 2 }
    runtime.resolution.resolve({ data: result })
    await task
    assert.deepEqual(runtime.navigation, [])
    assert.deepEqual(runtime.notifications, [])
    assert.deepEqual(runtime.saved, [])
  }
})

test('duplicate submission before a render does not start another external request', async () => {
  const state = setup()
  const task = state.handleSubmit()
  await state.handleSubmit()
  assert.equal(runtime.extractCalls, 1)
  await finish(task)
  assert.equal(runtime.navigation.length, 1)
})
