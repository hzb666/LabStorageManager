export type DosingField = 'molecularWeight' | 'density' | 'equivalent' | 'planned' | 'mmol' | 'actual'
export interface DosingValues {
  molecularWeight: string
  density: string
  equivalent: string
  planned: string
  mmol: string
  actual: string
}
export interface DosingState {
  basis: string
  referenceRow: number | null
  rows: DosingValues[]
}

export function removeDosingRow(previous: DosingState, index: number): DosingState {
  if (!Number.isInteger(index) || index < 0 || index >= previous.rows.length) return previous
  let referenceRow = previous.referenceRow
  if (referenceRow === index) referenceRow = null
  else if (referenceRow != null && referenceRow > index) referenceRow--
  return { ...previous, referenceRow, rows: previous.rows.filter((_, rowIndex) => rowIndex !== index) }
}

const MASS_FACTORS: Readonly<Record<string, number>> = {
  mg: 1, g: 1000, kg: 1000000, ug: .001, 毫克: 1, 克: 1000, 千克: 1000000, 微克: .001,
}
const VOLUME_FACTORS: Readonly<Record<string, number>> = {
  ul: 1, ml: 1000, l: 1000000, 微升: 1, 毫升: 1000, 升: 1000000,
}

function positive(value: string): number | null {
  if (!/^[\d.e+-]+$/i.test(value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseQuantity(value: string, defaultUnit: string) {
  const text = value.trim()
  const amount = /^[\d.e+-]+/iu.exec(text)?.[0]
  const number = amount ? Number(amount) : NaN
  if (!amount || !Number.isFinite(number) || number < 0) return null
  const unit = text.slice(amount.length).trim() || defaultUnit
  return { number, unit, normalizedUnit: unit.toLowerCase().replace(/[μµ]/gu, 'u') }
}

function quantityInUnits(value: string, factors: Readonly<Record<string, number>>, defaultUnit: string): number | null {
  const quantity = parseQuantity(value, defaultUnit)
  if (!quantity) return null
  const mass = quantity.number * factors[quantity.normalizedUnit]
  return Number.isFinite(mass) && mass > 0 ? mass : null
}

export function massInMilligrams(value: string): number | null {
  return quantityInUnits(value, MASS_FACTORS, 'mg')
}

function formatVolume(microliters: number): string {
  return microliters >= 10000 ? `${(microliters / 1000).toFixed(2)} mL` : `${microliters.toFixed(2)} μL`
}

export function formatDosingValue(value: string, field: DosingField | 'basis', density = ''): string {
  if (!value.trim()) return ''
  // Density is a measured input: preserve its precision for calculation and printing.
  if (field === 'density') return value.trim()
  if (['basis', 'molecularWeight', 'equivalent', 'mmol'].includes(field)) {
    const number = /^[\d.e+-]+$/i.test(value.trim()) ? Number(value) : NaN
    return Number.isFinite(number) && number >= 0 ? number.toFixed(2) : value
  }
  return formatDosingQuantity(value, positive(density))
}

function formatDosingQuantity(value: string, density: number | null): string {
  const quantity = parseQuantity(value, density == null ? 'mg' : 'μL')
  if (!quantity) return value
  const { number, unit, normalizedUnit } = quantity
  if (density != null) {
    const microliters = MASS_FACTORS[normalizedUnit] != null
      ? number * MASS_FACTORS[normalizedUnit] / density : number * VOLUME_FACTORS[normalizedUnit]
    return Number.isFinite(microliters) ? formatVolume(microliters) : value
  }
  if (['ul', '微升'].includes(normalizedUnit)) return formatVolume(number)
  if (!Object.hasOwn(MASS_FACTORS, normalizedUnit) && !Object.hasOwn(VOLUME_FACTORS, normalizedUnit)) return value
  return ['mg', '毫克'].includes(normalizedUnit) && number > 10000
    ? `${(number / 1000).toFixed(2)} g` : `${number.toFixed(2)} ${unit}`
}

function numberText(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Number(value.toPrecision(8))) : ''
}

function plannedFromMass(row: DosingValues, mass: number): string {
  const density = positive(row.density)
  const amount = numberText(density == null ? mass : mass / density)
  const unit = density == null ? 'mg' : 'μL'
  return amount ? `${amount} ${unit}` : ''
}

function fillFromMmol(row: DosingValues, mmol: number | null) {
  const weight = positive(row.molecularWeight)
  row.mmol = mmol == null ? '' : numberText(mmol)
  row.planned = mmol != null && weight != null ? plannedFromMass(row, mmol * weight) : ''
}

export function updateDosing(
  previous: DosingState, index: number | null, field: DosingField | 'basis', value: string,
): DosingState {
  const state = { ...previous, rows: previous.rows.map(row => ({ ...row })) }
  if (field === 'basis') {
    state.basis = value
    state.referenceRow = null
  } else if (index != null && !updateRow(state, index, field, value)) return state
  const basis = positive(state.basis)
  state.rows.forEach((row, rowIndex) => {
    if (rowIndex === index && field !== 'basis') return
    const equivalent = positive(row.equivalent)
    if (equivalent != null) fillFromMmol(row, basis != null ? basis * equivalent : null)
  })
  return state
}

function updateRow(state: DosingState, index: number, field: DosingField, value: string): boolean {
  const row = state.rows[index]
  switch (field) {
    case 'molecularWeight': {
      const basis = state.basis
      row.molecularWeight = value
      const mmol = positive(row.mmol)
      if (mmol != null) {
        const weight = positive(value)
        row.planned = weight == null ? '' : plannedFromMass(row, mmol * weight)
      } else if (row.planned.trim()) updateAmount(state, index, 'planned', row.planned)
      return state.basis !== basis
    }
    case 'density': {
      const basis = state.basis
      updateDensity(state, index, value)
      return state.basis !== basis
    }
    case 'actual': {
      const unit = positive(row.density) == null ? 'mg' : 'μL'
      const unitless = /^[\d.e+-]+$/iu.test(value.trim()) && parseQuantity(value, unit) != null
      row.actual = unitless ? `${value.trim()} ${unit}` : value
      return false
    }
    case 'equivalent':
      row.equivalent = value
      updateEquivalent(state, index, value)
      return true
    default:
      updateAmount(state, index, field, value)
      return true
  }
}

function updateEquivalent(state: DosingState, index: number, value: string) {
  const row = state.rows[index]
  const equivalent = positive(value)
  const basis = positive(state.basis)
  if (state.referenceRow === index) {
    const mmol = positive(row.mmol)
    state.basis = mmol != null && equivalent != null ? numberText(mmol / equivalent) : ''
  } else fillFromMmol(row, basis != null && equivalent != null ? basis * equivalent : null)
}

function massFromPlanned(row: DosingValues, value: string): number | null {
  const density = positive(row.density)
  if (density != null) {
    const volume = quantityInUnits(value, VOLUME_FACTORS, 'ul')
    const mass = volume == null ? NaN : volume * density
    if (volume != null) return Number.isFinite(mass) && mass > 0 ? mass : null
  }
  return massInMilligrams(value)
}

function mmolFromPlanned(row: DosingValues, value: string): number | null {
  const mass = massFromPlanned(row, value)
  const weight = positive(row.molecularWeight)
  return mass != null && weight != null ? mass / weight : null
}

function updateDensity(state: DosingState, index: number, value: string) {
  const row = state.rows[index]
  const mass = massFromPlanned(row, row.planned)
  row.density = value
  const mmol = positive(row.mmol)
  const weight = positive(row.molecularWeight)
  if (mmol != null && weight != null) row.planned = plannedFromMass(row, mmol * weight)
  else if (mass != null) row.planned = plannedFromMass(row, mass)
  else if (row.planned.trim() && positive(value) != null) updateAmount(state, index, 'planned', row.planned)
}

function updateAmount(state: DosingState, index: number, field: 'planned' | 'mmol', value: string) {
  const row = state.rows[index]
  const basis = positive(state.basis)
  const mmol = field === 'mmol' ? positive(value) : mmolFromPlanned(row, value)
  if (field === 'mmol') fillFromMmol(row, mmol)
  else row.mmol = mmol == null ? '' : numberText(mmol)
  row[field] = value
  if (field === 'planned') setPlannedAmount(row, value)
  if (mmol != null && (basis == null || state.referenceRow === index)) {
    const equivalent = positive(row.equivalent) ?? 1
    row.equivalent = numberText(equivalent)
    state.basis = numberText(mmol / equivalent)
    state.referenceRow = index
  } else {
    // Partial units/scientific notation must not erase an independently entered equivalent.
    if (mmol != null && basis != null) row.equivalent = numberText(mmol / basis)
    if (state.referenceRow === index) state.basis = ''
  }
}

function setPlannedAmount(row: DosingValues, value: string) {
  const mass = massFromPlanned(row, value)
  row.planned = mass != null && positive(row.density) != null ? plannedFromMass(row, mass) : value
}
