import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Edit3, RefreshCw, Search, X } from 'lucide-react'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type {
  CompoundStructureCache,
  CompoundStructureStatus,
  StructureCacheListResponse,
} from '@/api/structureSearchApi'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { LoadingButton } from '@/components/ui/LoadingButton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { TableEmptyState, TableLoadingState } from '@/components/ui/TableFilters'
import { toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/utils'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { getStructureResolveToastMessage } from './structureCacheMessages'

const PAGE_SIZE = 20

type StatusFilterOption = {
  value: string
  label: string
}

type PubChemCandidate = {
  cid?: number
  has_exact_cas_synonym?: boolean
  matched_by_substance_name?: boolean
  sid_count?: number
}

const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: 'needs_action', label: '待处理' },
  { value: 'ambiguous', label: '多候选' },
  { value: 'error', label: '失败' },
  { value: 'not_found', label: '未找到' },
  { value: 'invalid_cas', label: '无效' },
  { value: 'pending', label: '待解析' },
  { value: 'resolved', label: '已解析' },
  { value: 'all', label: '全部' },
]

const STATUS_LABELS: Record<CompoundStructureStatus, string> = {
  pending: '待解析',
  resolved: '已解析',
  ambiguous: '多候选',
  not_found: '未找到',
  unsupported: '不支持',
  invalid_cas: '无效',
  error: '失败',
}

const STATUS_BADGE_CLASSES: Record<CompoundStructureStatus, string> = {
  pending: 'border-amber-300 bg-amber-100 text-amber-800',
  resolved: 'border-green-300 bg-green-100 text-green-800',
  ambiguous: 'border-purple-300 bg-purple-100 text-purple-800',
  not_found: 'border-slate-300 bg-slate-100 text-slate-700',
  unsupported: 'border-slate-300 bg-slate-100 text-slate-700',
  invalid_cas: 'border-red-300 bg-red-100 text-red-800',
  error: 'border-red-300 bg-red-100 text-red-800',
}

export interface StructureCacheManagerDialogProps {
  open: boolean
  onManualEdit: (
    cache: CompoundStructureCache,
    onSaved: (cache: CompoundStructureCache) => void,
  ) => void
  onOpenChange: (open: boolean) => void
}

function parseCandidates(value: string | null): PubChemCandidate[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is PubChemCandidate => typeof item === 'object' && item !== null,
    )
  } catch {
    return []
  }
}

function getSourceLabel(source: string | null): string {
  if (source === 'pubchem') return 'PubChem'
  if (source === 'manual') return '手工确认'
  if (source === 'commonchemistry') return 'Common Chemistry'
  if (source === 'other') return '其他来源'
  return '-'
}

function getUpdatedAtLabel(cache: CompoundStructureCache): string {
  return formatDateTime(cache.updated_at)
}

function replaceCacheRow(
  response: StructureCacheListResponse | null,
  cache: CompoundStructureCache,
): StructureCacheListResponse | null {
  if (!response) return response
  return {
    ...response,
    data: response.data.map((row) => (
      row.cas_number === cache.cas_number ? cache : row
    )),
  }
}

function StatusBadge({ status }: Readonly<{ status: CompoundStructureStatus }>) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-md border px-2 text-sm ${STATUS_BADGE_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function SourceMeta({ cache }: Readonly<{ cache: CompoundStructureCache }>) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>{getSourceLabel(cache.source)}</span>
        {cache.source_id && <span className="text-muted-foreground">CID {cache.source_id}</span>}
      </div>
      <div className="truncate text-muted-foreground">
        {cache.english_name || cache.chinese_name || cache.inchikey || '-'}
      </div>
    </div>
  )
}

function CacheIssue({
  cache,
  disabled,
  onConfirm,
}: Readonly<{
  cache: CompoundStructureCache
  disabled: boolean
  onConfirm: (cache: CompoundStructureCache, cid: number) => void
}>) {
  const candidates = parseCandidates(cache.candidates_json)
  if (cache.error_message) {
    return <span className="text-destructive">{cache.error_message}</span>
  }
  if (candidates.length > 0) {
    const substanceCount = candidates.reduce((sum, candidate) => (
      sum + (candidate.sid_count ?? 0)
    ), 0)
    return (
      <div className="space-y-2">
        <span>
          {candidates.length} 个 PubChem 候选
          {substanceCount > 0 ? `，${substanceCount} 条 Substance 映射` : ''}
        </span>
        <CandidateButtons cache={cache} disabled={disabled} onConfirm={onConfirm} />
      </div>
    )
  }
  return <span className="text-muted-foreground">-</span>
}

function CandidateButtons({
  cache,
  disabled,
  onConfirm,
}: Readonly<{
  cache: CompoundStructureCache
  disabled: boolean
  onConfirm: (cache: CompoundStructureCache, cid: number) => void
}>) {
  const candidates = parseCandidates(cache.candidates_json)
    .filter((candidate) => typeof candidate.cid === 'number')
  if (cache.status !== 'ambiguous' || candidates.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.map((candidate) => (
        <Button
          key={candidate.cid}
          type="button"
          variant="modern"
          size="sm"
          disabled={disabled}
          onClick={() => onConfirm(cache, candidate.cid as number)}
        >
          <CheckCircle2 className="size-4" />
          CID {candidate.cid}
          {candidate.sid_count ? `（SID ${candidate.sid_count}）` : ''}
        </Button>
      ))}
    </div>
  )
}

function RowActions({
  activeAction,
  cache,
  onManualEdit,
  onResolve,
}: Readonly<{
  activeAction: string | null
  cache: CompoundStructureCache
  onManualEdit: (cache: CompoundStructureCache) => void
  onResolve: (cache: CompoundStructureCache) => void
}>) {
  const resolveAction = `resolve:${cache.cas_number}`
  return (
    <div className="flex items-center gap-1.5">
      <LoadingButton
        type="button"
        variant="modern"
        size="icon"
        aria-label="重试解析"
        isLoading={activeAction === resolveAction}
        onClick={() => onResolve(cache)}
      >
        <RefreshCw className="size-4" />
      </LoadingButton>
      <Button
        type="button"
        variant="modern"
        size="icon"
        aria-label="手工确认结构"
        onClick={() => onManualEdit(cache)}
      >
        <Edit3 className="size-4" />
      </Button>
    </div>
  )
}

function CacheRow({
  activeAction,
  cache,
  onConfirm,
  onManualEdit,
  onResolve,
}: Readonly<{
  activeAction: string | null
  cache: CompoundStructureCache
  onConfirm: (cache: CompoundStructureCache, cid: number) => void
  onManualEdit: (cache: CompoundStructureCache) => void
  onResolve: (cache: CompoundStructureCache) => void
}>) {
  const confirming = activeAction?.startsWith(`confirm:${cache.cas_number}:`) ?? false
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors last:border-b-0">
      <td className="px-3 py-3 align-top font-medium">{cache.cas_number}</td>
      <td className="px-3 py-3 align-top"><StatusBadge status={cache.status} /></td>
      <td className="px-3 py-3 align-top"><SourceMeta cache={cache} /></td>
      <td className="px-3 py-3 align-top text-muted-foreground">{getUpdatedAtLabel(cache)}</td>
      <td className="px-3 py-3 align-top">
        <CacheIssue cache={cache} disabled={confirming} onConfirm={onConfirm} />
      </td>
      <td className="px-3 py-3 align-top">
        <RowActions
          activeAction={activeAction}
          cache={cache}
          onManualEdit={onManualEdit}
          onResolve={onResolve}
        />
      </td>
    </tr>
  )
}

function ManagerToolbar({
  searchDraft,
  statusFilter,
  onApplySearch,
  onClearSearch,
  onSearchDraftChange,
  onStatusFilterChange,
}: Readonly<{
  searchDraft: string
  statusFilter: string
  onApplySearch: () => void
  onClearSearch: () => void
  onSearchDraftChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
}>) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="h-10 w-full lg:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:max-w-xl">
        <Input
          value={searchDraft}
          onChange={(event) => onSearchDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApplySearch()
          }}
          placeholder="搜索 CAS、名称、CID、InChIKey"
          className="h-10"
        />
        <div className="flex gap-2">
          <Button type="button" variant="modern" size="lg" onClick={onApplySearch}>
            <Search className="size-4" />
            搜索
          </Button>
          <Button type="button" variant="modern" size="lg" onClick={onClearSearch}>
            <X className="size-4" />
            清空
          </Button>
        </div>
      </div>
    </div>
  )
}

function CacheTableCard({
  activeAction,
  loading,
  page,
  response,
  search,
  statusFilter,
  onConfirm,
  onManualEdit,
  onPageChange,
  onResolve,
}: Readonly<{
  activeAction: string | null
  loading: boolean
  page: number
  response: StructureCacheListResponse | null
  search: string
  statusFilter: string
  onConfirm: (cache: CompoundStructureCache, cid: number) => void
  onManualEdit: (cache: CompoundStructureCache) => void
  onPageChange: (page: number) => void
  onResolve: (cache: CompoundStructureCache) => void
}>) {
  const rows = response?.data ?? []
  const rowCount = rows.length
  const total = response?.total ?? 0
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Search className="w-5 h-5" />
          缓存列表
          <span className="text-muted-foreground font-normal">(&thinsp;{total}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading && rowCount === 0 && <TableLoadingState className="mx-6" />}
        {!loading && rowCount === 0 && (
          <TableEmptyState
            searchKeyword={search}
            statusFilter={statusFilter}
            hasFilter={Boolean(search) || statusFilter !== 'needs_action'}
            emptyText="没有符合条件的结构缓存"
            statusOptions={STATUS_FILTER_OPTIONS}
          />
        )}
        {rowCount > 0 && (
          <div className="px-6 rounded-md overflow-auto">
            <table className="w-full min-w-[1040px]" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[260px]" />
                <col className="w-[160px]" />
                <col />
                <col className="w-[96px]" />
              </colgroup>
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">CAS</th>
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">状态</th>
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">结构来源</th>
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">更新时间</th>
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">问题</th>
                  <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cache) => (
                  <CacheRow
                    key={cache.cas_number}
                    activeAction={activeAction}
                    cache={cache}
                    onConfirm={onConfirm}
                    onManualEdit={onManualEdit}
                    onResolve={onResolve}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <ManagerFooter page={page} response={response} onPageChange={onPageChange} />
    </Card>
  )
}

function ManagerFooter({
  page,
  response,
  onPageChange,
}: Readonly<{
  page: number
  response: StructureCacheListResponse | null
  onPageChange: (page: number) => void
}>) {
  const total = response?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-muted-foreground">共 {total} 条，第 {page} / {totalPages} 页</span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="modern"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="modern"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

export function StructureCacheManagerDialog({
  open,
  onManualEdit,
  onOpenChange,
}: Readonly<StructureCacheManagerDialogProps>) {
  const [statusFilter, setStatusFilter] = useState('needs_action')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [response, setResponse] = useState<StructureCacheListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const skip = useMemo(() => (page - 1) * PAGE_SIZE, [page])

  const loadCaches = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      setResponse(await structureSearchAPI.listCaches({
        status_filter: statusFilter,
        search: search || undefined,
        skip,
        limit: PAGE_SIZE,
      }))
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构缓存读取失败'))
    } finally {
      setLoading(false)
    }
  }, [open, search, skip, statusFilter])

  useEffect(() => {
    void loadCaches()
  }, [loadCaches])

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  const handleApplySearch = useCallback(() => {
    setSearch(searchDraft.trim())
    setPage(1)
  }, [searchDraft])

  const handleClearSearch = useCallback(() => {
    setSearchDraft('')
    setSearch('')
    setPage(1)
  }, [])

  const handleResolve = useCallback(async (cache: CompoundStructureCache) => {
    setActiveAction(`resolve:${cache.cas_number}`)
    try {
      const resolved = await structureSearchAPI.resolveCas({
        cas_number: cache.cas_number,
        force: cache.status === 'error' || cache.status === 'not_found',
      })
      setResponse((current) => replaceCacheRow(current, resolved))
      const notification = getStructureResolveToastMessage(resolved)
      toast[notification.variant](notification.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构解析失败'))
    } finally {
      setActiveAction(null)
    }
  }, [])

  const handleConfirm = useCallback(async (cache: CompoundStructureCache, cid: number) => {
    setActiveAction(`confirm:${cache.cas_number}:${cid}`)
    try {
      const confirmed = await structureSearchAPI.confirmPubChemCandidate(cache.cas_number, { cid })
      setResponse((current) => replaceCacheRow(current, confirmed))
      toast.success('候选结构已确认')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '候选确认失败'))
    } finally {
      setActiveAction(null)
    }
  }, [])

  const handleManualSaved = useCallback((cache: CompoundStructureCache) => {
    setResponse((current) => replaceCacheRow(current, cache))
    toast.success('手工结构已保存')
  }, [])

  const handleManualEdit = useCallback((cache: CompoundStructureCache) => {
    onManualEdit(cache, handleManualSaved)
  }, [handleManualSaved, onManualEdit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-7xl p-4 md:p-6">
        <DialogHeader>
          <DialogTitle className="mb-4 text-xl">结构缓存管理</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ManagerToolbar
            searchDraft={searchDraft}
            statusFilter={statusFilter}
            onApplySearch={handleApplySearch}
            onClearSearch={handleClearSearch}
            onSearchDraftChange={setSearchDraft}
            onStatusFilterChange={handleStatusFilterChange}
          />
          <CacheTableCard
            activeAction={activeAction}
            loading={loading}
            page={page}
            response={response}
            search={search}
            statusFilter={statusFilter}
            onConfirm={handleConfirm}
            onManualEdit={handleManualEdit}
            onPageChange={setPage}
            onResolve={handleResolve}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default StructureCacheManagerDialog
