import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const result = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  tsconfig: 'tsconfig.app.json',
  entryPoints: ['src/pages/cartimport/cartImportModel.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: { 'import.meta.env': '{}' },
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { detectOrderType, normalizeOrderType, toImportItem, updateImportItemWithDrafts } = compiled.exports
const defaults = {
  reagent: { name: '', cas_number: '', english_name: '', alias: '', category: '', brand: '', specification: '', quantity: 1, order_reason: 'not_stocked', is_hazardous: false, notes: '' },
  consumable: { name: '', english_name: '', product_number: '', specification: '', unit: '', quantity: 1, notes: '' },
}

test('unknown types and missing CAS never default to consumable', () => {
  assert.equal(detectOrderType(''), 'pending')
  assert.equal(detectOrderType('64-17-5'), 'reagent')
  for (const value of [undefined, null, '', 'unknown', 'pending']) {
    assert.equal(normalizeOrderType(value), 'pending')
    assert.equal(toImportItem({ order_type: value }, 0, defaults).order_type, 'pending')
  }
  assert.equal(toImportItem({ order_type: 'consumable' }, 0, defaults).order_type, 'consumable')
})

test('pending items retain basic data and both drafts until the user selects a type', () => {
  const item = toImportItem({ name: '乙醇', quantity: 2, price: 15, is_hazardous: true, order_type: 'pending', suggested_order_type: 'pending' }, 0, defaults)
  const params = { item, reagentDraft: item.reagent_draft, consumableDraft: item.consumable_draft, defaults }
  assert.equal(updateImportItemWithDrafts({ ...params, orderType: 'pending' }), item)
  const reagent = updateImportItemWithDrafts({ ...params, orderType: 'reagent' })
  assert.equal(reagent.order_type, 'reagent')
  assert.equal(reagent.name, '乙醇')
  assert.equal(reagent.is_hazardous, true)
  const consumable = updateImportItemWithDrafts({ ...params, orderType: 'consumable' })
  assert.equal(consumable.order_type, 'consumable')
  assert.equal(consumable.quantity, 2)
  assert.equal(consumable.price, 15)
})

test('explicit pending classification survives loading even with a CAS in the draft', () => {
  const item = toImportItem({ cas_number: '64-17-5', order_type: 'pending', suggested_order_type: 'pending' }, 0, defaults)
  assert.equal(item.order_type, 'pending')
  assert.equal(item.suggested_order_type, 'pending')
})
