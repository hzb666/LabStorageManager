import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

function expression(source, name) {
  let found
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, `Missing ${name}`)
  return ts.transpileModule(`const handler = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText + '\nreturn handler;'
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function until(predicate) { for (let i = 0; i < 40 && !predicate(); i++) await Promise.resolve(); assert.ok(predicate()) }
function bind(code, dependencies) {
  return new Function('deps', `const {${Object.keys(dependencies).join(',')}} = deps;\n${code}`)(dependencies)
}

for (const page of ['Inventory', 'ReagentOrders', 'ConsumableOrders']) {
  const source = ts.createSourceFile(`${page}.tsx`, await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function runtime(fail = false) {
    const refresh = deferred()
    const defaults = { cas_number: '', name: '' }
    const state = { values: { cas_number: '64-17-5', name: '乙醇' }, closed: false, draft: true, events: [], refreshing: false }
    const submit = async () => { if (fail) throw Error('rejected') }
    const deps = {
      dialogState: 'add', editingItem: null, createDraft: {
        clear() { state.draft = false; state.events.push('clear') }, submissionKey: () => 'draft:test',
      },
      form: {
        reset(value) { state.events.push('reset'); if (value) state.values = structuredClone(value) },
        setError() {}, handleSubmit: callback => async () => callback(structuredClone(state.values)),
      },
      defaultInventoryValues: defaults, defaultReagentOrderValues: defaults, defaultConsumableOrderValues: defaults,
      setDialogState(value) { state.closed = value === null; state.events.push('close') },
      setIsSubmitting: () => true, useCallback: fn => fn,
      casController: { clearCASWarning() {} },
      validateInventoryRemainingQuantity: () => true, validateManualStorageLocation: () => true,
      requireManualStorageLocation: false, ensureInventoryRemainingQuantityError() {},
      submitInventoryRequest: submit,
      submitByDialogState: async ({ onCreate, formData }) => onCreate(formData),
      reagentOrderAPI: { create: submit }, consumableOrderAPI: { create: submit },
      createReagentOrderCreatePayload: data => data, createConsumableOrderCreatePayload: data => data,
      createReagentOrderUpdatePayload: data => data, createConsumableOrderUpdatePayload: data => data,
      isOrderResubmittedOnEdit: () => false, getDialogSubmitSuccessMessage: (mode, messages) => messages[mode],
      toast: { success() {}, error() {} }, extractApiErrorDetail: error => error.message,
      toValidationErrors: () => ({}), applyValidationErrors: () => false, normalizeApiErrorMessage: detail => detail,
      refreshAfterMutation: work => work(),
      refreshInventory: () => { state.refreshing = true; state.events.push('refresh'); return refresh.promise },
      refreshOrders: () => { state.refreshing = true; state.events.push('refresh'); return refresh.promise },
    }
    return { state, refresh, deps }
  }

  test(`${page} clears a saved create form before refresh and leaves a later draft alone`, async () => {
    const app = runtime()
    const pending = bind(expression(source, 'handleFormSubmit'), app.deps)()
    await until(() => app.state.refreshing)
    assert.equal(app.state.closed, true)
    assert.equal(app.state.draft, false)
    assert.equal(app.state.values.cas_number, '')
    assert.ok(app.state.events.indexOf('reset') < app.state.events.indexOf('close'))
    app.state.values = { cas_number: '67-64-1', name: '下一条' }
    app.refresh.resolve(); await pending
    assert.equal(app.state.values.cas_number, '67-64-1')
  })

  test(`${page} keeps unsaved input after a failed write and cancel clears the restored defaults`, async () => {
    const app = runtime(true)
    await bind(expression(source, 'handleFormSubmit'), app.deps)()
    assert.equal(app.state.closed, false)
    assert.equal(app.state.draft, true)
    assert.equal(app.state.values.cas_number, '64-17-5')
    bind(expression(source, 'handleCancel'), app.deps)()
    assert.equal(app.state.values.cas_number, '')
    assert.equal(app.state.draft, false)
    assert.deepEqual(app.state.events, ['reset', 'clear', 'close'])
  })
}

const shelf = ts.createSourceFile('CommonShelf.tsx', await readFile(new URL('../src/pages/CommonShelf.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
for (const name of ['executeCommonShelfManualAdd', 'executeCommonShelfGroupEdit', 'executeCommonShelfAddBottles', 'executeCommonShelfRemoveOne', 'executeCommonShelfDeleteGroup']) {
  const node = shelf.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
  const compiled = ts.transpileModule(node.getText(shelf), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  test(`${name} closes the completed dialog before a slow refresh`, async () => {
    const refresh = deferred()
    const state = { closed: false, refreshing: false }
    const api = async () => ({ data: {} })
    const handler = bind(compiled + `\nreturn ${name};`, {
      commonShelfAPI: { manualAdd: api, updateGroup: api, addBottles: api, removeOne: api, deleteGroup: api },
      toast: { success() {}, error() {} }, refreshAfterMutation: work => work(),
      normalizeOptionalText: value => value, normalizeLocationValue: value => value,
      extractApiErrorDetail: error => error.message, applyFormValidationDetail: () => false,
      normalizeApiErrorMessage: detail => detail, getApiErrorMessage: error => error.message,
    })
    const pending = handler({ payload: {}, data: {}, groupKey: 'group', editNeedsMergeConfirm: false,
      setEditNeedsMergeConfirm() {}, setFieldError() {}, onRequireChemicalNameMap() {},
      resetDialogState: () => { state.closed = true },
      refreshCommonShelf: () => { state.refreshing = true; return refresh.promise },
    })
    await until(() => state.refreshing)
    assert.equal(state.closed, true)
    refresh.resolve(); await pending
  })
}

for (const [file, submitName, cancelName] of [
  ['pages/AdminUsers', 'handleCreate', 'handleCancelCreate'],
  ['components/ReagentBrandManagementDialogs', 'handleSubmit', 'resetEditor'],
]) {
  const source = ts.createSourceFile(`${file}.tsx`, await readFile(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function setup(fail = false) {
    const refresh = deferred()
    const defaults = { name: '', username: '' }
    const state = { values: { name: 'a brand', username: 'a user' }, closed: false, draft: true, refreshing: false }
    const create = async () => { if (fail) throw Error('rejected'); return { data: {} } }
    const reset = value => { if (value) state.values = structuredClone(value) }
    const refreshing = () => { state.refreshing = true; return refresh.promise }
    const deps = {
      useCallback: fn => fn, canWrite: true, editingItem: null,
      createDraft: { clear() { state.draft = false }, submissionKey: () => 'draft:test' },
      form: { reset, handleSubmit: callback => async () => callback(structuredClone(state.values)) },
      resetCreateForm: reset, defaultUserValues: defaults, DEFAULT_REAGENT_BRAND_FORM: defaults,
      setDialogState: value => { state.closed = value === null }, setEditorOpen: value => { state.closed = !value }, setEditingItem() {},
      setCreateLoading: () => true, setIsSubmitting: () => true,
      userAdminAPI: { create }, reagentBrandAPI: { create }, refreshBrands: refreshing, refetchUsers: refreshing,
      refreshAfterMutation: work => work(), toast: { success() {}, error() {} },
      getApiErrorMessage: error => error.message, extractApiErrorDetail: error => error.message,
      applyBrandSubmitError: () => false, normalizeApiErrorMessage: detail => detail,
    }
    if (cancelName === 'resetEditor') deps.resetEditor = bind(expression(source, 'resetEditor'), deps)
    return { state, refresh, deps }
  }
  test(`${file} clears successful creates before refresh and preserves failed input`, async () => {
    const app = setup()
    const pending = bind(expression(source, submitName), app.deps)(structuredClone(app.state.values))
    await until(() => app.state.refreshing)
    assert.equal(app.state.closed, true)
    assert.equal(app.state.draft, false)
    assert.equal(app.state.values.name, '')
    app.state.values.name = 'next draft'
    app.refresh.resolve(); await pending
    assert.equal(app.state.values.name, 'next draft')
    const failed = setup(true)
    await bind(expression(source, submitName), failed.deps)(structuredClone(failed.state.values))
    assert.equal(failed.state.closed, false)
    assert.equal(failed.state.draft, true)
    bind(expression(source, cancelName), failed.deps)()
    assert.equal(failed.state.values.name, '')
    assert.equal(failed.state.draft, false)
  })
}
