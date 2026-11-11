import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/lib/procedureReportCalculations.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { formatDosingValue, massInMilligrams, removeDosingRow, updateDosing } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const initial = () => ({ basis: '', referenceRow: null, rows: ['46.069', '58.08', ''].map(molecularWeight => ({
  molecularWeight, density: '', equivalent: '', planned: '', mmol: '', actual: '',
})) })

test('editing molecular weight preserves mmol, scale, density and actual amounts', () => {
  let state = updateDosing(initial(), 0, 'mmol', '1.234567891234')
  state = updateDosing(state, 0, 'density', '0.8')
  state = updateDosing(state, 0, 'actual', '100 μL')
  state = updateDosing(state, 1, 'equivalent', '2')
  const previous = state
  state = updateDosing(state, 0, 'molecularWeight', '100.12345')
  assert.equal(state.rows[0].molecularWeight, '100.12345')
  assert.equal(state.rows[0].mmol, previous.rows[0].mmol)
  assert.equal(state.rows[0].actual, '100 μL')
  assert.equal(state.basis, previous.basis)
  assert.equal(state.referenceRow, previous.referenceRow)
  assert.deepEqual(state.rows[1], previous.rows[1])
  assert.ok(Math.abs(Number.parseFloat(state.rows[0].planned) - Number(state.rows[0].mmol) * 100.12345 / .8) < .00001)
  assert.equal(previous.rows[0].molecularWeight, '46.069')
  assert.equal(formatDosingValue(state.rows[0].molecularWeight, 'molecularWeight'), '100.12')
})

test('a manually supplied weight resolves pending mass or volume and recalculates the scale', () => {
  for (const [planned, density] of [['100 mg', ''], ['125 μL', '0.8']]) {
    let state = initial()
    state.rows[2].equivalent = '2'
    state.rows[1].equivalent = '1'
    state = updateDosing(state, 2, 'density', density)
    state = updateDosing(state, 2, 'planned', planned)
    state = updateDosing(state, 2, 'molecularWeight', '50')
    assert.equal(state.rows[2].mmol, '2')
    assert.equal(state.basis, '1')
    assert.equal(state.referenceRow, 2)
    assert.equal(state.rows[1].planned, '58.08 mg')
  }
})

test('cleared or invalid weights never calculate amounts and valid re-entry restores them', () => {
  const previous = updateDosing(initial(), 0, 'mmol', '1')
  for (const weight of ['', '0', '-1', 'NaN', 'Infinity', '1e999', '50 g/mol']) {
    let state = updateDosing(previous, 0, 'molecularWeight', weight)
    assert.equal(state.rows[0].molecularWeight, weight)
    assert.equal(state.rows[0].planned, '')
    assert.equal(state.rows[0].mmol, '1')
    assert.equal(state.basis, previous.basis)
    state = updateDosing(state, 0, 'molecularWeight', '50')
    assert.equal(state.rows[0].planned, '50 mg')
    assert.equal(state.basis, previous.basis)
    const pending = updateDosing(updateDosing(initial(), 2, 'planned', '100 mg'), 2, 'molecularWeight', weight)
    assert.equal(pending.rows[2].mmol, '')
    assert.equal(pending.basis, '')
  }
})

test('mass units and scientific notation convert to mg; volume and invalid values stay unconverted', () => {
  for (const [value, mg] of [['1 g', 1000], ['2e-3 kg', 2000], ['500 μg', .5], ['500 ug', .5], ['2毫克', 2], ['2', 2]]) {
    assert.equal(massInMilligrams(value), mg)
  }
  for (const value of ['2 mL', '10%', '-1 g', 'Infinity', '1e999 g', '2 g junk', '']) {
    assert.equal(massInMilligrams(value), null)
  }
})

test('a mass establishes a one-equivalent reference and recalculates other rows when changed', () => {
  let state = updateDosing(initial(), 0, 'planned', '46.069 mg')
  assert.equal(state.basis, '1')
  assert.equal(state.rows[0].mmol, '1')
  assert.equal(state.rows[0].equivalent, '1')
  state = updateDosing(state, 1, 'equivalent', '2')
  assert.equal(state.rows[1].mmol, '2')
  assert.equal(state.rows[1].planned, '116.16 mg')
  state = updateDosing(state, 0, 'planned', '92.138 mg')
  assert.equal(state.rows[1].mmol, '4')
  assert.equal(state.rows[1].planned, '232.32 mg')
})

test('explicit basis, mmol and equivalents work without a known molecular weight', () => {
  let state = updateDosing(initial(), null, 'basis', '3')
  state = updateDosing(state, 2, 'equivalent', '2')
  assert.equal(state.rows[2].mmol, '6')
  assert.equal(state.rows[2].planned, '')
  state = updateDosing(state, 2, 'mmol', '9')
  assert.equal(state.rows[2].equivalent, '3')
  state = updateDosing(state, 2, 'actual', '10 mL')
  assert.equal(state.rows[2].actual, '10 mL')
  assert.equal(state.basis, '3')
})

test('unconvertible quantities clear computed amounts without erasing independent equivalents', () => {
  let state = updateDosing(initial(), 0, 'mmol', '1')
  state = updateDosing(state, 1, 'equivalent', '2')
  state = updateDosing(state, 0, 'planned', '5 mL')
  assert.equal(state.rows[0].planned, '5 mL')
  assert.equal(state.rows[0].mmol, '')
  assert.equal(state.rows[0].equivalent, '1')
  assert.equal(state.basis, '')
  assert.equal(state.rows[1].mmol, '')
  assert.equal(state.rows[1].planned, '')
})

test('typing units or scientific notation preserves the original reference equivalent', () => {
  for (const text of ['80 mg', '8e-2 g', '0.1 mL']) {
    const previous = initial()
    previous.rows[0].equivalent = '2'
    previous.rows[1].equivalent = '1'
    if (text.includes('mL')) previous.rows[0].density = '0.8'
    let typed = previous
    for (let length = 1; length <= text.length; length++) {
      typed = updateDosing(typed, 0, 'planned', text.slice(0, length))
      assert.equal(typed.rows[0].equivalent, '2', text.slice(0, length))
    }
    assert.deepEqual(typed, updateDosing(previous, 0, 'planned', text))
    assert.ok(Math.abs(Number(typed.rows[1].mmol) - 40 / 46.069) < .000001)
  }
})

test('clearing and retyping reference amounts keeps equivalents and actual records', () => {
  const previous = initial()
  previous.rows[0].equivalent = '2'
  previous.rows[1].equivalent = '1'
  let state = updateDosing(previous, 0, 'planned', '80 mg')
  state = updateDosing(state, 1, 'actual', '35 mg')
  for (const field of ['planned', 'mmol']) {
    state = updateDosing(state, 0, field, '')
    assert.equal(state.basis, '')
    assert.equal(state.rows[0].equivalent, '2')
    assert.equal(state.rows[1].mmol, '')
    assert.equal(state.rows[1].actual, '35 mg')
    state = updateDosing(state, 0, field, field === 'planned' ? '80 mg' : '2')
    assert.equal(state.rows[0].equivalent, '2')
    assert.ok(Number(state.rows[1].mmol) > 0)
  }
})

test('entering density after a pending volume respects prefilled equivalents', () => {
  const previous = initial()
  previous.rows[0].equivalent = '2'
  previous.rows[1].equivalent = '1'
  let state = updateDosing(previous, 0, 'planned', '100 μL')
  assert.equal(state.rows[0].equivalent, '2')
  assert.equal(state.rows[0].mmol, '')
  state = updateDosing(state, 0, 'density', '0.8')
  assert.ok(Math.abs(Number(state.basis) - 40 / 46.069) < .000001)
  assert.equal(state.rows[0].equivalent, '2')
  assert.ok(Math.abs(Number(state.rows[1].mmol) - Number(state.basis)) < .000001)
})

test('prefilled equivalents set the correct basis when the user enters the first mass', () => {
  const previous = initial()
  previous.rows[0].equivalent = '1.5'
  previous.rows[1].equivalent = '2'
  const state = updateDosing(previous, 0, 'planned', '69.1035 mg')
  assert.equal(state.basis, '1')
  assert.equal(state.rows[0].equivalent, '1.5')
  assert.equal(state.rows[1].mmol, '2')
  assert.equal(state.rows[1].planned, '116.16 mg')
})

test('display uses two decimals and changes mg to g only above 10000 mg', () => {
  for (const [raw, formatted] of [
    ['9999.995 mg', '10000.00 mg'], ['10000 mg', '10000.00 mg'],
    ['10000.01 mg', '10.00 g'], ['15000', '15.00 g'], ['1.234 g', '1.23 g'],
    ['2.346 mL', '2.35 mL'], ['0 mL', '0.00 mL'], ['', ''],
    ['按实际情况填写', '按实际情况填写'], ['Infinity mg', 'Infinity mg'],
  ]) assert.equal(formatDosingValue(raw, 'planned'), formatted)
  assert.equal(formatDosingValue('1.23456', 'mmol'), '1.23')
  assert.equal(formatDosingValue('2', 'equivalent'), '2.00')
})

test('display rounding does not change the precision used for dependent dosing calculations', () => {
  let state = updateDosing(initial(), 0, 'planned', '69.1035 mg')
  assert.equal(formatDosingValue(state.rows[0].mmol, 'mmol'), '1.50')
  state = updateDosing(state, 1, 'equivalent', '2')
  assert.equal(state.rows[1].planned, '174.24 mg')
  assert.equal(state.basis, '1.5')
})

test('density converts planned mass to volume while preserving mmol and reference scale', () => {
  let state = updateDosing(initial(), 0, 'planned', '46.069 mg')
  state = updateDosing(state, 1, 'equivalent', '2')
  state = updateDosing(state, 0, 'density', '0.7893')
  assert.equal(state.rows[0].mmol, '1')
  assert.equal(state.basis, '1')
  assert.equal(formatDosingValue(state.rows[0].planned, 'planned', state.rows[0].density), '58.37 μL')
  assert.equal(state.rows[1].planned, '116.16 mg')
  state = updateDosing(state, 0, 'density', '0.8')
  assert.equal(formatDosingValue(state.rows[0].planned, 'planned', state.rows[0].density), '57.59 μL')
  assert.equal(state.rows[0].mmol, '1')
  state = updateDosing(state, 0, 'density', '')
  assert.equal(state.rows[0].planned, '46.069 mg')
  assert.equal(state.basis, '1')
  state = updateDosing(state, 0, 'mmol', '1.234567891234')
  state = updateDosing(state, 0, 'density', '0.7893')
  assert.equal(state.rows[0].mmol, '1.234567891234')
})

test('explicit volume and unitless microliters use the entered density to establish a reference', () => {
  let state = updateDosing(initial(), 0, 'density', '0.8')
  state = updateDosing(state, 0, 'equivalent', '1.5')
  state = updateDosing(state, 0, 'planned', '0.1 mL')
  assert.equal(state.rows[0].planned, '100 μL')
  assert.ok(Math.abs(Number(state.rows[0].mmol) - 80 / 46.069) < .000001)
  assert.ok(Math.abs(Number(state.basis) - 80 / 46.069 / 1.5) < .000001)
  state = updateDosing(state, 0, 'planned', '200')
  assert.equal(state.rows[0].planned, '200 μL')
  assert.ok(Math.abs(Number(state.rows[0].mmol) - 160 / 46.069) < .000001)
})

test('density can resolve a pending volume but cannot invent an unknown molecular weight', () => {
  let state = updateDosing(initial(), 0, 'planned', '100 μL')
  assert.equal(state.rows[0].mmol, '')
  state = updateDosing(state, 0, 'density', '0.8')
  assert.ok(Number(state.rows[0].mmol) > 0)
  assert.ok(Number(state.basis) > 0)
  state = updateDosing(initial(), 2, 'planned', '80 mg')
  state = updateDosing(state, 2, 'density', '0.8')
  assert.equal(state.rows[2].planned, '100 μL')
  assert.equal(state.rows[2].mmol, '')
})

test('invalid density never guesses a conversion or changes an established reference', () => {
  for (const density of ['0', '-1', 'NaN', 'Infinity', '1e999', '0.8 g/mL']) {
    let state = updateDosing(initial(), 0, 'mmol', '1')
    state = updateDosing(state, 0, 'density', density)
    assert.equal(state.rows[0].planned, '46.069 mg')
    assert.equal(state.rows[0].mmol, '1')
    assert.equal(state.basis, '1')
  }
})

test('volume display changes at exactly 10000 microliters and density precision is preserved', () => {
  assert.equal(formatDosingValue('9999.99 μL', 'planned'), '9999.99 μL')
  assert.equal(formatDosingValue('10000 μL', 'planned'), '10.00 mL')
  assert.equal(formatDosingValue('12000 uL', 'actual'), '12.00 mL')
  assert.equal(formatDosingValue('10000 mg', 'planned', '0.8'), '12.50 mL')
  assert.equal(formatDosingValue('0.7893', 'density'), '0.7893')
})

test('actual amounts preserve their entered quantity across density changes and never set the scale', () => {
  let state = updateDosing(initial(), 0, 'density', '0.8')
  state = updateDosing(state, 0, 'actual', '100')
  assert.equal(state.rows[0].actual, '100 μL')
  state = updateDosing(state, 0, 'density', '')
  assert.equal(formatDosingValue(state.rows[0].actual, 'actual', state.rows[0].density), '100.00 μL')
  assert.equal(state.basis, '')
  state = updateDosing(state, 0, 'actual', '80 mg')
  state = updateDosing(state, 0, 'density', '0.8')
  assert.equal(formatDosingValue(state.rows[0].actual, 'actual', state.rows[0].density), '100.00 μL')
  assert.equal(state.basis, '')
  state = updateDosing(state, 0, 'actual', '0')
  state = updateDosing(state, 0, 'density', '')
  assert.equal(state.rows[0].actual, '0 μL')
})

test('deleting the reference reagent preserves the established scale and other entered amounts', () => {
  let state = updateDosing(initial(), 0, 'planned', '46.069 mg')
  state = updateDosing(state, 1, 'equivalent', '2')
  state = updateDosing(state, 1, 'density', '0.8')
  state = updateDosing(state, 1, 'actual', '100 μL')
  const previous = state
  state = removeDosingRow(state, 0)
  assert.equal(previous.rows.length, 3)
  assert.equal(state.rows.length, 2)
  assert.equal(state.basis, '1')
  assert.equal(state.referenceRow, null)
  assert.equal(state.rows[0].mmol, '2')
  assert.equal(state.rows[0].density, '0.8')
  assert.equal(state.rows[0].actual, '100 μL')
  state = updateDosing(state, 0, 'mmol', '4')
  assert.equal(state.basis, '1')
  assert.equal(state.rows[0].equivalent, '4')
})

test('deleting a preceding row keeps the surviving reference linked to its own inputs', () => {
  let state = updateDosing(initial(), 2, 'mmol', '3')
  state = updateDosing(state, 1, 'equivalent', '2')
  state = removeDosingRow(state, 0)
  assert.equal(state.referenceRow, 1)
  state = updateDosing(state, 1, 'mmol', '6')
  assert.equal(state.basis, '6')
  assert.equal(state.rows[0].mmol, '12')
  assert.equal(removeDosingRow(state, -1), state)
  assert.equal(removeDosingRow(state, 100), state)
})
