import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import axios from 'axios'

const require = createRequire(import.meta.url)
const { CancelledError, QueryClient, QueryObserver } = require('@tanstack/react-query')
const directory = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  absWorkingDir: directory,
  tsconfig: 'tsconfig.app.json',
  stdin: {
    contents: `
      import { createElement } from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { MemoryRouter } from 'react-router-dom'
      import { useSubmissionState } from '@/hooks/useSubmissionState'
      import { useFormDraft } from '@/hooks/useFormDraft'
      export { createDraftStore } from '@/hooks/useFormDraft'
      import { Dialog, DialogContent } from '@/components/ui/Dialog'
      import { EditDialogActions } from '@/components/EditDialogActions'
      import { controls } from '@radix-ui/react-dialog'
      export { createSubmissionLock } from '@/hooks/useSubmissionState'
      export { refreshAfterMutation } from '@/lib/mutationRefresh'
      export { createChemicalNameMapWriter } from '@/lib/chemicalNameMapSubmit'
      export { chemicalNameMapAPI } from '@/api/client'
      export { warnings } from '@/lib/toast'
      export function captureSetters(lock) {
        let setters
        function Probe() {
          const [, save] = useSubmissionState(lock)
          const [, remove] = useSubmissionState(lock)
          setters = { save, remove }
          return null
        }
        renderToStaticMarkup(createElement(Probe))
        return setters
      }
      export function renderDialog(busy, open = true) {
        const changes = []
        const markup = renderToStaticMarkup(createElement(Dialog, {
          busy, open, onOpenChange: next => changes.push(next),
        }, createElement(DialogContent, null, createElement('button', null, 'submit'))))
        return { markup, changes, open: controls.root.open, request: controls.root.onOpenChange }
      }
      export function renderActions(props) {
        return renderToStaticMarkup(createElement(EditDialogActions, {
          mode: 'add', onCancel() {}, submitLabelAdd: 'save', submitLabelEdit: 'save',
          isSubmitting: false, ...props,
        }))
      }
      export function captureDraft(form) {
        let draft
        function Probe() { draft = useFormDraft(form); return null }
        renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Probe)))
        return draft
      }
    `,
    loader: 'tsx', resolveDir: directory,
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.env': JSON.stringify({ DEV: false }) },
  plugins: [{
    name: 'toast-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@\/api\/client$/ }, () => ({ path: 'client', namespace: 'api-mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'api-mock' }, () => ({
        contents: 'export const chemicalNameMapAPI = {}',
      }))
      builder.onResolve({ filter: /^@radix-ui\/react-dialog$/ }, () => ({ path: 'dialog', namespace: 'dialog-mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'dialog-mock' }, () => ({ resolveDir: directory, contents: `
        import { createElement, forwardRef } from 'react'
        export const controls = {}
        export function Root({children, ...props}) { controls.root = props; return children }
        export function Portal({children}) { return children }
        export const Content = forwardRef(({forceMount, onOpenAutoFocus, ...props}, ref) => createElement('div', {...props, ref}))
        export function Overlay({forceMount, ...props}) { return createElement('div', props) }
        export const Title = props => createElement('h2', props)
        export const Close = Portal, Trigger = Portal
      ` }))
      builder.onResolve({ filter: /^@\/lib\/toast$/ }, () => ({ path: 'toast', namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: 'export const warnings = []; export const toast = { warning: message => warnings.push(message) }',
      }))
    },
  }],
})

function load() {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  return module.exports
}

test('submission lock rejects reentry before React renders the disabled button', () => {
  const runtime = load()
  const { save } = runtime.captureSetters(runtime.createSubmissionLock())
  assert.equal(save(true), true)
  assert.equal(save(true), false)
  assert.equal(save(false), true)
  assert.equal(save(true), true)
  save(false)
})

test('save and delete are mutually exclusive and an idle action cannot release another action', () => {
  const runtime = load()
  const { save, remove } = runtime.captureSetters(runtime.createSubmissionLock())
  assert.equal(save(true), true)
  assert.equal(remove(true), false)
  assert.equal(remove(false), false)
  assert.equal(remove(true), false)
  assert.equal(save(false), true)
  assert.equal(remove(true), true)
  assert.equal(save(true), false)
  remove(false)
})

test('separate dialogs have independent submission locks', () => {
  const runtime = load()
  const first = runtime.captureSetters()
  const second = runtime.captureSetters()
  assert.equal(first.save(true), true)
  assert.equal(second.save(true), true)
  first.save(false)
  second.save(false)
})

test('failed writes release the lock through finally so the user can correct and resubmit', async () => {
  const runtime = load()
  const { save, remove } = runtime.captureSetters(runtime.createSubmissionLock())
  await assert.rejects(async () => {
    assert.equal(save(true), true)
    try {
      throw new Error('validation rejected')
    } finally {
      save(false)
    }
  }, /validation rejected/)
  assert.equal(remove(true), true)
  remove(false)
})

test('busy dialogs block close requests and disable their native form controls', () => {
  const runtime = load()
  const dialog = runtime.renderDialog(true)
  dialog.request(false)
  assert.deepEqual(dialog.changes, [])
  assert.match(dialog.markup, /<fieldset disabled="" aria-busy="true"/)
})

test('idle dialogs permit close requests and completed operations may close controlled busy dialogs', () => {
  const runtime = load()
  const dialog = runtime.renderDialog(false)
  dialog.request(false)
  assert.deepEqual(dialog.changes, [false])
  assert.doesNotMatch(dialog.markup, /<fieldset disabled/)
  assert.equal(runtime.renderDialog(true, false).open, false)
})

test('business restrictions on saving do not prevent cancelling an idle dialog', () => {
  const markup = load().renderActions({ disableSubmit: true })
  const buttons = markup.match(/<button\b[^>]*>/g)
  assert.doesNotMatch(buttons[0], / disabled=""/)
  assert.match(buttons[1], / disabled=""/)
})

test('both save and cancel are disabled while a deletion is pending', () => {
  const markup = load().renderActions({ isDeleting: true })
  const buttons = markup.match(/<button\b[^>]*>/g)
  assert.match(buttons[0], / disabled=""/)
  assert.match(buttons[1], / disabled=""/)
})

test('refresh waits for completion before the caller can close the dialog', async () => {
  const runtime = load()
  const events = []
  let finish
  const deferred = new Promise(resolve => { finish = resolve })
  const operation = (async () => {
    await runtime.refreshAfterMutation(() => deferred)
    events.push('close')
  })()
  await Promise.resolve()
  assert.deepEqual(events, [])
  finish()
  await operation
  assert.deepEqual(events, ['close'])
  assert.deepEqual(runtime.warnings, [])
})

test('refresh failure after a committed write warns without rethrowing or retrying the write', async () => {
  const runtime = load()
  let writes = 0
  writes += 1
  await runtime.refreshAfterMutation(async () => { throw new Error('refresh unavailable') })
  assert.equal(writes, 1)
  assert.equal(runtime.warnings.length, 1)
  assert.match(runtime.warnings[0], /操作已成功/)
})

test('synchronous refresh errors also preserve the successful business result', async () => {
  const runtime = load()
  await runtime.refreshAfterMutation(() => { throw new Error('sync refresh error') })
  assert.equal(runtime.warnings.length, 1)
})

test('a stalled refresh cannot keep a committed operation locked indefinitely', async () => {
  const runtime = load()
  let failLater
  const pending = new Promise((_, reject) => { failLater = reject })
  await runtime.refreshAfterMutation(() => pending, 10)
  assert.deepEqual(runtime.warnings, [])
  failLater(new Error('late network failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.warnings.length, 1)
  assert.match(runtime.warnings[0], /操作已成功/)
})

test('a refresh that succeeds after the foreground budget never reports failure', async () => {
  const runtime = load()
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  await runtime.refreshAfterMutation(() => pending, 10)
  assert.deepEqual(runtime.warnings, [])
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(runtime.warnings, [])
})

test('superseded query and HTTP cancellations do not warn about refresh failure', async () => {
  const runtime = load()
  for (const error of [new CancelledError(), new axios.CanceledError()]) {
    await runtime.refreshAfterMutation(() => Promise.reject(error))
  }
  assert.deepEqual(runtime.warnings, [])
})

test('a retrying active list can recover after the foreground refresh budget without a false warning', async () => {
  const runtime = load()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 20 } } })
  let calls = 0
  queryClient.setQueryData(['inventory'], { total: 0 })
  const observer = new QueryObserver(queryClient, {
    queryKey: ['inventory'], staleTime: Infinity,
    queryFn: async () => {
      if (++calls === 1) throw new Error('temporary network failure')
      return { total: 1 }
    },
  })
  const unsubscribe = observer.subscribe(() => {})
  try {
    const refresh = queryClient.invalidateQueries({ queryKey: ['inventory'] }, { throwOnError: true })
    await runtime.refreshAfterMutation(() => refresh, 5)
    assert.deepEqual(runtime.warnings, [])
    await refresh
    assert.equal(calls, 2)
    assert.deepEqual(queryClient.getQueryData(['inventory']), { total: 1 })
    assert.deepEqual(runtime.warnings, [])
  } finally {
    unsubscribe()
    queryClient.clear()
  }
})

test('retrying a partial shelf submission reuses the successful CAS creation and updates its existing ID if corrected', async () => {
  const runtime = load()
  const calls = []
  runtime.chemicalNameMapAPI.create = async payload => {
    calls.push(['create', payload])
    return { data: { id: 42, ...payload } }
  }
  runtime.chemicalNameMapAPI.update = async (id, payload) => {
    calls.push(['update', id, payload])
    return { data: { id, ...payload } }
  }
  const writer = runtime.createChemicalNameMapWriter()
  const payload = { cas_number: '64-17-5', name: 'ethanol' }
  await writer.save(null, payload, '64-17-5')
  // 入架步骤失败，弹窗保留；下一次提交从已保存的主数据继续。
  await writer.save(null, payload, '64-17-5')
  assert.equal(calls.length, 1)
  await writer.save(null, { ...payload, name: '乙醇' }, '64-17-5')
  assert.deepEqual(calls[1], ['update', 42, { ...payload, name: '乙醇' }])
  writer.clear(null, '64-17-5')
  await writer.save(null, payload, '64-17-5')
  assert.equal(calls[2][0], 'create')
})

test('a failed CAS save does not become a completed step or prevent a corrected retry', async () => {
  const runtime = load()
  let calls = 0
  runtime.chemicalNameMapAPI.create = async payload => {
    calls++
    if (calls === 1) throw new Error('validation failed')
    return { data: { id: 42, ...payload } }
  }
  const writer = runtime.createChemicalNameMapWriter()
  await assert.rejects(writer.save(null, { name: '' }, 'new'), /validation failed/)
  await writer.save(null, { name: 'ethanol' }, 'new')
  assert.equal(calls, 2)
})

test('a partial shelf retry cannot change the CAS of its already saved master record', async () => {
  const runtime = load()
  const calls = []
  runtime.chemicalNameMapAPI.create = async payload => {
    calls.push(['create', payload])
    return { data: { id: 42, ...payload } }
  }
  runtime.chemicalNameMapAPI.update = async (...args) => { calls.push(['update', ...args]) }
  const writer = runtime.createChemicalNameMapWriter()
  const original = { cas_number: '64-17-5', name: 'ethanol' }
  assert.equal(writer.hasSaved(null, '64-17-5'), false)
  await writer.save(null, original, '64-17-5')
  assert.equal(writer.hasSaved(null, '64-17-5'), true)
  await assert.rejects(writer.save(null, { cas_number: '67-56-1', name: 'methanol' }, '64-17-5'), /CAS 主数据已保存/)
  assert.equal(calls.length, 1)
  await writer.save(null, original, '64-17-5')
  assert.equal(calls.length, 1)
})

test('draft submission identities survive dismissal and rotate only when that draft is cleared', () => {
  const { createDraftStore } = load()
  const first = createDraftStore()
  const second = createDraftStore()
  const original = first.submissionKey('record-1')
  first.save({ name: 'ethanol' }, 'record-1')
  assert.equal(first.submissionKey('record-1'), original)
  assert.notEqual(first.submissionKey('record-2'), original)
  assert.notEqual(second.submissionKey('record-1'), original)
  first.clear('record-2')
  assert.equal(first.submissionKey('record-1'), original)
  first.clear('record-1')
  assert.notEqual(first.submissionKey('record-1'), original)
})

test('incidental dismissal preserves create input across intervening edits', () => {
  const runtime = load()
  const defaults = { name: '', notes: { text: '' } }
  let values = { name: 'new chemical', notes: { text: 'draft note' } }
  const draft = runtime.captureDraft({ getValues: () => values, reset: next => { values = structuredClone(next) } })
  draft.save()
  values.notes.text = 'edited row'
  values = { name: 'existing chemical', notes: { text: 'original record' } }
  draft.restore(defaults)
  assert.deepEqual(values, { name: 'new chemical', notes: { text: 'draft note' } })
  draft.clear()
  draft.restore(defaults)
  assert.deepEqual(values, defaults)
})

test('drafts are isolated by record and by page lifetime, without persistent storage', () => {
  const { createDraftStore } = load()
  const page = createDraftStore()
  page.save({ name: 'first', images: ['uploaded.png'] }, 'first')
  page.save({ name: 'second' }, 'second')
  const reopened = page.load('first')
  reopened.images.push('changed.png')
  assert.deepEqual(page.load('first').images, ['uploaded.png'])
  page.clear('first')
  assert.equal(page.load('first'), undefined)
  assert.deepEqual(page.load('second'), { name: 'second' })
  assert.equal(createDraftStore().load('second'), undefined)
})
