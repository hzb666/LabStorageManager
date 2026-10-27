import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import axios, { AxiosError, AxiosHeaders } from 'axios'

const require = createRequire(import.meta.url)
const directory = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  absWorkingDir: directory, tsconfig: 'tsconfig.app.json',
  stdin: { contents: `export { installMutationRecovery } from '@/lib/mutationRecovery';
    export { notices } from '@/lib/toast'`, resolveDir: directory },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'toast-boundary', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/toast$/ }, () => ({ path: 'toast', namespace: 'mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
      contents: `export const notices = []; export const toast = {
        info: message => notices.push(message), success: message => notices.push(message), error: message => notices.push(message),
      }`,
    }))
  } }],
})

function runtime(handler, options = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports)
  const calls = []
  const client = axios.create({ timeout: 3000, adapter: async config => {
    calls.push(config)
    const value = await handler(config, calls)
    const response = { status: 200, statusText: 'OK', headers: new AxiosHeaders(), ...value, config }
    if (response.status >= 400) throw new AxiosError('Request rejected', 'ERR_BAD_RESPONSE', config, undefined, response)
    return response
  } })
  module.exports.installMutationRecovery(client, { getUserId: () => 7, wait: async () => {}, ...options })
  return { client, calls, notices: module.exports.notices }
}

function timeout(config) { throw new AxiosError('请求超时', 'ECONNABORTED', config) }
function completed(data, status = 201) {
  return { data: { state: status >= 400 ? 'failed' : 'succeeded', response: {
    status_code: status, body: data === undefined ? '' : JSON.stringify(data), headers: { 'content-type': 'application/json' },
  } } }
}
const isStatus = config => config.url.startsWith('/mutation-operations/')
const id = config => config.headers.get('Idempotency-Key')
const payload = { name: 'ethanol', quantity: 2 }

test('a timed-out write remains pending until its original successful response is recovered', async () => {
  let finish
  const result = new Promise(resolve => { finish = resolve })
  const app = runtime(config => isStatus(config) ? result : timeout(config))
  let settled = false
  const submit = app.client.post('/inventory/manual-add', payload).finally(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  finish(completed({ id: 42 }))
  const response = await submit
  assert.equal(response.status, 201)
  assert.deepEqual(response.data, { id: 42 })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  assert.equal(app.notices.length, 0)
})

test('a missing operation is only resent on user retry, using exactly the original operation ID', async () => {
  let writes = 0
  const app = runtime(config => {
    if (isStatus(config)) return { data: { state: 'missing' } }
    if (++writes === 1) return timeout(config)
    return { status: 201, data: { id: 42 } }
  })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 1)
  assert.deepEqual((await app.client.post('/reagent-orders', payload)).data, { id: 42 })
  const requests = app.calls.filter(config => !isStatus(config))
  assert.equal(requests.length, 2)
  assert.equal(id(requests[0]), id(requests[1]))
  assert.equal(requests[0].data, requests[1].data)
})

test('uncertain operations keep their ID for a later user retry and do not repeatedly resend writes', async () => {
  let resolved = false
  const app = runtime(config => {
    if (isStatus(config)) return resolved ? completed({ id: 42 }) : { data: { state: 'running' } }
    if (resolved) return { data: { id: 42 } }
    return timeout(config)
  })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  const originalId = id(app.calls[0])
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  assert.equal(app.calls.filter(isStatus).length, 4)
  resolved = true
  const replay = await app.client.post('/reagent-orders', { quantity: 2, name: 'ethanol' })
  assert.equal(id(replay.config), originalId)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  await app.client.post('/reagent-orders', payload)
  assert.notEqual(id(app.calls.at(-1)), originalId)
})

test('a pending duplicate response causes confirmation rather than a new operation', async () => {
  const app = runtime(config => isStatus(config) ? completed({ id: 42 }) : {
    status: 409, headers: new AxiosHeaders({ 'X-Error-Code': 'OPERATION_PENDING' }), data: { detail: '正在确认' },
  })
  assert.deepEqual((await app.client.post('/common-shelf/manual-add', payload)).data, { id: 42 })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('direct validation errors keep field details, skip polling, and permit a fresh corrected submission', async () => {
  const detail = [{ loc: ['body', 'quantity'], msg: '数量不合法' }]
  const app = runtime(() => ({ status: 422, data: { detail } }))
  await assert.rejects(app.client.post('/reagent-orders', payload), error => {
    assert.deepEqual(error.response.data.detail, detail)
    return true
  })
  await assert.rejects(app.client.post('/reagent-orders', { ...payload, quantity: 3 }))
  assert.equal(app.calls.length, 2)
  assert.notEqual(id(app.calls[0]), id(app.calls[1]))
  assert.equal(app.notices.length, 0)
})

test('recovered failure responses preserve validation information for the existing form handler', async () => {
  const detail = [{ loc: ['body', 'quantity'], msg: '数量不合法' }]
  const app = runtime(config => isStatus(config) ? completed({ detail }, 422) : timeout(config))
  await assert.rejects(app.client.post('/reagent-orders', payload), error => {
    assert.equal(error.response.status, 422)
    assert.deepEqual(error.response.data.detail, detail)
    return true
  })
})

test('a committed operation with a failed HTTP response can still recover its successful business result', async () => {
  const app = runtime(config => isStatus(config) ? completed(undefined, 204) : { status: 500, data: {} })
  const response = await app.client.delete('/inventory/42')
  assert.equal(response.status, 204)
  assert.equal(response.data, '')
})

test('an unconfirmed submission blocks changed input until its previous outcome can be checked', async () => {
  let resolved = false
  const app = runtime(config => isStatus(config)
    ? resolved ? completed({ id: 42 }) : { data: { state: 'running' } }
    : timeout(config))
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(app.client.post('/reagent-orders', { ...payload, quantity: 3 }), /上次提交结果尚未确认/)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  await new Promise(resolve => setImmediate(resolve))
  resolved = true
  await assert.rejects(app.client.post('/reagent-orders', { ...payload, quantity: 3 }), /上次提交已成功/)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('changing accounts during confirmation stops polling and never resends as the new account', async () => {
  let currentUser = 7
  const app = runtime(config => {
    if (!isStatus(config)) return timeout(config)
    currentUser = 8
    return { data: { state: 'missing' } }
  }, { getUserId: () => currentUser })
  await assert.rejects(app.client.post('/reagent-orders', payload), error => axios.isCancel(error))
  assert.equal(app.calls.length, 2)
})

test('an unsupported status endpoint never causes a speculative write retry', async () => {
  const app = runtime(config => isStatus(config) ? { status: 404, data: {} } : timeout(config))
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('CAS lookup, login, searches and file uploads retain their existing request behavior', async () => {
  const app = runtime(() => ({ data: {} }))
  await app.client.get('/chemical-info/64-17-5', { timeout: 0 })
  await app.client.post('/users/login', { username: 'chemist' })
  await app.client.post('/chem/search/substructure', { query: 'CCO' })
  await app.client.post('/announcements/upload-image', new FormData())
  assert.ok(app.calls.every(config => !id(config)))
  assert.equal(app.calls[0].timeout, 0)
})

test('changing query parameters cannot bypass an unresolved write for the same endpoint', async () => {
  const app = runtime(config => isStatus(config) ? { data: { state: 'running' } } : timeout(config))
  await assert.rejects(app.client.put('/users/8/role', null, { params: { role: 'admin' } }), /获取提交结果超时/)
  await assert.rejects(app.client.put('/users/8/role', null, { params: { role: 'user' } }), /尚未确认/)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('a late response from an older request cannot discard a newer unresolved operation ID', async () => {
  let writes = 0
  let finishFirst
  let firstId
  let resolved = false
  const firstResponse = new Promise(resolve => { finishFirst = resolve })
  const app = runtime(config => {
    if (isStatus(config)) return config.url.endsWith(firstId) || resolved
      ? completed({ id: 42 }) : { data: { state: 'running' } }
    writes++
    if (writes === 1) { firstId = id(config); return firstResponse }
    if (writes === 2) return timeout(config)
    return { data: { id: 42 } }
  })
  const first = app.client.post('/reagent-orders', payload)
  await new Promise(resolve => setImmediate(resolve))
  await app.client.post('/reagent-orders', payload)
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  const newOperationId = id(app.calls.filter(config => !isStatus(config))[1])
  finishFirst({ data: { id: 42 } })
  await first
  resolved = true
  const replay = await app.client.post('/reagent-orders', payload)
  assert.equal(id(replay.config), newOperationId)
  assert.equal(writes, 2)
})

test('a slow result query cannot extend the foreground deadline, and background success is replayed without another write', async () => {
  let finishQuery
  const query = new Promise(resolve => { finishQuery = resolve })
  const app = runtime(config => isStatus(config) ? query : timeout(config), { foregroundMs: 35 })
  const started = Date.now()
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  assert.ok(Date.now() - started < 250)
  assert.ok(Date.now() - started >= 25)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  finishQuery(completed({ id: 42 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(app.notices.some(message => message.includes('已确认上次提交成功')))
  const replay = await app.client.post('/reagent-orders', payload)
  assert.deepEqual(replay.data, { id: 42 })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('a user retry shares its deadline between result lookup and the remaining write', async () => {
  let writes = 0
  let slowLookup = false
  let finishWrite
  const pendingWrite = new Promise(resolve => { finishWrite = resolve })
  const app = runtime(async config => {
    if (isStatus(config)) {
      if (slowLookup) await new Promise(resolve => setTimeout(resolve, 25))
      return { data: { state: 'missing' } }
    }
    if (++writes === 1) return timeout(config)
    return pendingWrite
  }, { foregroundMs: 45 })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  slowLookup = true
  const started = Date.now()
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  assert.ok(Date.now() - started < 150)
  const retry = app.calls.filter(config => !isStatus(config))[1]
  assert.ok(retry.timeout < 35)
  assert.equal(id(retry), id(app.calls[0]))
  finishWrite({ data: { id: 42 } })
})

test('late background results from a previous account do not notify the new account', async () => {
  let currentUser = 7
  let finishQuery
  const query = new Promise(resolve => { finishQuery = resolve })
  const app = runtime(config => isStatus(config) ? query : timeout(config), {
    getUserId: () => currentUser, foregroundMs: 25,
  })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  currentUser = 8
  finishQuery(completed({ id: 42 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(app.notices.length, 0)
})

test('a background validation failure is replayed to the form with its original field errors', async () => {
  let finishQuery
  const query = new Promise(resolve => { finishQuery = resolve })
  const app = runtime(config => isStatus(config) ? query : timeout(config), { foregroundMs: 25 })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  const detail = [{ loc: ['body', 'quantity'], msg: '数量不合法' }]
  finishQuery(completed({ detail }, 422))
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(app.client.post('/reagent-orders', payload), error => {
    assert.equal(error.response.status, 422)
    assert.deepEqual(error.response.data.detail, detail)
    return true
  })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('real HTTP write timeout releases the caller before background confirmation finishes', async context => {
  const { createServer } = await import('node:http')
  let writes = 0
  let ready = false
  const server = createServer((request, response) => {
    if (request.method === 'POST') { writes++; return }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(ready ? completed({ id: 42 }).data : { state: 'committed' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const app = runtime(() => ({}), { foregroundMs: 50 })
  app.client.defaults.adapter = axios.getAdapter('http')
  app.client.defaults.baseURL = `http://127.0.0.1:${server.address().port}`
  const started = Date.now()
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  assert.ok(Date.now() - started < 300)
  ready = true
  await new Promise(resolve => setTimeout(resolve, 80))
  const response = await app.client.post('/reagent-orders', payload)
  assert.deepEqual(response.data, { id: 42 })
  assert.equal(writes, 1)
})

test('clicking submit again after timeout while the first write is still running never starts a second write', async () => {
  let finishWrite
  let finished = false
  const originalWrite = new Promise(resolve => { finishWrite = resolve })
  const app = runtime(config => isStatus(config)
    ? finished ? completed({ id: 42 }) : { data: { state: 'running' } }
    : originalWrite, { foregroundMs: 30 })
  const expectTimeout = error => {
    assert.equal(error.message, '获取提交结果超时，请刷新查看')
    return true
  }
  await assert.rejects(app.client.post('/reagent-orders', payload), expectTimeout)
  const originalId = id(app.calls[0])
  // 按钮恢复后、原业务尚未完成时再次点击，只允许查询原操作。
  const retryStarted = Date.now()
  await assert.rejects(app.client.post('/reagent-orders', payload), expectTimeout)
  assert.ok(Date.now() - retryStarted >= 20)
  assert.ok(Date.now() - retryStarted < 250)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  finished = true
  finishWrite({ status: 201, data: { id: 42 } })
  // 原业务随后成功，再次确认复用原操作号及结果，不能发起第二次新增。
  const result = await app.client.post('/reagent-orders', payload)
  assert.deepEqual(result.data, { id: 42 })
  assert.equal(id(result.config), originalId)
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

for (const state of ['running', 'committed']) {
  test(`a retry waits for a ${state} operation to finish and succeeds on the second click`, async () => {
    let retrying = false
    let retryReads = 0
    const app = runtime(config => {
      if (!isStatus(config)) return new Promise(() => {})
      if (retrying && ++retryReads > 1) return completed({ id: 42 })
      return { data: { state } }
    }, { foregroundMs: 50 })
    await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
    await new Promise(resolve => setImmediate(resolve))
    retrying = true
    const response = await app.client.post('/reagent-orders', payload)
    assert.deepEqual(response.data, { id: 42 })
    assert.equal(id(response.config), id(app.calls[0]))
    assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
    assert.deepEqual(app.notices, [])
  })
}

test('a retry shares the pending background query and consumes its success on the same click', async () => {
  let finishBackground, backgroundStarted
  const backgroundReady = new Promise(resolve => { backgroundStarted = resolve })
  const background = new Promise(resolve => { finishBackground = resolve })
  let reads = 0
  const app = runtime(config => {
    if (!isStatus(config)) return new Promise(() => {})
    reads++
    backgroundStarted()
    return background
  }, { foregroundMs: 80 })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await backgroundReady
  const retry = app.client.post('/reagent-orders', payload)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  finishBackground(completed({ id: 42 }))
  assert.deepEqual((await retry).data, { id: 42 })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  assert.deepEqual(app.notices, [])
})

test('joining a pending background query cannot extend a retry beyond its own foreground deadline', async () => {
  let finishQuery
  const pending = new Promise(resolve => { finishQuery = resolve })
  const app = runtime(config => isStatus(config) ? pending : new Promise(() => {}), { foregroundMs: 45 })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  const started = Date.now()
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  assert.ok(Date.now() - started >= 30)
  assert.ok(Date.now() - started < 250)
  assert.equal(app.calls.filter(isStatus).length, 1)
  finishQuery(completed({ id: 42 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await app.client.post('/reagent-orders', payload)).data, { id: 42 })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

for (const duration of [0, 800]) {
  test(`background queries start at 0, 1 and 3 seconds even when reads take ${duration} ms`, async context => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
    const starts = []
    const app = runtime(async config => {
      if (!isStatus(config)) return new Promise(() => {})
      starts.push(Date.now() - 13000)
      if (duration) await new Promise(resolve => setTimeout(resolve, duration))
      return { data: { state: 'committed' } }
    }, { wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) })
    const submit = assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
    await new Promise(resolve => setImmediate(resolve))
    context.mock.timers.tick(3000)
    await submit
    context.mock.timers.tick(0)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(starts, [0])
    if (duration) {
      context.mock.timers.tick(duration)
      await new Promise(resolve => setImmediate(resolve))
    }
    context.mock.timers.tick(1000 - duration)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(starts, [0, 1000])
    if (duration) {
      context.mock.timers.tick(duration)
      await new Promise(resolve => setImmediate(resolve))
    }
    context.mock.timers.tick(2000 - duration)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(starts, [0, 1000, 3000])
    if (duration) {
      context.mock.timers.tick(duration)
      await new Promise(resolve => setImmediate(resolve))
    }
    context.mock.timers.tick(10000)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(starts, [0, 1000, 3000])
    assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
  })
}

test('a status-query timeout cannot suppress confirmation of a later write within the same foreground budget', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  let writes = 0, retrying = false, retryReads = 0
  const app = runtime(config => {
    if (isStatus(config)) {
      if (retrying && ++retryReads === 1) return new Promise(() => {})
      return writes === 2 ? completed({ id: 42 }) : { data: { state: 'missing' } }
    }
    if (++writes === 1) return timeout(config)
    return { status: 500, data: { detail: 'response lost after commit' } }
  }, {
    foregroundMs: 1500,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  for (const milliseconds of [0, 1000, 2000]) {
    context.mock.timers.tick(milliseconds)
    await new Promise(resolve => setImmediate(resolve))
  }
  retrying = true
  const retry = app.client.post('/reagent-orders', payload).then(
    response => ({ response }), error => ({ error }),
  )
  await new Promise(resolve => setImmediate(resolve))
  context.mock.timers.tick(1000)
  await new Promise(resolve => setImmediate(resolve))
  context.mock.timers.tick(250)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await retry).response?.data, { id: 42 })
  assert.equal(writes, 2)
  const requests = app.calls.filter(config => !isStatus(config))
  assert.equal(id(requests[0]), id(requests[1]))
})

test('an obsolete background round stops once a permitted resend succeeds and releases its receipt', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  let writes = 0
  const app = runtime(config => {
    if (isStatus(config)) return writes === 2 ? completed({ id: 42 }) : { data: { state: 'missing' } }
    if (++writes === 1) return timeout(config)
    return { data: { id: 42 } }
  }, { wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  context.mock.timers.tick(0)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await app.client.post('/reagent-orders', payload)).data, { id: 42 })
  const reads = app.calls.filter(isStatus).length
  for (const milliseconds of [1000, 2000]) {
    context.mock.timers.tick(milliseconds)
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(app.calls.filter(isStatus).length, reads)
  assert.deepEqual(app.notices, [])
})

test('a validation failure completed during retry reaches the form on that same click', async () => {
  let retrying = false
  let reads = 0
  const detail = [{ loc: ['body', 'quantity'], msg: '数量不合法' }]
  const app = runtime(config => {
    if (!isStatus(config)) return new Promise(() => {})
    if (retrying && ++reads > 1) return completed({ detail }, 422)
    return { data: { state: 'running' } }
  }, { foregroundMs: 50 })
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setImmediate(resolve))
  retrying = true
  await assert.rejects(app.client.post('/reagent-orders', payload), error => {
    assert.equal(error.response.status, 422)
    assert.deepEqual(error.response.data.detail, detail)
    return true
  })
  assert.equal(app.calls.filter(config => !isStatus(config)).length, 1)
})

test('real HTTP retry receives an operation that finishes while the second click is waiting', async context => {
  const { createServer } = await import('node:http')
  let writes = 0, retryReads = 0, retrying = false, ready = false, completionTimer
  const server = createServer((request, response) => {
    if (request.method === 'POST') { writes++; return }
    if (retrying && ++retryReads === 1) completionTimer = setTimeout(() => { ready = true }, 30)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(ready ? completed({ id: 42 }).data : { state: 'committed' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    clearTimeout(completionTimer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const app = runtime(() => ({}), {
    foregroundMs: 200,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 10))),
  })
  app.client.defaults.adapter = axios.getAdapter('http')
  app.client.defaults.baseURL = `http://127.0.0.1:${server.address().port}`
  await assert.rejects(app.client.post('/reagent-orders', payload), /获取提交结果超时/)
  await new Promise(resolve => setTimeout(resolve, 50))
  retrying = true
  const response = await app.client.post('/reagent-orders', payload)
  assert.deepEqual(response.data, { id: 42 })
  assert.ok(retryReads > 1)
  assert.equal(writes, 1)
  assert.deepEqual(app.notices, [])
})
