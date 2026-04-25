import { Database, RefreshCw, X } from 'lucide-react'

import type {
  InventoryStructureSummary,
  SubstructureSearchResponse,
  SubstructureSearchResult,
} from '@/api/structureSearchApi'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'

export interface StructureSearchResultsPanelProps {
  payload: SubstructureSearchResponse
  onClear: () => void
  onSearchAgain: () => void
}

function formatSourceLabel(source: string | null): string {
  if (source === 'pubchem') return 'PubChem'
  if (source === 'manual') return '手工确认'
  if (source === 'commonchemistry') return 'Common Chemistry'
  if (source === 'other') return '其他来源'
  return '未知来源'
}

function formatLocations(summary: InventoryStructureSummary | null): string {
  if (!summary || summary.locations.length === 0) return '-'
  const visible = summary.locations.slice(0, 4).join('、')
  const hiddenCount = summary.locations.length - 4
  return hiddenCount > 0 ? `${visible} 等 ${summary.locations.length} 处` : visible
}

function formatTotals(summary: InventoryStructureSummary | null): string {
  if (!summary) return '-'
  const entries = Object.entries(summary.total_by_unit)
    .filter(([, value]) => Number.isFinite(value))
    .sort(([unitA], [unitB]) => unitA.localeCompare(unitB))
  if (entries.length === 0) return '-'
  return entries
    .map(([unit, value]) => `${Number(value.toFixed(3))} ${unit}`)
    .join('、')
}

function getResultDisplayName(result: SubstructureSearchResult): string {
  const summary = result.inventory_summary
  return (
    summary?.preferred_name ||
    summary?.display_name ||
    summary?.english_name ||
    result.cas_number
  )
}

function StructureResultRow({ result }: Readonly<{ result: SubstructureSearchResult }>) {
  const summary = result.inventory_summary
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-3 align-top font-normal text-foreground">
        <div>{getResultDisplayName(result)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{result.cas_number}</div>
      </td>
      <td className="px-3 py-3 align-top text-sm">{summary?.item_count ?? 0}</td>
      <td className="px-3 py-3 align-top text-sm">{formatLocations(summary)}</td>
      <td className="px-3 py-3 align-top text-sm">{formatTotals(summary)}</td>
      <td className="px-3 py-3 align-top text-sm">
        <div>{formatSourceLabel(result.source)}</div>
        <div className="mt-1 break-all text-xs text-muted-foreground">
          {result.inchikey || result.smiles_canonical}
        </div>
      </td>
    </tr>
  )
}

export function StructureSearchResultsPanel({
  payload,
  onClear,
  onSearchAgain,
}: Readonly<StructureSearchResultsPanelProps>) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-4 md:grid-cols-[1fr_auto]">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Database className="size-5" />
          结构检索结果
          <span className="text-sm font-normal text-muted-foreground">
            命中 {payload.total} 条，耗时 {payload.elapsed_ms} ms
          </span>
          {payload.index.dirty && (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              索引待重建
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="modern" size="sm" onClick={onSearchAgain}>
            <RefreshCw className="size-4" />
            重新绘制
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="size-4" />
            清除结果
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 text-sm text-muted-foreground">
          当前索引版本 {payload.index.version}，已加载 {payload.index.molecule_count} 个结构。
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-muted/50 text-sm text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">化合物</th>
                <th className="px-3 py-2 font-normal">库存数</th>
                <th className="px-3 py-2 font-normal">位置</th>
                <th className="px-3 py-2 font-normal">总量</th>
                <th className="px-3 py-2 font-normal">结构来源</th>
              </tr>
            </thead>
            <tbody>
              {payload.results.map((result) => (
                <StructureResultRow key={result.cas_number} result={result} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export default StructureSearchResultsPanel
