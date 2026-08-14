import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit3, Eye, RefreshCw, Search, X } from 'lucide-react'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type {
  CompoundStructureCache,
  CompoundStructureStatus,
  PubChemCandidate,
  PubChemCandidatePreviewResponse,
  StructureCacheListResponse,
} from '@/api/structureSearchApi'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { Pagination, PaginationInfo } from '@/components/ui/Pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { TableEmptyState, TableLoadingState } from '@/components/ui/TableFilters'
import { UserRoles } from '@/lib/constants'
import { toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/utils'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { useAuthStore } from '@/store/useStore'
import { getStructureResolveToastMessage } from './structureCacheMessages'
import { StructureCandidateList } from './StructureCandidateList'
import { parseStructureCandidates } from './structureCandidateUtils'

const DEFAULT_PAGE_SIZE = 20
const ADMIN_DEFAULT_STATUS_FILTER = 'needs_action'
const VIEWER_DEFAULT_STATUS_FILTER = 'resolved'
const TRANSLATED_NAME_SUFFIX = '（译）'

type StatusFilterOption = {
  value: string
  label: string
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

// 行操作按行为组传递，减少跨层 props 零散传递。
type CacheActionHandlers = {
  onManualEdit: (cache: CompoundStructureCache) => void
  onOpenCandidates: (cache: CompoundStructureCache) => void
  onOpenStructure: (cache: CompoundStructureCache) => void
  onResolve: (cache: CompoundStructureCache) => void
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
      <div className="truncate text-muted-foreground" title={cache.inchikey || undefined}>
        {cache.inchikey || '-'}
      </div>
    </div>
  )
}

function getChineseNameLabel(cache: CompoundStructureCache): string {
  if (!cache.chinese_name) return '-'
  if (!cache.chinese_name_is_translated || cache.chinese_name.endsWith(TRANSLATED_NAME_SUFFIX)) {
    return cache.chinese_name
  }
  return `${cache.chinese_name}${TRANSLATED_NAME_SUFFIX}`
}

function CacheNames({ cache }: Readonly<{ cache: CompoundStructureCache }>) {
  const chineseNameLabel = getChineseNameLabel(cache)
  return (
    <div className="space-y-1 text-sm leading-5">
      <div className="min-w-0 truncate" title={cache.english_name || undefined}>
        <span className="mr-1.5 text-muted-foreground">英文</span>
        {cache.english_name || '-'}
      </div>
      <div className="min-w-0 truncate" title={chineseNameLabel === '-' ? undefined : chineseNameLabel}>
        <span className="mr-1.5 text-muted-foreground">中文</span>
        {chineseNameLabel}
      </div>
    </div>
  )
}

function countSubstanceMappings(candidates: PubChemCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + (candidate.sid_count ?? 0), 0)
}

function CandidateSummary({ candidates }: Readonly<{ candidates: PubChemCandidate[] }>) {
  const substanceCount = countSubstanceMappings(candidates)
  return (
    <span>
      {candidates.length} 个 PubChem 候选
      {substanceCount > 0 ? `，${substanceCount} 条 Substance 映射` : ''}
    </span>
  )
}

function getCacheStructureInput(cache: CompoundStructureCache): string | null {
  return (
    cache.smiles_canonical?.trim()
    || cache.smiles_isomeric?.trim()
    || cache.molblock?.trim()
    || null
  )
}

function createCandidatePreviewCache(
  cache: CompoundStructureCache,
  preview: PubChemCandidatePreviewResponse,
): CompoundStructureCache {
  return {
    ...cache,
    status: preview.status,
    confidence: preview.confidence,
    candidate_count: preview.candidate_count,
    candidates_json: JSON.stringify(preview.candidates),
    error_message: preview.error_message,
  }
}

function CacheIssue({
  cache,
  canManage,
  disabled,
  onOpenCandidates,
  onOpenStructure,
}: Readonly<{
  cache: CompoundStructureCache
  canManage: boolean
  disabled: boolean
  onOpenCandidates: (cache: CompoundStructureCache) => void
  onOpenStructure: (cache: CompoundStructureCache) => void
}>) {
  const candidates = parseStructureCandidates(cache.candidates_json)
  if (cache.status === 'resolved' && getCacheStructureInput(cache)) {
    return (
      <div className="space-y-2">
        <span className="text-muted-foreground">已解析结构</span>
        <Button
          type="button"
          variant="modern"
          size="sm"
          className="ml-1"
          onClick={() => onOpenStructure(cache)}
        >
          <Eye className="size-4" />
          查看结构
        </Button>
      </div>
    )
  }
  if (candidates.length > 0) {
    return (
      <div className="space-y-2">
        <CandidateSummary candidates={candidates} />
        {canManage && cache.status === 'ambiguous' && (
          <Button
            type="button"
            variant="modern"
            size="sm"
            disabled={disabled}
            onClick={() => onOpenCandidates(cache)}
          >
            <Search className="size-4" />
            查看候选
          </Button>
        )}
      </div>
    )
  }
  if (cache.error_message) {
    return <span className="text-destructive">{cache.error_message}</span>
  }
  return <span className="text-muted-foreground">-</span>
}

function RowActions({
  activeAction,
  cache,
  canManage,
  onManualEdit,
  onResolve,
}: Readonly<{
  activeAction: string | null
  cache: CompoundStructureCache
  canManage: boolean
  onManualEdit: (cache: CompoundStructureCache) => void
  onResolve: (cache: CompoundStructureCache) => void
}>) {
  const resolveAction = `resolve:${cache.cas_number}`
  if (!canManage) {
    return <span className="text-sm text-muted-foreground">-</span>
  }

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

function getCacheTableColumnCount(canManage: boolean): number {
  return canManage ? 7 : 6
}

function CacheRow({
  activeAction,
  actions,
  cache,
  canManage,
}: Readonly<{
  activeAction: string | null
  actions: CacheActionHandlers
  cache: CompoundStructureCache
  canManage: boolean
}>) {
  const confirming = activeAction?.startsWith(`confirm:${cache.cas_number}:`) ?? false
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors last:border-b-0">
      <td className="px-3 py-3 align-top font-normal">{cache.cas_number}</td>
      <td className="px-3 py-3 align-top"><StatusBadge status={cache.status} /></td>
      <td className="px-3 py-3 align-top"><CacheNames cache={cache} /></td>
      <td className="px-3 py-3 align-top"><SourceMeta cache={cache} /></td>
      <td className="px-3 py-3 align-top text-muted-foreground">{getUpdatedAtLabel(cache)}</td>
      <td className="px-3 py-3 align-top">
        <CacheIssue
          cache={cache}
          canManage={canManage}
          disabled={confirming}
          onOpenCandidates={actions.onOpenCandidates}
          onOpenStructure={actions.onOpenStructure}
        />
      </td>
      {canManage ? (
        <td className="px-3 py-3 align-top">
          <RowActions
            activeAction={activeAction}
            cache={cache}
            canManage={canManage}
            onManualEdit={actions.onManualEdit}
            onResolve={actions.onResolve}
          />
        </td>
      ) : null}
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
  actions,
  canManage,
  loading,
  page,
  pageSize,
  response,
  search,
  statusFilter,
  onPageChange,
  onPageSizeChange,
}: Readonly<{
  activeAction: string | null
  actions: CacheActionHandlers
  canManage: boolean
  loading: boolean
  page: number
  pageSize: number
  response: StructureCacheListResponse | null
  search: string
  statusFilter: string
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}>) {
  const rows = response?.data ?? []
  const total = response?.total ?? 0
  const initialLoading = loading && response === null
  return (
    <Card className="min-h-0 flex-1 overflow-hidden pb-0" aria-busy={loading}>
      <CardHeader className="shrink-0 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Search className="w-5 h-5" />
          缓存列表
          <span className="text-muted-foreground font-normal">(&thinsp;{total}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {initialLoading ? (
          <TableLoadingState className="mx-6 min-h-0 flex-1" label="正在加载结构缓存" />
        ) : (
          <div className="h-full overflow-auto rounded-md px-6">
            <table className="w-full min-w-[1240px]" style={{ tableLayout: 'fixed' }}>
              <CacheTableColumns canManage={canManage} />
              <CacheTableHeader canManage={canManage} />
              <CacheTableBody
                activeAction={activeAction}
                actions={actions}
                canManage={canManage}
                rows={rows}
                search={search}
                statusFilter={statusFilter}
              />
            </table>
          </div>
        )}
      </CardContent>
      <ManagerFooter
        initialLoading={initialLoading}
        page={page}
        pageSize={pageSize}
        response={response}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </Card>
  )
}

function CacheTableColumns({ canManage }: Readonly<{ canManage: boolean }>) {
  return (
    <colgroup>
      <col className="w-[120px]" />
      <col className="w-[120px]" />
      <col className="w-[280px]" />
      <col className="w-[240px]" />
      <col className="w-[160px]" />
      <col />
      {canManage ? <col className="w-[96px]" /> : null}
    </colgroup>
  )
}

function CacheTableHeader({ canManage }: Readonly<{ canManage: boolean }>) {
  return (
    <thead>
      <tr className="border-b-2 border-border">
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">CAS</th>
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">状态</th>
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">名称</th>
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">结构来源</th>
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">更新时间</th>
        <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">详情</th>
        {canManage ? (
          <th className="h-11 px-3 font-bold text-foreground text-left align-middle text-base">操作</th>
        ) : null}
      </tr>
    </thead>
  )
}

function CacheTablePlaceholderRow({
  canManage,
  children,
}: Readonly<{
  canManage: boolean
  children: React.ReactNode
}>) {
  return (
    <tr>
      <td colSpan={getCacheTableColumnCount(canManage)} className="p-0">
        {children}
      </td>
    </tr>
  )
}

function CacheTableBody({
  activeAction,
  actions,
  canManage,
  rows,
  search,
  statusFilter,
}: Readonly<{
  activeAction: string | null
  actions: CacheActionHandlers
  canManage: boolean
  rows: CompoundStructureCache[]
  search: string
  statusFilter: string
}>) {
  if (rows.length === 0) {
    return (
      <tbody>
        <CacheTablePlaceholderRow canManage={canManage}>
          <TableEmptyState
            searchKeyword={search}
            statusFilter={statusFilter}
            hasFilter={Boolean(search) || statusFilter !== 'needs_action'}
            emptyText="没有符合条件的结构缓存"
            statusOptions={STATUS_FILTER_OPTIONS}
          />
        </CacheTablePlaceholderRow>
      </tbody>
    )
  }

  return (
    <tbody>
      {rows.map((cache) => (
        <CacheRow
          key={cache.cas_number}
          activeAction={activeAction}
          actions={actions}
          cache={cache}
          canManage={canManage}
        />
      ))}
    </tbody>
  )
}

function ManagerFooter({
  initialLoading,
  page,
  pageSize,
  response,
  onPageChange,
  onPageSizeChange,
}: Readonly<{
  initialLoading: boolean
  page: number
  pageSize: number
  response: StructureCacheListResponse | null
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}>) {
  const total = response?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
      <div
        className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
          initialLoading ? 'invisible pointer-events-none' : ''
        }`}
      >
        <PaginationInfo currentPage={page} pageSize={pageSize} total={total} />
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    </div>
  )
}

function CandidateReviewDialog({
  activeAction,
  cache,
  onConfirm,
  onOpenChange,
}: Readonly<{
  activeAction: string | null
  cache: CompoundStructureCache | null
  onConfirm: (cache: CompoundStructureCache, cid: number) => void
  onOpenChange: (open: boolean) => void
}>) {
  const candidates = useMemo(
    () => parseStructureCandidates(cache?.candidates_json ?? null),
    [cache?.candidates_json],
  )
  if (!cache) return null

  const confirming = activeAction?.startsWith(`confirm:${cache.cas_number}:`) ?? false
  return (
    <Dialog
      open={Boolean(cache)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && confirming) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-[96vw] max-w-5xl p-4 md:p-6">
        <DialogHeader className="mb-4">
          <DialogTitle className="mb-0 pr-10">PubChem 候选确认</DialogTitle>
          <DialogCloseButton
            aria-label="关闭 PubChem 候选确认弹窗"
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-normal">CAS {cache.cas_number}</span>
              <StatusBadge status={cache.status} />
              <CandidateSummary candidates={candidates} />
            </div>
          </div>
          <StructureCandidateList
            candidates={candidates}
            disabled={confirming}
            onConfirm={(cid) => onConfirm(cache, cid)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StructurePreviewDialog({
  activeAction,
  cache,
  canManage,
  onReselectPubChem,
  onOpenChange,
}: Readonly<{
  activeAction: string | null
  cache: CompoundStructureCache | null
  canManage: boolean
  onReselectPubChem: (cache: CompoundStructureCache) => void
  onOpenChange: (open: boolean) => void
}>) {
  const structureInput = cache ? getCacheStructureInput(cache) : null
  if (!cache || !structureInput) return null

  const previewAction = `preview:${cache.cas_number}`
  return (
    <Dialog open={Boolean(cache)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl p-4 md:p-6">
        <DialogHeader className="mb-4">
          <DialogTitle className="mb-0 pr-10">结构详情</DialogTitle>
          <DialogCloseButton
            aria-label="关闭结构详情弹窗"
            onClick={() => onOpenChange(false)}
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-normal">CAS {cache.cas_number}</span>
              <StatusBadge status={cache.status} />
              {cache.source_id && (
                <span className="text-muted-foreground">CID {cache.source_id}</span>
              )}
            </div>
            <div className="text-muted-foreground">
              来源：{getSourceLabel(cache.source)}
              {cache.inchikey ? ` / ${cache.inchikey}` : ''}
            </div>
            {canManage && cache.manually_verified && (
              <LoadingButton
                type="button"
                variant="modern"
                size="sm"
                className="mt-3"
                isLoading={activeAction === previewAction}
                loadingText="获取候选中..."
                onClick={() => onReselectPubChem(cache)}
              >
                <Search className="size-4" />
                重新选择 PubChem 候选
              </LoadingButton>
            )}
          </div>
          <div className="flex justify-center rounded-md border border-border bg-background p-4">
            <MoleculeStructure
              casNumber={cache.cas_number}
              smiles={structureInput}
              width={520}
              height={340}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useStructureCacheListState(open: boolean, canManage: boolean) {
  const defaultStatusFilter = canManage
    ? ADMIN_DEFAULT_STATUS_FILTER
    : VIEWER_DEFAULT_STATUS_FILTER
  const [statusFilter, setStatusFilter] = useState(defaultStatusFilter)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [response, setResponse] = useState<StructureCacheListResponse | null>(null)
  const [loading, setLoading] = useState(open)
  const skip = useMemo(() => (page - 1) * pageSize, [page, pageSize])

  const loadCaches = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      setResponse(await structureSearchAPI.listCaches({
        status_filter: statusFilter,
        search: search || undefined,
        skip,
        limit: pageSize,
      }))
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构缓存读取失败'))
    } finally {
      setLoading(false)
    }
  }, [open, pageSize, search, skip, statusFilter])

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

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }, [])

  const replaceCache = useCallback((cache: CompoundStructureCache) => {
    setResponse((current) => replaceCacheRow(current, cache))
  }, [])

  return {
    filters: {
      searchDraft,
      statusFilter,
      onApplySearch: handleApplySearch,
      onClearSearch: handleClearSearch,
      onSearchDraftChange: setSearchDraft,
      onStatusFilterChange: handleStatusFilterChange,
    },
    loading,
    page,
    pageSize,
    replaceCache,
    response,
    search,
    setPage,
    setPageSize: handlePageSizeChange,
    statusFilter,
  }
}

function useStructureCacheManagerController({
  open,
  onManualEdit,
  onOpenChange,
}: Readonly<StructureCacheManagerDialogProps>) {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const cacheList = useStructureCacheListState(open, isAdmin)
  const { replaceCache } = cacheList
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [candidateDialogCache, setCandidateDialogCache] = useState<CompoundStructureCache | null>(null)
  const [candidateOverwriteManual, setCandidateOverwriteManual] = useState(false)
  const [structureDialogCache, setStructureDialogCache] = useState<CompoundStructureCache | null>(null)

  const handleResolve = useCallback(async (cache: CompoundStructureCache) => {
    if (!isAdmin) return
    setActiveAction(`resolve:${cache.cas_number}`)
    try {
      const resolved = await structureSearchAPI.resolveCas({
        cas_number: cache.cas_number,
        force: cache.status === 'error' || cache.status === 'not_found',
      })
      replaceCache(resolved)
      const notification = getStructureResolveToastMessage(resolved)
      toast[notification.variant](notification.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构解析失败'))
    } finally {
      setActiveAction(null)
    }
  }, [isAdmin, replaceCache])

  const handleConfirm = useCallback(async (cache: CompoundStructureCache, cid: number) => {
    if (!isAdmin) return
    setActiveAction(`confirm:${cache.cas_number}:${cid}`)
    try {
      const confirmed = await structureSearchAPI.confirmPubChemCandidate(cache.cas_number, {
        cid,
        overwrite_manual: candidateOverwriteManual,
      })
      replaceCache(confirmed)
      setCandidateDialogCache(null)
      setCandidateOverwriteManual(false)
      setStructureDialogCache(null)
      toast.success('候选结构已确认')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '候选确认失败'))
    } finally {
      setActiveAction(null)
    }
  }, [candidateOverwriteManual, isAdmin, replaceCache])

  const handlePreviewPubChemCandidates = useCallback(async (cache: CompoundStructureCache) => {
    if (!isAdmin) return
    setActiveAction(`preview:${cache.cas_number}`)
    try {
      const preview = await structureSearchAPI.previewPubChemCandidates(cache.cas_number)
      if (preview.candidates.length === 0) {
        toast.warning('未找到可重新选择的 PubChem 候选')
        return
      }
      setCandidateDialogCache(createCandidatePreviewCache(cache, preview))
      setCandidateOverwriteManual(true)
      setStructureDialogCache(null)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'PubChem 候选读取失败'))
    } finally {
      setActiveAction(null)
    }
  }, [isAdmin])

  const handleManualSaved = useCallback((cache: CompoundStructureCache) => {
    replaceCache(cache)
    toast.success('手工结构已保存')
  }, [replaceCache])

  const handleManualEdit = useCallback((cache: CompoundStructureCache) => {
    if (!isAdmin) return
    onManualEdit(cache, handleManualSaved)
  }, [handleManualSaved, isAdmin, onManualEdit])

  const handleOpenStoredCandidates = useCallback((cache: CompoundStructureCache) => {
    setCandidateOverwriteManual(false)
    setCandidateDialogCache(cache)
  }, [])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setCandidateDialogCache(null)
      setCandidateOverwriteManual(false)
      setStructureDialogCache(null)
    }
    onOpenChange(nextOpen)
  }, [onOpenChange])

  const handleCandidateDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setCandidateDialogCache(null)
      setCandidateOverwriteManual(false)
    }
  }, [])

  const handleStructureDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setStructureDialogCache(null)
  }, [])

  return {
    canManage: isAdmin,
    dialogs: {
      activeAction,
      candidateCache: candidateDialogCache,
      structureCache: structureDialogCache,
      onCandidateOpenChange: handleCandidateDialogOpenChange,
      onConfirm: handleConfirm,
      onReselectPubChem: handlePreviewPubChemCandidates,
      onStructureOpenChange: handleStructureDialogOpenChange,
    },
    filters: cacheList.filters,
    onDialogOpenChange: handleOpenChange,
    table: {
      activeAction,
      actions: {
        onManualEdit: handleManualEdit,
        onOpenCandidates: handleOpenStoredCandidates,
        onOpenStructure: setStructureDialogCache,
        onResolve: handleResolve,
      },
      loading: cacheList.loading,
      page: cacheList.page,
      pageSize: cacheList.pageSize,
      response: cacheList.response,
      search: cacheList.search,
      statusFilter: cacheList.statusFilter,
      onPageChange: cacheList.setPage,
      onPageSizeChange: cacheList.setPageSize,
    },
  }
}

export function StructureCacheManagerDialog(props: Readonly<StructureCacheManagerDialogProps>) {
  const { open } = props
  const manager = useStructureCacheManagerController(props)

  return (
    <>
      <Dialog open={open} onOpenChange={manager.onDialogOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[min(52rem,90vh)] !w-[98vw] !max-w-[96rem] overflow-hidden p-4 md:p-6"
        >
          <div className="flex h-full min-h-0 flex-col gap-4">
            <DialogHeader className="shrink-0">
              <DialogTitle className="mb-0 pr-10">结构缓存管理</DialogTitle>
              <DialogCloseButton
                aria-label="关闭结构缓存管理弹窗"
                onClick={() => manager.onDialogOpenChange(false)}
              />
            </DialogHeader>
            <div className="shrink-0">
              <ManagerToolbar {...manager.filters} />
            </div>
            <CacheTableCard canManage={manager.canManage} {...manager.table} />
          </div>
        </DialogContent>
      </Dialog>
      <CandidateReviewDialog
        activeAction={manager.dialogs.activeAction}
        cache={manager.dialogs.candidateCache}
        onConfirm={manager.dialogs.onConfirm}
        onOpenChange={manager.dialogs.onCandidateOpenChange}
      />
      <StructurePreviewDialog
        activeAction={manager.dialogs.activeAction}
        cache={manager.dialogs.structureCache}
        canManage={manager.canManage}
        onReselectPubChem={manager.dialogs.onReselectPubChem}
        onOpenChange={manager.dialogs.onStructureOpenChange}
      />
    </>
  )
}

export default StructureCacheManagerDialog
