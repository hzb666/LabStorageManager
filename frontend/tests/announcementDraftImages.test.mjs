import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build, transform } from 'esbuild'
import { AxiosError } from 'axios'

const require = createRequire(import.meta.url)
const directory = fileURLToPath(new URL('..', import.meta.url))
const page = readFileSync(new URL('../src/pages/AnnouncementManagement.tsx', import.meta.url), 'utf8')
// Exercise the real action hooks, with network and React scheduling isolated.
const hooks = page.slice(page.indexOf('function useAnnouncementDraftImageActions('), page.indexOf('export function AnnouncementManagement('))
const compiled = await transform(hooks, { loader: 'ts', format: 'cjs' })
const bundle = await build({
  absWorkingDir: directory, tsconfig: 'tsconfig.app.json',
  stdin: { contents: `export { isUnconfirmedMutationError } from '@/lib/mutationRecovery'`, resolveDir: directory },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
})
const module = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports)
const image = '/static/announcements/review.png'

function runtime(error) {
  const state = { form: { title: 'review', content: 'review', images: [image] }, files: new Set([image]), closed: false, removed: [] }
  const actions = new Function('deps', `
    const { useMemo, useCallback, deleteAnnouncementImageUrl, toast, announcementAPI,
      validateAnnouncementForm, getApiErrorMessage, isUnconfirmedMutationError, refreshAfterMutation } = deps;
    ${compiled.code}
    return useAnnouncementDialogActions;
  `)({
    useMemo: factory => factory(), useCallback: callback => callback,
    deleteAnnouncementImageUrl: async url => { state.files.delete(url); state.removed.push(url) },
    toast: { success() {}, error() {} },
    announcementAPI: { create: async (_data, options) => {
      assert.equal(options.mutationScope, 'announcement-draft-1')
      if (error) throw error
      return { data: { id: 1 } }
    } },
    validateAnnouncementForm: () => ({}), getApiErrorMessage: error => error.message,
    isUnconfirmedMutationError: module.exports.isUnconfirmedMutationError,
    refreshAfterMutation: async refresh => refresh(),
  })({
    mutationScope: 'announcement-draft-1', formData: state.form, editingId: null,
    draftUploadedImages: [image], setFormErrors() {}, setFormLoading: () => true,
    setDraftUploadedImages() {}, setDialogState() { state.closed = true }, resetForm() {},
    setFormData(update) { state.form = update(state.form) }, refetchAnnouncements: async () => {},
  })
  return { actions, state }
}

test('cancelling after a write timeout preserves images that the saved announcement may already reference', async () => {
  const app = runtime(new AxiosError('result pending', 'ECONNABORTED'))
  await app.actions.handleSubmit()
  await app.actions.handleCancelForm()
  assert.equal(app.state.closed, true)
  assert.equal(app.state.files.has(image), true)
  assert.deepEqual(app.state.removed, [])
})

test('removing an image from an unresolved form does not delete its physical file', async () => {
  const app = runtime(new AxiosError('result pending', 'ECONNABORTED'))
  await app.actions.handleSubmit()
  await app.actions.handleRemoveImage(image)
  assert.deepEqual(app.state.form.images, [])
  assert.equal(app.state.files.has(image), true)
  assert.deepEqual(app.state.removed, [])
})

test('a definite validation rejection still allows cancelling and cleaning up unused uploads', async () => {
  const error = new AxiosError('validation rejected', 'ERR_BAD_REQUEST', undefined, undefined, { status: 422, headers: {} })
  const app = runtime(error)
  await app.actions.handleSubmit()
  await app.actions.handleCancelForm()
  assert.equal(app.state.files.has(image), false)
  assert.deepEqual(app.state.removed, [image])
})

test('successful submission protects uploaded images before the dialog finishes closing', async () => {
  const app = runtime()
  await app.actions.handleSubmit()
  await app.actions.handleCancelForm()
  assert.equal(app.state.files.has(image), true)
})
