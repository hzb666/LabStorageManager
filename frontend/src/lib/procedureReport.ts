import type {
  ProcedureAnalyzedReagent,
  ProcedureInventoryItem,
  ProcedureInventoryGroup,
  ProcedureInventorySearchResponse,
  ProcedureReportData,
  ProcedureReportCompound,
  ProcedureReportRequest,
} from '@/api/client'
import { formatDosingValue } from './procedureReportCalculations'

export interface ProcedureDosingRow {
  name: string
  casNumbers: string[]
  molecularWeight: number | null
  equivalent: number | null
  isCommon: boolean
}

export function buildProcedureReportRequest(result: ProcedureInventorySearchResponse): ProcedureReportRequest {
  const casNumbers = new Set<string>()
  const aliases = new Map<string, Set<string>>()
  for (const item of result.analysis_items) {
    candidateCasNumbers(item).forEach(cas => casNumbers.add(cas))
    if (item.status !== 'common' || candidateCasNumbers(item).length > 0) continue
    const query = (item.pubchem_query_name || item.name).trim()
    if (!query) continue
    const names = aliases.get(query) ?? new Set<string>()
    for (const name of [item.name, item.chinese_name]) if (name?.trim()) names.add(name.trim())
    aliases.set(query, names)
  }
  return { cas_numbers: [...casNumbers], names: [...aliases.keys()],
    name_aliases: Object.fromEntries([...aliases].map(([query, names]) => [query, [...names]])) }
}

function chineseReportName(item: ProcedureAnalyzedReagent, report: ProcedureReportData): string {
  if (item.status === 'generic' || item.is_mixture) {
    return (item.is_mixture ? item.chinese_name?.trim() : '') || item.name.trim()
  }
  const cas = candidateCasNumbers(item)
  const compounds = report.compounds.filter(compound =>
    (compound.cas_number && cas.includes(compound.cas_number))
    || compound.query_name === (item.pubchem_query_name || item.name).trim())
  const inventoryNames = report.inventory_groups.filter(group => cas.includes(group.cas_number))
    .flatMap(group => group.items.map(entry => entry.name))
  return [compounds.map(compound => compound.chinese_name).filter(Boolean).join(' / '),
    ...inventoryNames, item.chinese_name, item.name]
    .find(name => name && /[\u3400-\u9fff]/u.test(name))
    || item.name.trim() || '未命名试剂'
}

function candidateCasNumbers(item: ProcedureAnalyzedReagent): string[] {
  if (item.status === 'generic') return []
  return [...new Set((item.cas_numbers?.length ? item.cas_numbers : [item.cas_number ?? ''])
    .map(cas => cas.trim()).filter(Boolean))]
}

export function buildProcedureDosingRows(
  result: ProcedureInventorySearchResponse,
  report: ProcedureReportData,
): ProcedureDosingRow[] {
  const compounds = new Map(report.compounds.map(compound => [compound.cas_number, compound]))
  const namedCompounds = new Map(report.compounds.filter(compound => compound.query_name)
    .map(compound => [compound.query_name, compound]))
  const grouped = new Map<string, { row: ProcedureDosingRow; equivalents: Set<number> }>()
  result.analysis_items.forEach(item => {
    const equivalentValues = reportEquivalentValues(item)
    const namedCompound = item.status === 'common'
      ? namedCompounds.get((item.pubchem_query_name || item.name).trim()) : undefined
    let casNumbers = candidateCasNumbers(item)
    if (namedCompound?.cas_number) casNumbers = [namedCompound.cas_number]
    if (namedCompound?.cas_numbers?.length) casNumbers = namedCompound.cas_numbers
    const identityKey = casNumbers.length === 1 ? casNumbers[0] : `name:${item.name.trim()}`
    const key = item.is_mixture ? `mixture:${item.name.trim()}` : identityKey
    const existing = grouped.get(key)
    const isCommon = item.status === 'common' || item.status === 'generic'
    if (existing) {
      existing.row.isCommon &&= isCommon
      equivalentValues.forEach(value => existing.equivalents.add(value))
      return
    }
    const candidates = namedCompound ? [namedCompound] : casNumbers.map(cas => compounds.get(cas))
    grouped.set(key, { row: {
      name: chineseReportName(item, report),
      casNumbers,
      molecularWeight: item.is_mixture ? null : sharedMolecularWeight(candidates),
      equivalent: null,
      isCommon,
    }, equivalents: new Set(equivalentValues) })
  })
  return [...grouped.values()].map(group => ({
    ...group.row,
    equivalent: group.equivalents.size === 1 ? [...group.equivalents][0] : null,
  })).sort((a, b) => Number(a.isCommon && a.equivalent == null) - Number(b.isCommon && b.equivalent == null))
}

function reportEquivalentValues(item: ProcedureAnalyzedReagent): number[] {
  const value = item.equivalent
  return value != null && Number.isFinite(value) && value > 0 ? [value] : []
}

function sharedMolecularWeight(candidates: (ProcedureReportCompound | undefined)[]): number | null {
  const weight = candidates[0]?.molecular_weight
  const sameWeight = weight != null && Number.isFinite(weight) && weight > 0
    && candidates.every(compound => compound?.molecular_weight != null
      && Math.abs(compound.molecular_weight - weight) < 0.000001)
  return sameWeight ? weight : null
}

export function escapeReportHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char)
}

function formatNumber(value: number | null | undefined): string {
  return value != null && Number.isFinite(value)
    ? String(value) : '—'
}

export function formatReportLocation(item: ProcedureInventoryItem): string {
  if (item.status === 'borrowed') {
    return item.borrower_name ? `借用中 · ${item.borrower_name}` : '借用中'
  }
  return item.storage_location || (item.temporary_keeper_name ? `暂存 · ${item.temporary_keeper_name}` : '未填写')
}

function formatInventoryQuantity(value: string): string {
  // A missing inventory unit must stay unknown rather than defaulting to mg.
  const kind = /^[\d.e+-]+$/iu.test(value.trim()) ? 'mmol' : 'planned'
  return formatDosingValue(value, kind)
}

function renderReportNameCell(name: string, casNumbers: string[], editable = false): string {
  const attributes = editable ? 'contenteditable="plaintext-only" aria-label="试剂名称"' : ''
  const cas = casNumbers.length === 1 && /^\d{2,7}-\d{2}-\d$/u.test(casNumbers[0]) ? casNumbers[0] : null
  const searchIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></svg>'
  const search = cas
    ? `<a class="report-search-row" data-search-report-row href="https://www.chemicalbook.com/CAS_${cas}.htm" target="_blank" rel="noopener noreferrer" aria-label="在 ChemicalBook 查找" title="ChemicalBook：${cas}">${searchIcon}</a>`
    : `<span class="report-search-row" aria-disabled="true" title="暂无唯一确定的 CAS">${searchIcon}</span>`
  return `<td class="report-name-cell"><strong ${attributes} title="${escapeReportHtml(name)}">${escapeReportHtml(name)}</strong>
    <span class="report-row-actions">${search}
    <button type="button" class="report-delete-row" data-delete-report-row aria-label="删除此行" title="从报告中删除此行">
      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6"/></svg>
    </button></span></td>`
}

function inventoryCells(item: ProcedureInventoryItem, name: string, multipleCas: boolean): string {
  const specification = formatInventoryQuantity(item.specification || (
    item.initial_quantity == null ? '—' : `${formatNumber(item.initial_quantity)} ${item.unit ?? ''}`.trim()
  ))
  const remaining = item.remaining_quantity == null
    ? '—' : formatInventoryQuantity(`${formatNumber(item.remaining_quantity)} ${item.unit ?? ''}`.trim())
  const casLabel = item.cas_number + (multipleCas ? ' 等' : '')
  return renderReportNameCell(name, [item.cas_number]) + [casLabel, formatReportLocation(item), item.brand || '—', `${remaining} / ${specification}`]
    .map(value => `<td>${escapeReportHtml(value)}</td>`).join('')
}

function reportInventoryGroups(result: ProcedureInventorySearchResponse, report: ProcedureReportData) {
  const byCas = new Map(report.inventory_groups.map(group => [group.cas_number, group]))
  const selected = new Map<string, ProcedureAnalyzedReagent[]>()
  const covered = new Set<string>()
  for (const item of result.analysis_items) {
    const candidates = candidateCasNumbers(item).map(cas => byCas.get(cas))
      .filter((group): group is ProcedureInventoryGroup => Boolean(group))
    candidates.forEach(group => covered.add(group.cas_number))
    const targets = candidates.filter(group => group.items.length > 0)
    const fallback = candidates.find(group => group.cas_number === item.cas_number) ?? candidates[0]
    if (!targets.length && fallback) targets.push(fallback)
    for (const group of targets) {
      const reagents = selected.get(group.cas_number) ?? []
      reagents.push(item)
      selected.set(group.cas_number, reagents)
    }
  }
  for (const group of report.inventory_groups) {
    if (!covered.has(group.cas_number)) selected.set(group.cas_number, [])
  }
  return report.inventory_groups.filter(group => selected.has(group.cas_number))
    .map(group => ({ group, reagents: selected.get(group.cas_number) ?? [] }))
}

function renderInventory(result: ProcedureInventorySearchResponse, report: ProcedureReportData): string {
  const rows = reportInventoryGroups(result, report).flatMap(({ group, reagents }) => {
    const multipleCas = reagents.some(item => candidateCasNumbers(item).length > 1)
    const compoundName = report.compounds.find(compound => compound.cas_number === group.cas_number)?.chinese_name
    const analyzed = reagents[0]
    let fallbackName: string | undefined
    if (group.items.length) return group.items.map(item => {
      let name = compoundName
      if (!name && /[\u3400-\u9fff]/u.test(item.name)) name = item.name
      if (!name) {
        fallbackName ??= analyzed ? chineseReportName(analyzed, report) : ''
        name = fallbackName || item.name
      }
      return `<tr>${inventoryCells(item, name || '未命名试剂', multipleCas)}</tr>`
    })
    const names = [...new Set(reagents.map(item => chineseReportName(item, report)))].join(' / ')
    const casLabel = group.cas_number + (multipleCas ? ' 等' : '')
    return [`<tr class="unavailable">${renderReportNameCell(names || '—', [group.cas_number])}<td>${escapeReportHtml(casLabel)}</td>
      <td>未找到库存</td><td>—</td><td>—</td></tr>`]
  })
  return `<div class="table-scroll" data-report-table="inventory"><table class="inventory"><colgroup><col class="name-col"><col class="cas-col">
    <col class="location-col"><col class="brand-col"><col class="quantity-col"></colgroup>
    <thead><tr><th>名称</th><th>CAS</th><th>位置</th><th>品牌</th><th>剩余/规格</th></tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="5" class="empty">未识别到可查询的 CAS，请补充核对。</td></tr>'}</tbody></table></div>`
}

function renderWritingCell(name: string, label: string, field: string, value = ''): string {
  const ariaLabel = escapeReportHtml(`${name} ${label}`)
  const hints: Record<string, string> = {
    molecularWeight: '填写分子量（g/mol）；修改分子量保留物质的量，重新计算计划投料。',
    density: '填写纯试剂密度（g/mL）；溶液应按实际浓度计算。修改密度保留物质的量。',
  }
  const hint = hints[field] ?? '填写密度后，无单位的投料量按 μL 计算；也可填写 mL、mg 或 g。'
  const title = ['molecularWeight', 'density', 'planned', 'actual'].includes(field) ? 'title="' + hint + '"' : ''
  return `<td class="writing-cell" data-value="${escapeReportHtml(value || (field === 'molecularWeight' ? '待确认' : ''))}"><input type="text" data-field="${field}" value="${escapeReportHtml(value)}" aria-label="${ariaLabel}"
    ${['molecularWeight', 'density', 'equivalent', 'mmol'].includes(field) ? 'inputmode="decimal"' : ''}
    ${field === 'molecularWeight' ? 'placeholder="待确认"' : ''}
    ${title} autocomplete="off"></td>`
}

function renderDosing(rows: ProcedureDosingRow[]): string {
  const body = rows.map((row, index) => {
    const weight = row.molecularWeight != null && row.molecularWeight > 0
      ? row.molecularWeight.toFixed(2) : ''
    return `<tr data-dosing-row="${index}" data-molecular-weight="${row.molecularWeight ?? ''}" data-equivalent="${row.equivalent ?? ''}">${renderReportNameCell(row.name, row.casNumbers, true)}
      ${renderWritingCell(row.name, '分子量', 'molecularWeight', weight)}
      ${[['密度', 'density'], ['当量', 'equivalent'], ['物质的量', 'mmol'], ['计划投料', 'planned'], ['实际投料', 'actual']]
        .map(([label, field]) => renderWritingCell(row.name, label, field,
          field === 'equivalent' && row.equivalent != null ? formatDosingValue(String(row.equivalent), 'equivalent') : '')).join('')}</tr>`
  })
  return `<div class="table-scroll" data-report-table="dosing"><table class="dosing"><colgroup><col class="reagent-col">
    <col class="weight-col"><col class="density-col"><col class="equiv-col"><col class="mmol-col"><col class="amount-col"><col class="amount-col"></colgroup>
    <thead><tr><th>试剂名称</th><th>分子量<span>g/mol</span></th><th>密度<span>g/mL</span></th><th>当量<span>equiv.</span></th>
    <th>物质的量<span>mmol</span></th><th>计划投料</th><th>实际投料</th></tr></thead>
    <tbody>${body.join('') || '<tr><td colspan="7" class="empty">未解析到试剂，可在打印后补充投料记录。</td></tr>'}</tbody></table></div>`
}

interface ProcedureReportDocument {
  result: ProcedureInventorySearchResponse
  report: ProcedureReportData
  author: string
}

export function buildProcedureReportHtml(
  { result, report, author }: ProcedureReportDocument,
  stylesheet: string,
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>实验报告</title><style>${stylesheet}</style></head>
    <body><nav class="report-toolbar" aria-label="报告操作">
      <div class="report-zoom-controls" role="group" aria-label="预览缩放">
        <button id="report-zoom-out" class="secondary report-zoom-step" type="button" aria-label="缩小预览" title="缩小预览">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
        <button id="report-zoom-reset" class="secondary report-zoom-value" type="button" aria-label="当前缩放 100%，点击恢复 100%" title="恢复 100%" aria-live="polite">100%</button>
        <button id="report-zoom-in" class="secondary report-zoom-step" type="button" aria-label="放大预览" title="放大预览">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>
        <button id="report-zoom-fit" class="secondary" type="button" aria-pressed="false">适应宽度</button>
      </div>
      <div class="report-actions"><button id="print-report" class="primary" type="button">打印 / 保存 PDF</button><button id="reset-report" type="button" title="清除填写、文本编辑和删行，恢复初始报告">重置 PDF</button><button id="close-report" type="button">关闭</button></div></nav>
    <main id="report-pages"><article class="report-sheet"><div class="page-content"><header class="report-header"><h1 contenteditable="plaintext-only" aria-label="报告标题">实验报告</h1></header>
    <dl class="report-meta"><div><dt>实验名称</dt><dd contenteditable="plaintext-only" aria-label="实验名称"></dd></div>
      <div><dt>实验编号</dt><dd contenteditable="plaintext-only" aria-label="实验编号"></dd></div>
      <div><dt>实验人员</dt><dd contenteditable="plaintext-only" aria-label="实验人员">${escapeReportHtml(author)}</dd></div>
      <div><dt>实验日期</dt><dd contenteditable="plaintext-only" aria-label="实验日期"></dd></div></dl>
    <section><h2>库存核对</h2>${renderInventory(result, report)}</section>
    <section><h2>实验步骤</h2><div class="procedure-text" data-report-text="procedure" contenteditable="plaintext-only" aria-label="实验步骤">${escapeReportHtml(result.formatted_text)}</div>
      <div class="report-reference" data-report-text="reference"><strong>参考文献：</strong><span contenteditable="plaintext-only" aria-label="参考文献"></span></div></section>
    <section><div class="dosing-heading"><h2>投料记录</h2><div class="dosing-basis"><label for="basis-mmol">基准（1 当量）</label>
      <input id="basis-mmol" type="text" inputmode="decimal" autocomplete="off" aria-label="基准物质的量"><span>mmol</span></div></div>
      ${renderDosing(buildProcedureDosingRows(result, report))}</section></div>
    <footer><span class="page-number"></span></footer></article></main></body></html>`
}
