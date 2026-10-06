import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const frontendDirectory = fileURLToPath(new URL('..', import.meta.url))

async function bundleApplication(mockApi) {
  const mocks = {
    'route-store': `
      import { useAuthStore as store } from '@/store/useStore'
      export const useAuthStore = (selector) => selector(store.getState())
    `,
    '@/lib/authSession': `
      import { useAuthStore } from '@/store/useStore'
      export const resolveAuthNoticeByCode = () => 'Session unavailable'
      export const triggerSessionInvalidation = () => useAuthStore.getState().logout({ forceLocal: true })
    `,
    '@/pages/Login': `
      import { createElement } from 'react'
      export const Login = () => createElement('form', null, 'Login form')
    `,
  }
  if (mockApi) {
    mocks['@/api/client'] = `
      export const api = { get: async () => { throw new Error('Network Error') } }
      export const authAPI = { logout: async () => {} }
    `
  }
  const result = await build({
    absWorkingDir: frontendDirectory,
    tsconfig: 'tsconfig.app.json',
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { LoginRoute } from '@/components/LoginRoute'
        export { useAuthStore } from '@/store/useStore'
        export * from '@/lib/searchCompletionCache'
        export { getApiErrorMessage } from '@/lib/validationSchemas'
        export { api, authAPI ${mockApi ? '' : ', searchCompletionAPI'} } from '@/api/client'
        export const renderLogin = (url = '/login') => renderToStaticMarkup(
          createElement(MemoryRouter, { initialEntries: [url] }, createElement(LoginRoute))
        )
      `,
      resolveDir: frontendDirectory,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    define: { 'import.meta.env': JSON.stringify({ DEV: false }) },
    plugins: [{
      name: 'test-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path, importer }) => {
          if (path === '@/store/useStore' && importer.endsWith('LoginRoute.tsx')) {
            return { path: 'route-store', namespace: 'mock' }
          }
          return path in mocks ? { path, namespace: 'mock' } : undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path], loader: 'ts', resolveDir: frontendDirectory,
        }))
      },
    }],
  })
  return result.outputFiles[0].text
}

const authBundle = await bundleApplication(true)
const apiBundle = await bundleApplication(false)
const user = { id: 7, username: 'chemist', full_name: 'Chemist', role: 'user', created_at: '' }

function loadApplication(context, snapshot, code = authBundle) {
  const values = new Map()
  if (snapshot) values.set('auth-storage', JSON.stringify({ state: snapshot, version: 0 }))
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })
  context.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else delete globalThis.localStorage
  })
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports)
  return { ...compiled.exports, values }
}

for (const failure of [
  { response: { status: 500 } },
  { response: { status: 503 } },
  { code: 'ECONNABORTED', message: 'timeout of 8000ms exceeded' },
  new Error('Network Error'),
]) {
  test(`unverified persisted auth can reach login after ${failure.response?.status ?? failure.message}`, async (context) => {
    const application = loadApplication(context, { user, isAuthenticated: true })
    assert.equal(application.useAuthStore.getState().isAuthenticated, false)
    application.api.get = async () => { throw failure }
    await application.useAuthStore.getState().bootstrapAuth()
    const state = application.useAuthStore.getState()
    assert.equal(state.authStatus, 'degraded')
    assert.equal(state.isAuthenticated, false)
    assert.match(application.renderLogin(), /Login form/)
    assert.deepEqual(JSON.parse(application.values.get('auth-storage')).state, { lastKnownUser: user })
  })
}

test('401 clears the cached user and shows login', async (context) => {
  const application = loadApplication(context, { lastKnownUser: user })
  application.api.get = async () => { throw { response: { status: 401 } } }
  await application.useAuthStore.getState().bootstrapAuth()
  assert.equal(application.useAuthStore.getState().authStatus, 'unauthenticated')
  assert.equal(application.useAuthStore.getState().user, null)
  assert.match(application.renderLogin(), /Login form/)
})

test('retry verifies the session and forced login still renders', async (context) => {
  const application = loadApplication(context, { lastKnownUser: user })
  await application.useAuthStore.getState().bootstrapAuth()
  application.api.get = async () => ({ data: user })
  await application.useAuthStore.getState().bootstrapAuth()
  assert.equal(application.useAuthStore.getState().authStatus, 'authenticated')
  assert.equal(application.useAuthStore.getState().isAuthenticated, true)
  assert.doesNotMatch(application.renderLogin(), /Login form/)
  assert.match(application.renderLogin('/login?switch=1'), /Login form/)
})

test('local logout invalidates a late successful bootstrap', async (context) => {
  const application = loadApplication(context, { lastKnownUser: user })
  let finishProbe
  application.api.get = () => new Promise((resolve) => { finishProbe = resolve })
  const probing = application.useAuthStore.getState().bootstrapAuth()
  application.useAuthStore.getState().setUnauthenticated()
  finishProbe({ data: user })
  await probing
  assert.equal(application.useAuthStore.getState().isAuthenticated, false)
  assert.equal(application.useAuthStore.getState().user, null)
})

test('logout clears local state immediately and cannot clear a newer login', async (context) => {
  const application = loadApplication(context)
  let finishLogout
  application.authAPI.logout = () => new Promise((resolve) => { finishLogout = resolve })
  application.useAuthStore.getState().setAuth(user)
  const loggingOut = application.useAuthStore.getState().logout()
  assert.equal(application.useAuthStore.getState().isAuthenticated, false)
  const otherUser = { ...user, id: 8 }
  application.useAuthStore.getState().setAuth(otherUser)
  finishLogout()
  await loggingOut
  assert.equal(application.useAuthStore.getState().isAuthenticated, true)
  assert.equal(application.useAuthStore.getState().user.id, 8)
})

test('completion passes AbortSignal to the HTTP adapter and cancels old requests', async (context) => {
  const application = loadApplication(context, undefined, apiBundle)
  const requests = []
  application.api.defaults.adapter = (config) => new Promise((resolve, reject) => {
    requests.push({ config, resolve })
    config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  const previous = new AbortController()
  const current = new AbortController()
  const first = application.searchCompletionAPI.getInline({ endpoint: '/inventory/', q: 'et' }, previous.signal)
  const firstRejected = assert.rejects(first, (error) => error.code === 'ERR_CANCELED')
  await new Promise((resolve) => setImmediate(resolve))
  previous.abort()
  const second = application.searchCompletionAPI.getInline({ endpoint: '/inventory/', q: 'eth' }, current.signal)
  await new Promise((resolve) => setImmediate(resolve))
  await firstRejected
  assert.equal(requests[0].config.signal.aborted, true)
  assert.equal(requests[1].config.signal.aborted, false)
  assert.equal(requests[1].config.timeout, 2000)
  requests[1].resolve({ data: { completion: 'ethanol' }, status: 200, headers: {}, config: requests[1].config })
  assert.equal((await second).data.completion, 'ethanol')
})

test('a new login waits for an outstanding logout response before replacing the cookie', async (context) => {
  const application = loadApplication(context, undefined, apiBundle)
  const requests = []
  application.api.defaults.adapter = (config) => new Promise((resolve) => {
    requests.push({ config, finish: () => resolve({ data: {}, status: 200, headers: {}, config }) })
  })
  const loggingOut = application.authAPI.logout()
  const loggingIn = application.authAPI.login('chemist', 'example-password')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests.map((request) => request.config.url), ['/users/logout'])
  requests[0].finish()
  await loggingOut
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests.map((request) => request.config.url), ['/users/logout', '/users/login'])
  assert.equal(requests[1].config.timeout, 15000)
  requests[1].finish()
  await loggingIn
})

test('login service failures display an availability message, not a password error', (context) => {
  const application = loadApplication(context)
  const error = { response: { status: 503, data: { detail: 'Login service temporarily unavailable' } } }
  assert.equal(application.getApiErrorMessage(error, '用户名或密码错误'), '登录服务暂时不可用，请稍后重试')
})

test('completion cache isolates users, endpoints and fields and does not store empty responses', (context) => {
  const application = loadApplication(context)
  const scope = application.createCompletionScope(7, '/inventory/', 'all')
  const value = { completion: 'ethanol', personalized: true }
  application.cacheCompletion(scope, 'et', value)
  assert.deepEqual(application.getCachedCompletion(scope, 'et').value, value)
  for (const otherScope of [
    application.createCompletionScope(8, '/inventory/', 'all'),
    application.createCompletionScope(7, '/reagent-orders/', 'all'),
    application.createCompletionScope(7, '/inventory/', 'name'),
  ]) assert.equal(application.getCachedCompletion(otherScope, 'et'), null)
  assert.equal(application.cacheCompletion(scope, 'missing', { completion: null }), null)
  assert.equal(application.getCachedCompletion(scope, 'missing'), null)
})

test('completion TTL invalidates both the shared cache and a retained hook entry', (context) => {
  const application = loadApplication(context)
  let now = 1000
  context.mock.method(Date, 'now', () => now)
  const scope = application.createCompletionScope(7, '/inventory/', 'all')
  const entry = application.cacheCompletion(scope, 'et', { completion: 'ethanol' })
  now += application.COMPLETION_CACHE_TTL_MS - 1
  assert.equal(application.validCompletion(entry, scope), entry)
  now += 1
  assert.equal(application.getCachedCompletion(scope, 'et'), null)
  assert.equal(application.validCompletion(entry, scope), null)
})

test('logout and account changes discard cached suggestions and reject late writes', (context) => {
  const application = loadApplication(context)
  application.useAuthStore.getState().setAuth(user)
  const scope = application.createCompletionScope(user.id, '/inventory/', 'all')
  const entry = application.cacheCompletion(scope, 'et', { completion: 'ethanol' })
  application.useAuthStore.getState().setUnauthenticated()
  application.useAuthStore.getState().setAuth(user)
  assert.equal(application.getCachedCompletion(scope, 'et'), null)
  assert.equal(application.validCompletion(entry, scope), null)
  assert.equal(application.cacheCompletion(scope, 'et', entry.value), null)
  const newScope = application.createCompletionScope(user.id, '/inventory/', 'all')
  assert.notEqual(newScope, scope)
  application.cacheCompletion(newScope, 'et', entry.value)
  application.useAuthStore.getState().setAuth({ ...user, id: 8 })
  assert.equal(application.getCachedCompletion(newScope, 'et'), null)
})

test('completion cache keeps its size limit when replacing existing keys', (context) => {
  const application = loadApplication(context)
  const scope = application.createCompletionScope(user.id, '/inventory/', 'all')
  for (let index = 0; index < 200; index += 1) {
    application.cacheCompletion(scope, String(index), { completion: `item ${index}` })
  }
  application.cacheCompletion(scope, '199', { completion: 'updated' })
  assert.ok(application.getCachedCompletion(scope, '0'))
  application.cacheCompletion(scope, 'new', { completion: 'new' })
  assert.equal(application.getCachedCompletion(scope, '0'), null)
  assert.equal(application.getCachedCompletion(scope, '199').value.completion, 'updated')
})
