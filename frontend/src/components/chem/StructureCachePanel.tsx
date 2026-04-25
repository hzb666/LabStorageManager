import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit3, RefreshCw, ShieldCheck } from 'lucide-react'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type { CompoundStructureCache } from '@/api/structureSearchApi'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { UserRoles } from '@/lib/constants'
import { toast } from '@/lib/toast'
import { getApiErrorMessage, isSpecialCasValue } from '@/lib/validationSchemas'
import { useAuthStore } from '@/store/useStore'
import { getStructureResolveToastMessage } from './structureCacheMessages'
import { StructureCandidateList } from './StructureCandidateList'
import { parseStructureCandidates } from './structureCandidateUtils'

const StructureManualEditDialog = React.lazy(() => import('./StructureManualEditDialog'))

const STATUS_LABELS: Record<string, string> = {
  pending: '待解析',
  resolved: '已解析',
  ambiguous: '多候选',
  not_found: '未找到',
  unsupported: '不支持',
  invalid_cas: '无效',
  error: '失败',
}

export interface StructureCachePanelProps {
  casNumber: string
}

function getStatusLabel(cache: CompoundStructureCache | null): string {
  if (!cache) return '未解析'
  return STATUS_LABELS[cache.status] ?? cache.status
}

function getSourceLabel(source: string | null): string {
  if (source === 'pubchem') return 'PubChem'
  if (source === 'manual') return '手工确认'
  if (source === 'commonchemistry') return 'Common Chemistry'
  if (source === 'other') return '其他来源'
  return '-'
}

function useStructureCachePanelState(casNumber: string) {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const [cache, setCache] = useState<CompoundStructureCache | null>(null)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [confirmingCid, setConfirmingCid] = useState<number | null>(null)
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const candidates = useMemo(() => parseStructureCandidates(cache?.candidates_json ?? null), [cache])

  const refreshCache = useCallback(async () => {
    if (!casNumber || isSpecialCasValue(casNumber)) {
      setCache(null)
      return
    }
    setLoading(true)
    setCache(null)
    try {
      setCache(await structureSearchAPI.getCache(casNumber))
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构状态读取失败'))
    } finally {
      setLoading(false)
    }
  }, [casNumber])

  useEffect(() => {
    void refreshCache()
  }, [refreshCache])

  const handleResolve = useCallback(async () => {
    setResolving(true)
    try {
      const resolved = await structureSearchAPI.resolveCas({
        cas_number: casNumber,
        force: cache?.status === 'error',
      })
      setCache(resolved)
      const notification = getStructureResolveToastMessage(resolved)
      toast[notification.variant](notification.message)
    } catch (error) {
      toast.error(getApiErrorMessage(error, '结构解析失败'))
    } finally {
      setResolving(false)
    }
  }, [cache?.status, casNumber])

  const handleConfirmCandidate = useCallback(async (cid: number) => {
    setConfirmingCid(cid)
    try {
      const confirmed = await structureSearchAPI.confirmPubChemCandidate(casNumber, { cid })
      setCache(confirmed)
      toast.success('候选结构已确认')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '候选确认失败'))
    } finally {
      setConfirmingCid(null)
    }
  }, [casNumber])

  return {
    cache,
    candidates,
    confirmingCid,
    handleConfirmCandidate,
    handleResolve,
    isAdmin,
    loading,
    manualDialogOpen,
    resolving,
    setCache,
    setManualDialogOpen,
  }
}

function StructureCacheMeta({
  cache,
  loading,
}: Readonly<{
  cache: CompoundStructureCache | null
  loading: boolean
}>) {
  const showErrorMessage = Boolean(cache?.error_message && cache.status !== 'ambiguous')
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-normal">结构缓存：{loading ? '读取中...' : getStatusLabel(cache)}</span>
        {cache?.manually_verified && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
            <ShieldCheck className="size-3.5" />
            已人工确认
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        来源：{getSourceLabel(cache?.source ?? null)}
        {cache?.source_id ? ` / ${cache.source_id}` : ''}
        {cache?.inchikey ? ` / ${cache.inchikey}` : ''}
      </div>
      {showErrorMessage && (
        <div className="text-xs text-destructive">{cache?.error_message}</div>
      )}
    </div>
  )
}

function StructureCacheAdminActions({
  cache,
  resolving,
  onEdit,
  onResolve,
}: Readonly<{
  cache: CompoundStructureCache | null
  resolving: boolean
  onEdit: () => void
  onResolve: () => void
}>) {
  return (
    <div className="flex flex-wrap gap-2">
      <LoadingButton
        type="button"
        variant="modern"
        size="sm"
        isLoading={resolving}
        loadingText="解析中..."
        onClick={onResolve}
      >
        <RefreshCw className="size-4" />
        {cache ? '解析 CAS' : '生成结构缓存'}
      </LoadingButton>
      <Button type="button" size="sm" onClick={onEdit}>
        <Edit3 className="size-4" />
        编辑结构
      </Button>
    </div>
  )
}

function ManualDialogMount({
  cache,
  casNumber,
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  cache: CompoundStructureCache | null
  casNumber: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (cache: CompoundStructureCache) => void
}>) {
  if (!open) {
    return null
  }

  return (
    <React.Suspense fallback={null}>
      <StructureManualEditDialog
        open={open}
        casNumber={casNumber}
        initialMolblock={cache?.molblock}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    </React.Suspense>
  )
}

export function StructureCachePanel({ casNumber }: Readonly<StructureCachePanelProps>) {
  const state = useStructureCachePanelState(casNumber)
  const unsupportedCas = !casNumber || isSpecialCasValue(casNumber)

  if (unsupportedCas) {
    return <div className="col-span-2 text-sm text-muted-foreground">结构缓存：不适用</div>
  }

  return (
    <div className="col-span-2 md:col-span-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <StructureCacheMeta cache={state.cache} loading={state.loading} />
          {state.isAdmin && (
            <StructureCacheAdminActions
              cache={state.cache}
              resolving={state.resolving}
              onEdit={() => state.setManualDialogOpen(true)}
              onResolve={state.handleResolve}
            />
          )}
        </div>
        {state.isAdmin && state.cache?.status === 'ambiguous' && (
          <StructureCandidateList
            candidates={state.candidates}
            disabled={state.confirmingCid !== null}
            onConfirm={state.handleConfirmCandidate}
          />
        )}
      </div>
      {state.isAdmin && (
        <ManualDialogMount
          cache={state.cache}
          casNumber={casNumber}
          open={state.manualDialogOpen}
          onOpenChange={state.setManualDialogOpen}
          onSaved={state.setCache}
        />
      )}
    </div>
  )
}

export default StructureCachePanel
