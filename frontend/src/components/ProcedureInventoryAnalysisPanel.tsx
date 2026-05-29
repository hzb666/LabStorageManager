import type { ReactNode } from 'react'

import type {
  ProcedureAnalyzedReagent,
  ProcedureAnalysisStatus,
  ProcedureInventorySearchResponse,
} from '@/api/client'
import { cn } from '@/lib/utils'

type ProcedureDisplayStatus = ProcedureAnalysisStatus | 'missing_inventory'

interface ProcedureInventoryAvailability {
  foundCasNumbers: readonly string[]
  isError?: boolean
  isLoading: boolean
}

const STATUS_LABELS: Record<ProcedureDisplayStatus, string> = {
  resolved: '已识别 CAS',
  missing_inventory: '库存未命中',
  unresolved: '未识别 CAS',
  common: '常用不查',
  generic: '通类不查',
}

const STATUS_BADGE_CLASSES: Record<ProcedureDisplayStatus, string> = {
  resolved: 'border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200',
  missing_inventory: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-200',
  unresolved: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200',
  common: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-900 dark:text-blue-200',
  generic: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

const HIGHLIGHT_CLASSES: Record<ProcedureDisplayStatus, string> = {
  resolved: 'bg-green-200/80 text-green-950 ring-green-400/60 dark:bg-green-500/30 dark:text-green-50',
  missing_inventory: 'bg-rose-200/80 text-rose-950 ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-50',
  unresolved: 'bg-amber-200/80 text-amber-950 ring-amber-400/60 dark:bg-amber-500/30 dark:text-amber-50',
  common: 'bg-blue-200/80 text-blue-950 ring-blue-400/60 dark:bg-blue-500/30 dark:text-blue-50',
  generic: 'bg-slate-200 text-slate-950 ring-slate-400/60 dark:bg-slate-600/50 dark:text-slate-50',
}

interface HighlightSegment {
  end: number
  start: number
  status: ProcedureDisplayStatus
  text: string
}

export function ProcedureInventoryAnalysisPanel({
  inventoryAvailability,
  result,
}: Readonly<{
  inventoryAvailability?: ProcedureInventoryAvailability
  result: ProcedureInventorySearchResponse | null
}>) {
  if (!result) {
    return null
  }

  const foundCasNumbers = new Set(
    inventoryAvailability?.foundCasNumbers.map(normalizeCasForCompare) ?? [],
  )
  const items = result.analysis_items.map((item) => ({
    ...item,
    foundCasNumbers: getFoundCasNumbers(item, foundCasNumbers),
    displayStatus: getDisplayStatus(
      item,
      foundCasNumbers,
      isInventoryCheckPending(inventoryAvailability),
    ),
  }))
  const summary = getStatusSummary(items, Boolean(inventoryAvailability?.isLoading))

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">实验步骤解析（仅供参考）</h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        {result.cas_query ? (
          <div className="max-w-full px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">CAS 查询：</span>
            <span className="break-all">{result.cas_query}</span>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <ProcedureHighlightedText items={items} text={result.formatted_text} />
        <ProcedureAnalysisList
          inventoryCheckStatus={getInventoryCheckStatus(inventoryAvailability)}
          items={items}
        />
      </div>
    </section>
  )
}

function ProcedureHighlightedText({
  items,
  text,
}: Readonly<{
  items: AnalyzedReagentWithDisplayStatus[]
  text: string
}>) {
  return (
    <div className="min-h-60 rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-sm font-medium text-foreground">原文</p>
      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
        {renderHighlightedText(text, items)}
      </div>
    </div>
  )
}

function ProcedureAnalysisList({
  inventoryCheckStatus,
  items,
}: Readonly<{
  inventoryCheckStatus: InventoryCheckStatus
  items: AnalyzedReagentWithDisplayStatus[]
}>) {
  return (
    <div className="min-h-60 rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">解析结果</p>
        <InventoryCheckStatusText status={inventoryCheckStatus} />
      </div>
      {items.length > 0 ? (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {items.map((item, index) => (
            <ProcedureAnalysisItem key={`${item.name}-${item.status}-${index}`} item={item} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">未解析到化学试剂</p>
      )}
    </div>
  )
}

type InventoryCheckStatus = 'idle' | 'loading' | 'error'

function InventoryCheckStatusText({ status }: Readonly<{ status: InventoryCheckStatus }>) {
  if (status === 'idle') {
    return null
  }
  return (
    <span className={cn(
      'text-xs',
      status === 'error' ? 'text-destructive' : 'text-muted-foreground',
    )}>
      {status === 'error' ? '库存核对失败' : '库存核对中'}
    </span>
  )
}

function ProcedureAnalysisItem({
  item,
}: Readonly<{
  item: AnalyzedReagentWithDisplayStatus
}>) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{item.name}</span>
        <ProcedureStatusBadge status={item.displayStatus} />
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {item.pubchem_query_name && item.pubchem_query_name !== item.name ? (
          <p>查询名：{item.pubchem_query_name}</p>
        ) : null}
        {getCandidateCasNumbers(item).length > 0 ? (
          <p>{getCasLabel(item)}：{getCandidateCasNumbers(item).join(' / ')}</p>
        ) : null}
        {item.foundCasNumbers.length > 0 ? (
          <p>库存匹配 CAS：{item.foundCasNumbers.join(' / ')}</p>
        ) : null}
        {item.reason ? <p>{item.reason}</p> : null}
      </div>
    </div>
  )
}

function ProcedureStatusBadge({ status }: Readonly<{ status: ProcedureDisplayStatus }>) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2 text-xs whitespace-nowrap',
        STATUS_BADGE_CLASSES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

interface AnalyzedReagentWithDisplayStatus extends ProcedureAnalyzedReagent {
  displayStatus: ProcedureDisplayStatus
  foundCasNumbers: string[]
}

function renderHighlightedText(text: string, items: AnalyzedReagentWithDisplayStatus[]) {
  const segments = buildHighlightSegments(text, items)
  if (segments.length === 0) {
    return text
  }
  const nodes: ReactNode[] = []
  let cursor = 0
  segments.forEach((segment, index) => {
    if (segment.start > cursor) {
      nodes.push(text.slice(cursor, segment.start))
    }
    nodes.push(
      <mark
        key={`${segment.start}-${segment.end}-${index}`}
        className={cn('rounded px-0.5 ring-1', HIGHLIGHT_CLASSES[segment.status])}
      >
        {segment.text}
      </mark>,
    )
    cursor = segment.end
  })
  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }
  return nodes
}

function buildHighlightSegments(
  text: string,
  items: AnalyzedReagentWithDisplayStatus[],
): HighlightSegment[] {
  const candidates = items
    .map((item) => ({ term: item.name.trim(), status: item.displayStatus }))
    .filter((item) => item.term.length > 0)
    .sort((left, right) => right.term.length - left.term.length)
  const segments: HighlightSegment[] = []
  for (const candidate of candidates) {
    segments.push(...findTermSegments(text, candidate.term, candidate.status))
  }
  return removeOverlappingSegments(segments)
}

function findTermSegments(
  text: string,
  term: string,
  status: ProcedureDisplayStatus,
): HighlightSegment[] {
  const pattern = new RegExp(escapeRegExp(term), 'gi')
  return Array.from(text.matchAll(pattern)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: match[0],
    status,
  }))
}

function removeOverlappingSegments(segments: HighlightSegment[]): HighlightSegment[] {
  const result: HighlightSegment[] = []
  const sorted = [...segments].sort((left, right) => (
    left.start - right.start || (right.end - right.start) - (left.end - left.start)
  ))
  for (const segment of sorted) {
    if (result.some((item) => spansOverlap(item, segment))) {
      continue
    }
    result.push(segment)
  }
  return result.sort((left, right) => left.start - right.start)
}

function spansOverlap(left: HighlightSegment, right: HighlightSegment): boolean {
  return left.start < right.end && right.start < left.end
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getDisplayStatus(
  item: ProcedureAnalyzedReagent,
  foundCasNumbers: Set<string>,
  inventoryCheckBlocked = false,
): ProcedureDisplayStatus {
  if (item.status !== 'resolved' || inventoryCheckBlocked) {
    return item.status
  }
  const hasInventoryMatch = getCandidateCasNumbers(item)
    .some((casNumber) => foundCasNumbers.has(normalizeCasForCompare(casNumber)))
  return hasInventoryMatch
    ? 'resolved'
    : 'missing_inventory'
}

function isInventoryCheckPending(availability?: ProcedureInventoryAvailability): boolean {
  return Boolean(availability?.isLoading || availability?.isError)
}

function getInventoryCheckStatus(
  availability?: ProcedureInventoryAvailability,
): InventoryCheckStatus {
  if (availability?.isError) {
    return 'error'
  }
  return availability?.isLoading ? 'loading' : 'idle'
}

function getFoundCasNumbers(
  item: ProcedureAnalyzedReagent,
  foundCasNumbers: Set<string>,
): string[] {
  return getCandidateCasNumbers(item).filter((casNumber) => (
    foundCasNumbers.has(normalizeCasForCompare(casNumber))
  ))
}

function getCandidateCasNumbers(item: ProcedureAnalyzedReagent): string[] {
  const casNumbers = item.cas_numbers?.length ? item.cas_numbers : [item.cas_number]
  const result: string[] = []
  const seen = new Set<string>()
  casNumbers.forEach((casNumber) => {
    const normalized = normalizeCasForCompare(casNumber ?? '')
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    result.push(String(casNumber))
  })
  return result
}

function getCasLabel(item: ProcedureAnalyzedReagent): string {
  return getCandidateCasNumbers(item).length > 1 ? '候选 CAS' : 'CAS'
}

function normalizeCasForCompare(value: string): string {
  return value.trim().toUpperCase()
}

function getStatusSummary(
  items: AnalyzedReagentWithDisplayStatus[],
  isCheckingInventory: boolean,
): string {
  const counts = items.reduce<Record<ProcedureAnalysisStatus, number>>((acc, item) => {
    acc[item.status] += 1
    return acc
  }, { resolved: 0, unresolved: 0, common: 0, generic: 0 })
  const missingCount = items.filter((item) => item.displayStatus === 'missing_inventory').length
  return [
    getResolvedSummary(counts.resolved, missingCount, isCheckingInventory),
    `未识别 ${counts.unresolved}`,
    `常用 ${counts.common}`,
    `通类 ${counts.generic}`,
  ].join('，')
}

function getResolvedSummary(
  resolvedCount: number,
  missingInventoryCount: number,
  isCheckingInventory: boolean,
): string {
  if (isCheckingInventory) {
    return `已识别 ${resolvedCount}（库存核对中）`
  }
  if (missingInventoryCount > 0) {
    return `已识别 ${resolvedCount}（库存未命中 ${missingInventoryCount}）`
  }
  return `已识别 ${resolvedCount}`
}
