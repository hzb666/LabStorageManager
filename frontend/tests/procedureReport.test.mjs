import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const directory = fileURLToPath(new URL('..', import.meta.url))
const { outputFiles } = await build({
  absWorkingDir: directory,
  entryPoints: ['src/lib/procedureReport.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const reportModule = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const { buildProcedureDosingRows, buildProcedureReportHtml, buildProcedureReportRequest, formatReportLocation } = reportModule

const result = {
  formatted_text: '1. 加入乙醇。\n\n2. 加入试剂，搅拌。',
  analysis_items: [
    { name: '乙醇', status: 'resolved', cas_number: '64-17-5', cas_numbers: ['64-17-5'] },
    { name: 'ethanol', status: 'resolved', cas_number: '64-17-5' },
    { name: '试剂候选', status: 'resolved', cas_numbers: ['67-64-1', '7732-18-5'] },
    { name: '通用溶剂', status: 'common' },
    { name: '未知物料', status: 'unresolved' },
  ],
}
const report = {
  generated_at: '2026-10-28T08:00:00Z',
  compounds: [
    { cas_number: '64-17-5', molecular_formula: 'C2H6O', molecular_weight: 46.069 },
    { cas_number: '67-64-1', molecular_formula: 'C3H6O', molecular_weight: 58.08 },
  ],
  inventory_groups: [{
    cas_number: '64-17-5', items: [{
      id: 123, cas_number: '64-17-5', name: '乙醇', brand: 'Sigma', storage_location: 'A1',
      remaining_quantity: 0, initial_quantity: 500, unit: 'mL', specification: '500 mL',
      notes: 'PRIVATE NOTE NOT NEEDED',
    }],
  }, { cas_number: '7732-18-5', items: [] }],
}

test('one request merges aliases for repeated common lookup names instead of overwriting them', () => {
  const data = { analysis_items: [
    { name: '乙醇', chinese_name: '乙醇', pubchem_query_name: 'ethanol', status: 'common' },
    { name: 'EtOH', pubchem_query_name: 'ethanol', status: 'common' },
    { name: ' alcohol ', chinese_name: '乙醇', pubchem_query_name: 'ethanol', status: 'common' },
    { name: 'compound 3a', status: 'generic', cas_number: '64-17-5' },
  ] }
  assert.deepEqual(buildProcedureReportRequest(data), {
    cas_numbers: [], names: ['ethanol'], name_aliases: { ethanol: ['乙醇', 'EtOH', 'alcohol'] },
  })
})

test('a common reagent with resolved CAS uses that identity without repeating a name query', () => {
  const data = { analysis_items: [{
    name: 'EtOH', chinese_name: '乙醇', status: 'common', pubchem_query_name: 'ethanol',
    cas_number: '64-17-5', cas_numbers: ['64-17-5'],
  }, { name: 'brine', status: 'generic' }] }
  assert.deepEqual(buildProcedureReportRequest(data), {
    cas_numbers: ['64-17-5'], names: [], name_aliases: {},
  })
  const rows = buildProcedureDosingRows(data, report)
  assert.equal(rows[0].molecularWeight, 46.069)
  assert.deepEqual(rows[0].casNumbers, ['64-17-5'])
  assert.equal(rows[1].name, 'brine')
  assert.equal(rows[1].molecularWeight, null)
})

test('solutions retain their names and stay separate from pure component dosing rows', () => {
  const data = { analysis_items: [{
    name: 'brine', chinese_name: '盐水', status: 'common', is_mixture: true,
    pubchem_query_name: 'sodium chloride', cas_number: '7647-14-5',
  }, {
    name: 'sodium chloride', status: 'common', cas_number: '7647-14-5',
  }, {
    name: 'aqueous sodium chloride', status: 'common', is_mixture: true,
    pubchem_query_name: 'sodium chloride', cas_number: '7647-14-5',
  }] }
  const molecularData = { inventory_groups: [], compounds: [{
    cas_number: '7647-14-5', chinese_name: '氯化钠', molecular_weight: 58.443,
  }] }
  const rows = buildProcedureDosingRows(data, molecularData)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(row => row.name), ['盐水', '氯化钠', 'aqueous sodium chloride'])
  assert.deepEqual(rows.map(row => row.molecularWeight), [null, 58.443, null])
  assert.deepEqual(buildProcedureReportRequest(data), {
    cas_numbers: ['7647-14-5'], names: [], name_aliases: {},
  })
})

test('already known Chinese names avoid scanning all bottles for every rendered row', () => {
  let visits = 0
  const items = Array.from({ length: 1000 }, () => ({ ...report.inventory_groups[0].items[0] }))
  Object.defineProperty(items, 'map', { value(...args) {
    visits += this.length
    return Array.prototype.map.apply(this, args)
  } })
  const data = { ...report, compounds: [{ ...report.compounds[0], chinese_name: '乙醇' }],
    inventory_groups: [{ cas_number: '64-17-5', items }] }
  const html = buildProcedureReportHtml({ result, report: data, author: '' }, '')
  assert.equal((html.match(/data-delete-report-row/g) || []).length, 1004)
  assert.ok(visits < 10000, `inventory element visits: ${visits}`)
})

test('dosing rows merge aliases but retain common and unidentified reagents', () => {
  const rows = buildProcedureDosingRows(result, report)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].molecularWeight, 46.069)
  assert.equal(rows[2].name, '未知物料')
  assert.equal(rows[2].molecularWeight, null)
  assert.equal(rows.at(-1).name, '通用溶剂')
})

test('candidate CAS values never silently select the first candidate mass', () => {
  const row = buildProcedureDosingRows(result, report)[1]
  assert.equal(row.molecularWeight, null)
  assert.deepEqual(buildProcedureReportRequest(result).cas_numbers, ['64-17-5', '67-64-1', '7732-18-5'])
})

for (const stocked of [[], [2], [0, 2]]) {
  test(`candidate inventory rows keep found bottles or one preferred missing CAS: ${stocked}`, () => {
    const candidates = ['109-02-4', '17508-17-7', '68-12-2']
    const input = { ...result, analysis_items: [{
      name: '候选试剂', status: 'resolved', cas_number: candidates[1], cas_numbers: candidates,
    }] }
    const data = { ...report, compounds: [], inventory_groups: candidates.map((cas, index) => ({
      cas_number: cas, items: stocked.includes(index) ? [0, 1].map(bottle => ({
        ...report.inventory_groups[0].items[0], cas_number: cas, id: index * 2 + bottle,
        name: '库存试剂', storage_location: `位置${index}-${bottle}`,
      })) : [],
    })) }
    const html = buildProcedureReportHtml({ result: input, report: data, author: '' }, '')
    const inventory = html.split('data-report-table="inventory"')[1].split('</table>')[0]
    const body = inventory.split('<tbody>')[1].split('</tbody>')[0]
    assert.equal((body.match(/<tr[ >]/g) || []).length, stocked.length ? stocked.length * 2 : 1)
    assert.equal((body.match(/未找到库存/g) || []).length, stocked.length ? 0 : 1)
    candidates.forEach((cas, index) => {
      const displayed = stocked.length ? stocked.includes(index) : index === 1
      assert.equal(body.includes(cas), displayed)
      assert.equal(body.includes(`<td>${cas} 等</td>`), displayed)
    })
    assert.deepEqual(buildProcedureReportRequest(input).cas_numbers, candidates)
    assert.equal(buildProcedureDosingRows(input, data)[0].molecularWeight, null)
  })
}

test('overlapping candidates do not label an available reagent as missing for another reagent', () => {
  const a = '109-02-4', b = '17508-17-7', c = '68-12-2'
  const input = { ...result, analysis_items: [
    { name: '已命中试剂', status: 'resolved', cas_numbers: [a, b] },
    { name: '未命中试剂', status: 'resolved', cas_number: a, cas_numbers: [a, c] },
    { name: '未命中别名', status: 'resolved', cas_number: a, cas_numbers: [a, c] },
  ] }
  const data = { ...report, compounds: [], inventory_groups: [
    { cas_number: a, items: [] },
    { cas_number: b, items: [{ ...report.inventory_groups[0].items[0], cas_number: b }] },
    { cas_number: c, items: [] },
  ] }
  const html = buildProcedureReportHtml({ result: input, report: data, author: '' }, '')
  const inventory = html.split('data-report-table="inventory"')[1].split('</table>')[0]
  const missing = inventory.match(/<tr class="unavailable">([\s\S]*?)<\/tr>/g) || []
  assert.equal(missing.length, 1)
  assert.ok(missing[0].includes('未命中试剂'))
  assert.ok(missing[0].includes('未命中别名'))
  assert.ok(!missing[0].includes('已命中试剂'))
  assert.ok(!inventory.includes(c))
})

test('common reagents receive molecular mass even though they were skipped by inventory search', () => {
  const common = { ...result, analysis_items: [{ name: '乙醇', pubchem_query_name: 'ethanol', status: 'common' }] }
  const data = { ...report, compounds: [{
    cas_number: '64-17-5', query_name: 'ethanol', molecular_formula: 'C2H6O', molecular_weight: 46.069,
  }] }
  const row = buildProcedureDosingRows(common, data)[0]
  assert.deepEqual(row.casNumbers, ['64-17-5'])
  assert.equal(row.molecularWeight, 46.069)
})

test('report preserves procedure paragraphs, zero quantities, missing inventory and handwriting cells', () => {
  const html = buildProcedureReportHtml({ result, report, author: '实验员' }, '')
  assert.ok(html.includes(result.formatted_text))
  assert.ok(html.includes('<td>0.00 mL / 500.00 mL</td>'))
  assert.ok(html.includes('未找到库存'))
  assert.ok(html.includes('计划投料'))
  assert.ok(html.includes('contenteditable="plaintext-only"'))
  assert.ok(!html.includes('PRIVATE NOTE NOT NEEDED'))
  assert.ok(html.includes('<th>剩余/规格</th>'))
  assert.ok(html.includes('<thead><tr><th>名称</th><th>CAS</th>'))
  assert.ok(html.includes('title="乙醇">乙醇</strong>'))
  assert.ok(html.includes('data-delete-report-row'))
  assert.ok(!html.includes('质量 / 体积'))
  assert.ok(!html.includes('placeholder="mg'))
  assert.ok(html.indexOf('<th>物质的量') < html.indexOf('<th>计划投料'))
})

test('all user and external text is escaped rather than treated as report HTML', () => {
  const injection = '<img src=x onerror="alert(1)">'
  const unsafeResult = { ...result, formatted_text: injection, analysis_items: [{
    name: injection, status: 'unresolved',
  }] }
  const unsafeReport = { ...report, inventory_groups: [{ cas_number: '64-17-5', items: [{
    ...report.inventory_groups[0].items[0], name: injection, brand: injection, storage_location: injection,
  }] }] }
  const html = buildProcedureReportHtml({ result: unsafeResult, report: unsafeReport, author: injection }, '')
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'))
})

test('report places inventory before editable procedure and keeps a local reset control', () => {
  const html = buildProcedureReportHtml({ result, report, author: '实验员' }, '')
  assert.ok(html.indexOf('<h2>库存核对</h2>') < html.indexOf('<h2>实验步骤</h2>'))
  assert.ok(html.indexOf('<h2>实验步骤</h2>') < html.indexOf('<h2>投料记录</h2>'))
  assert.ok(html.includes('data-report-text="procedure" contenteditable="plaintext-only" aria-label="实验步骤"'))
  assert.ok(html.includes('id="reset-report"'))
})

test('ChemicalBook lookup uses a unique CAS and never guesses for candidates or unnamed materials', () => {
  const html = buildProcedureReportHtml({ result, report, author: '' }, '')
  const dosing = html.split('data-report-table="dosing"')[1].split('</table>')[0]
  const links = [...dosing.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  assert.deepEqual(links, ['https://www.chemicalbook.com/CAS_64-17-5.htm'])
  assert.ok(dosing.includes('target="_blank" rel="noopener noreferrer"'))
  assert.equal((dosing.match(/aria-disabled="true"/g) || []).length, 3)
  assert.ok(dosing.indexOf('data-search-report-row') < dosing.indexOf('data-delete-report-row'))
  const unsafe = { ...result, analysis_items: [{ name: '未知', status: 'resolved', cas_number: '64-17-5" onclick="alert(1)' }] }
  const unsafeHtml = buildProcedureReportHtml({ result: unsafe, report: { ...report, inventory_groups: [] }, author: '' }, '')
  assert.ok(!unsafeHtml.includes('href='))
})

test('inventory quantities keep missing units and unknown specifications without inventing mg', () => {
  const data = { ...report, inventory_groups: [{ cas_number: '64-17-5', items: [{
    ...report.inventory_groups[0].items[0], unit: null, specification: '500', remaining_quantity: 12.34,
  }] }] }
  const html = buildProcedureReportHtml({ result, report: data, author: '' }, '')
  assert.ok(html.includes('<td>12.34 / 500.00</td>'))
  assert.ok(!html.split('data-report-table="inventory"')[1].split('</table>')[0].includes('mg'))
})

test('physical location identifies borrowed and temporarily kept bottles', () => {
  assert.equal(formatReportLocation({ status: 'borrowed', storage_location: 'A1', borrower_name: '张三' }), '借用中 · 张三')
  assert.equal(formatReportLocation({ storage_location: null, temporary_keeper_name: '李四' }), '暂存 · 李四')
})

test('all candidate masses must exist and agree before displaying a shared molecular weight', () => {
  const data = { ...report, compounds: [
    { cas_number: '67-64-1', molecular_formula: 'C3H6O', molecular_weight: 58.08 },
    { cas_number: '7732-18-5', molecular_formula: 'C3H6O', molecular_weight: 58.08 },
  ] }
  const row = buildProcedureDosingRows(result, data)[1]
  assert.equal(row.molecularWeight, 58.08)
  data.compounds[1].molecular_weight = 18.015
  assert.equal(buildProcedureDosingRows(result, data)[1].molecularWeight, null)
})

test('reports keep CAS in inventory and use Chinese names with an editable density column in dosing', () => {
  const data = { ...report, compounds: [{ ...report.compounds[0], chinese_name: '无水乙醇' }] }
  const english = { ...result, analysis_items: [
    { name: 'ethanol', status: 'resolved', cas_number: '64-17-5' },
    { name: 'THF', chinese_name: '四氢呋喃', status: 'common' },
  ] }
  const rows = buildProcedureDosingRows(english, data)
  assert.equal(rows[0].name, '无水乙醇')
  assert.equal(rows[1].name, '四氢呋喃')
  const html = buildProcedureReportHtml({ result: english, report: data, author: '' }, '')
  const dosing = html.split('data-report-table="dosing"')[1].split('</table>')[0]
  assert.ok(!dosing.includes('class="reagent-cas"'))
  assert.ok(dosing.includes('https://www.chemicalbook.com/CAS_64-17-5.htm'))
  assert.ok(html.split('data-report-table="inventory"')[1].split('</table>')[0].includes('64-17-5'))
  assert.ok(html.split('data-report-table="inventory"')[1].split('</table>')[0].includes('<td>64-17-5</td>'))
  assert.ok(dosing.includes('<th>密度<span>g/mL</span></th>'))
  assert.ok(dosing.includes('data-field="density" value=""'))
  assert.ok(!dosing.includes('试剂 / CAS'))
  assert.ok(!dosing.includes('confirmation'))
  assert.ok(dosing.includes('data-field="molecularWeight" value="46.07"'))
  assert.ok(dosing.includes('data-field="molecularWeight" value=""'))
  assert.ok(dosing.includes('placeholder="待确认"'))
})

test('names come from local data or LLM Chinese names, otherwise the original label is preserved', () => {
  const input = { analysis_items: [
    { name: 'THF', status: 'common' },
    { name: 'substrate', chinese_name: '底物', status: 'generic' },
    { name: 'custom solvent', chinese_name: '模型给出的名称', status: 'common' },
  ] }
  assert.deepEqual(buildProcedureDosingRows(input, { compounds: [], inventory_groups: [] }).map(row => row.name),
    ['THF', 'substrate', '模型给出的名称'])
  const html = buildProcedureReportHtml({ result: { formatted_text: '', analysis_items: [] }, report: {
    compounds: [], inventory_groups: [{ cas_number: '64-17-5', items: [{
      ...report.inventory_groups[0].items[0], name: 'original inventory label',
    }] }],
  }, author: '' }, '')
  assert.ok(html.includes('>original inventory label</strong>'))
})

test('common and generic rows move to the end while each group keeps its original order', () => {
  const mixed = { formatted_text: '', analysis_items: [
    { name: '水', status: 'common' },
    { name: '乙醇', status: 'resolved', cas_number: '64-17-5' },
    { name: '底物', status: 'generic' },
    { name: '未知物料', status: 'unresolved' },
    { name: '甲醇', status: 'common' },
  ] }
  assert.deepEqual(buildProcedureDosingRows(mixed, report).map(row => row.name), [
    '乙醇', '未知物料', '水', '底物', '甲醇',
  ])
})

test('common reagents with explicit LLM equivalents stay with ordinary reagents in source order', () => {
  const mixed = { formatted_text: '', analysis_items: [
    { name: '水', status: 'common' },
    { name: '乙醇', pubchem_query_name: 'ethanol', status: 'common', equivalent: 1.5 },
    { name: '反应试剂', status: 'resolved', cas_number: '67-64-1', equivalent: 2 },
    { name: '甲醇', status: 'common' },
    { name: '底物', status: 'generic', equivalent: 1 },
  ] }
  const data = { ...report, compounds: [...report.compounds, {
    cas_number: '64-17-5', query_name: 'ethanol', molecular_formula: 'C2H6O', molecular_weight: 46.069,
  }] }
  const rows = buildProcedureDosingRows(mixed, data)
  assert.deepEqual(rows.map(row => row.name), ['乙醇', '反应试剂', '底物', '水', '甲醇'])
  assert.equal(rows[0].molecularWeight, 46.069)
  assert.equal(rows[0].equivalent, 1.5)
})

test('common aliases with conflicting LLM equivalents remain in the trailing common group', () => {
  const mixed = { formatted_text: '', analysis_items: [
    { name: '乙醇', status: 'common', cas_number: '64-17-5', equivalent: 1 },
    { name: 'ethanol', status: 'common', cas_number: '64-17-5', equivalent: 2 },
    { name: '反应试剂', status: 'resolved', cas_number: '67-64-1' },
  ] }
  const rows = buildProcedureDosingRows(mixed, report)
  assert.deepEqual(rows.map(row => row.name), ['反应试剂', '乙醇'])
  assert.equal(rows[1].equivalent, null)
})

test('LLM equivalents from an alias survive merging and render as editable printable values', () => {
  const identified = { ...result, formatted_text: 'ethanol (46 mg, 1.5 equiv.).', analysis_items: [
    result.analysis_items[0], { ...result.analysis_items[1], equivalent: 1.5, equivalent_evidence: 'ethanol (46 mg, 1.5 equiv.)' },
  ] }
  const rows = buildProcedureDosingRows(identified, report)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].equivalent, 1.5)
  const html = buildProcedureReportHtml({ result: identified, report, author: '' }, '')
  assert.ok(html.includes('data-field="equivalent" value="1.50"'))
  assert.ok(html.includes('data-value="1.50"'))
  assert.ok(!html.includes('section-note'))
  assert.ok(!html.includes('table-note'))
  assert.ok(!html.includes('report-brand'))
  assert.ok(!html.includes('库存快照：'))
})

test('conflicting equivalents across aliases are left empty rather than choosing one', () => {
  const identified = { ...result, formatted_text: '乙醇 (1 eq), ethanol (2 eq).', analysis_items: [
    { ...result.analysis_items[0], equivalent: 1 }, { ...result.analysis_items[1], equivalent: 2 },
  ] }
  assert.equal(buildProcedureDosingRows(identified, report)[0].equivalent, null)
})

test('the report consumes semantic LLM results without parsing equivalent markers itself', () => {
  const identified = { ...result, formatted_text: '乙醇的用量为一个半当量。', analysis_items: [
    { ...result.analysis_items[0], equivalent: 1.5, equivalent_evidence: '乙醇的用量为一个半当量' },
  ] }
  assert.equal(buildProcedureDosingRows(identified, report)[0].equivalent, 1.5)
  const oldResult = { ...result, formatted_text: '乙醇 (2 eq).', analysis_items: [result.analysis_items[0]] }
  assert.equal(buildProcedureDosingRows(oldResult, report)[0].equivalent, null)
})

test('invalid equivalent values in cached results remain blank', () => {
  for (const equivalent of [-1, 0, NaN, Infinity, '2 eq']) {
    const invalid = { ...result, analysis_items: [{ ...result.analysis_items[0], equivalent }] }
    assert.equal(buildProcedureDosingRows(invalid, report)[0].equivalent, null)
  }
})

test('generic and numbered materials keep independent dosing rows and their original labels', () => {
  const labels = ['compound 3', 'compound 4', 'intermediate A', '3a', '3-a', '3A']
  const identified = { formatted_text: '', analysis_items: labels.map((name, index) => ({
    name, chinese_name: '未确定物料', status: 'generic',
    cas_number: '64-17-5', equivalent: index + 1,
  })) }
  const rows = buildProcedureDosingRows(identified, report)
  assert.deepEqual(rows.map(row => row.name), labels)
  assert.deepEqual(rows.map(row => row.equivalent), [1, 2, 3, 4, 5, 6])
  assert.ok(rows.every(row => row.molecularWeight === null))
  assert.ok(rows.every(row => row.casNumbers.length === 0))
  assert.deepEqual(buildProcedureReportRequest(identified).cas_numbers, [])
  const html = buildProcedureReportHtml({ result: identified, report, author: '' }, '')
  const dosing = html.split('data-report-table="dosing"')[1].split('</table>')[0]
  for (const label of labels) assert.ok(dosing.includes(`>${label}</strong>`))
  assert.equal((dosing.match(/data-dosing-row=/g) || []).length, labels.length)
})

test('unnamed identifiers from older unresolved results retain their labels even without equivalents', () => {
  const identified = { formatted_text: '', analysis_items: [
    { name: '1a', status: 'unresolved' },
    { name: '1b', status: 'unresolved' },
    { name: '底物', status: 'generic' },
  ] }
  const rows = buildProcedureDosingRows(identified, report)
  assert.deepEqual(rows.map(row => row.name), ['1a', '1b', '底物'])
  assert.ok(rows.every(row => row.equivalent === null && row.molecularWeight === null))
})
