import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Ketcher } from 'ketcher-core'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type {
  CompoundStructureCache,
  StructureSearchMode,
  StructureQueryFormat,
  SubstructureSearchResponse,
} from '@/api/structureSearchApi'
import { KetcherEditor } from '@/components/chem/KetcherEditor'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { getApiErrorMessage } from '@/lib/validationSchemas'

const DEFAULT_SEARCH_LIMIT = 100

type ExportedStructureQuery = {
  query: string
  format: StructureQueryFormat
  molblock: string
}

export type ManualStructureEditTarget = {
  casNumber: string
  molblock?: string | null
}

export interface StructureSearchDialogProps {
  open: boolean
  initialMolblock?: string | null
  keepMounted?: boolean
  manualEditTarget?: ManualStructureEditTarget | null
  onOpenChange: (open: boolean) => void
  onDraftChange?: (molblock: string | null) => void
  onManualSaved?: (cache: CompoundStructureCache) => void
  onResults: (
    payload: SubstructureSearchResponse,
    matchMode: StructureSearchMode,
    molblock: string,
    query: string,
    queryFormat: StructureQueryFormat,
  ) => void | Promise<void>
}

function normalizeExportedQuery(query: string | undefined): string {
  return query?.trim() ?? ''
}

function hasSimpleWildcardAtom(query: string): boolean {
  return /\*|\[#0\]/u.test(query)
}

function getManualTargetKey(target: ManualStructureEditTarget | null | undefined): string | null {
  if (!target) return null
  return `${target.casNumber}:${target.molblock ?? ''}`
}

async function exportCurrentMolblock(ketcher: Ketcher): Promise<string> {
  const molblock = await ketcher.getMolfile('v3000')
  if (!molblock?.trim()) {
    return ''
  }
  return molblock
}

async function trySaveStructureDraft(
  ketcher: Ketcher | null,
  onDraftChange?: (molblock: string | null) => void,
): Promise<void> {
  if (!ketcher) return
  try {
    const molblock = await exportCurrentMolblock(ketcher)
    onDraftChange?.(molblock || null)
  } catch {
    // Draft export failure should not block dialog close.
  }
}

async function createExportedQuery(
  ketcher: Ketcher,
  query: string,
  format: StructureQueryFormat,
): Promise<ExportedStructureQuery> {
  const molblock = await exportCurrentMolblock(ketcher)
  if (!molblock) {
    throw new Error('请先绘制查询结构')
  }
  return { query, format, molblock }
}

async function tryExportExactRGroupQuery(
  ketcher: Ketcher,
): Promise<ExportedStructureQuery | null> {
  try {
    const smarts = normalizeExportedQuery(await ketcher.getSmarts())
    if (smarts && hasSimpleWildcardAtom(smarts)) {
      return createExportedQuery(ketcher, smarts, 'smarts')
    }
  } catch {
    // 精确检索只有检测到简单 R/wildcard 时才走 SMARTS，其余保持普通精确检索。
  }
  return null
}

async function tryExportSmilesQuery(
  ketcher: Ketcher,
  matchMode: StructureSearchMode,
): Promise<ExportedStructureQuery | null> {
  try {
    const smiles = normalizeExportedQuery(await ketcher.getSmiles())
    if (!smiles) {
      return null
    }
    if (matchMode === 'exact' && hasSimpleWildcardAtom(smiles)) {
      return createExportedQuery(ketcher, smiles, 'smarts')
    }
    return createExportedQuery(ketcher, smiles, 'smiles')
  } catch {
    // 普通绘图优先走 SMILES，避免 Ketcher SMARTS 把普通芳香环导成过窄查询。
    return null
  }
}

async function tryExportSubstructureSmartsQuery(
  ketcher: Ketcher,
): Promise<ExportedStructureQuery | null> {
  try {
    const smarts = normalizeExportedQuery(await ketcher.getSmarts())
    if (smarts) {
      return createExportedQuery(ketcher, smarts, 'smarts')
    }
  } catch {
    // SMARTS 导出失败时继续用 MolBlock，避免让编辑器格式差异阻断查询。
  }
  return null
}

async function exportStructureQuery(
  ketcher: Ketcher | null,
  matchMode: StructureSearchMode,
): Promise<ExportedStructureQuery> {
  if (!ketcher) {
    throw new Error('结构编辑器仍在加载，请稍后再试')
  }

  if (matchMode === 'exact') {
    const rGroupQuery = await tryExportExactRGroupQuery(ketcher)
    if (rGroupQuery) {
      return rGroupQuery
    }
  }

  const smilesQuery = await tryExportSmilesQuery(ketcher, matchMode)
  if (smilesQuery) {
    return smilesQuery
  }

  if (matchMode === 'substructure') {
    const smartsQuery = await tryExportSubstructureSmartsQuery(ketcher)
    if (smartsQuery) {
      return smartsQuery
    }
  }

  const molblock = normalizeExportedQuery(await ketcher.getMolfile('v3000'))
  if (!molblock) {
    throw new Error('请先绘制查询结构')
  }
  return { query: molblock, format: 'molblock', molblock }
}

function StructureDialogActions({
  editorReady,
  isManualMode,
  savingManual,
  searchingMode,
  onClose,
  onManualSave,
  onSearch,
}: Readonly<{
  editorReady: boolean
  isManualMode: boolean
  savingManual: boolean
  searchingMode: StructureSearchMode | null
  onClose: () => void
  onManualSave: () => void
  onSearch: (matchMode: StructureSearchMode) => void
}>) {
  if (isManualMode) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="modern" size="lg" className="min-w-24 text-center" onClick={onClose}>
          关闭
        </Button>
        <LoadingButton
          type="button"
          size="lg"
          className="min-w-32 text-center"
          onClick={onManualSave}
          isLoading={savingManual}
          loadingText="保存中..."
          disabled={!editorReady || savingManual}
        >
          保存结构
        </LoadingButton>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="modern" size="lg" className="min-w-24 text-center" onClick={onClose}>
        关闭
      </Button>
      <LoadingButton
        type="button"
        variant="modern"
        size="lg"
        className="min-w-24 text-center"
        onClick={() => onSearch('exact')}
        isLoading={searchingMode === 'exact'}
        loadingText="检索中..."
        disabled={!editorReady || searchingMode !== null}
      >
        精确检索
      </LoadingButton>
      <LoadingButton
        type="button"
        variant="modern"
        size="lg"
        className="min-w-32 text-center"
        onClick={() => onSearch('substructure')}
        isLoading={searchingMode === 'substructure'}
        loadingText="检索中..."
        disabled={!editorReady || searchingMode !== null}
      >
        子结构检索
      </LoadingButton>
    </div>
  )
}

function StructureEditorSurface({
  editorReady,
  error,
  onEditorError,
  onEditorInit,
}: Readonly<{
  editorReady: boolean
  error: string | null
  onEditorError: (message: string) => void
  onEditorInit: (ketcher: Ketcher) => void
}>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background">
        {!editorReady && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/80"
            role="status"
            aria-label="结构编辑器加载中"
          >
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}
        <KetcherEditor onError={onEditorError} onInit={onEditorInit} />
      </div>
    </div>
  )
}

function useKetcherMoleculeLoader(params: {
  open: boolean
  manualEditTarget?: ManualStructureEditTarget | null
  manualTargetKey: string | null
  initialMolblock?: string | null
  onError: (message: string) => void
}) {
  const { open, manualEditTarget, manualTargetKey, initialMolblock, onError } = params
  const ketcherRef = useRef<Ketcher | null>(null)
  const loadedModeRef = useRef<'search' | 'manual'>('search')
  const loadedManualKeyRef = useRef<string | null>(null)
  const loadedSearchMolblockRef = useRef<string | null>(null)
  const searchMolblockBeforeManualRef = useRef<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  const loadMolecule = useCallback((molblock: string, mode: 'search' | 'manual') => {
    const ketcher = ketcherRef.current
    if (!ketcher) return Promise.resolve(false)
    return ketcher.setMolecule(molblock).then(() => {
      loadedModeRef.current = mode
      return true
    }).catch(() => {
      onError('结构载入失败，请重新绘制')
      return false
    })
  }, [onError])

  const loadManualMolecule = useCallback((
    target: ManualStructureEditTarget,
    targetKey: string,
  ) => {
    const loadTarget = () => {
      loadedManualKeyRef.current = targetKey
      loadMolecule(target.molblock ?? '', 'manual')
    }
    if (loadedModeRef.current === 'manual') {
      loadTarget()
      return
    }
    ketcherRef.current?.getMolfile('v3000').then((molblock) => {
      searchMolblockBeforeManualRef.current = molblock?.trim() ? molblock : null
    }).catch(() => {
      searchMolblockBeforeManualRef.current = null
    }).finally(loadTarget)
  }, [loadMolecule])

  const handleEditorInit = useCallback((ketcher: Ketcher) => {
    ketcherRef.current = ketcher

    const isManual = Boolean(manualEditTarget)
    const molblockToLoad = isManual
      ? manualEditTarget?.molblock ?? ''
      : initialMolblock ?? ''

    const markReady = () => {
      setEditorReady(true)
    }

    if (!molblockToLoad) {
      loadedModeRef.current = isManual ? 'manual' : 'search'
      if (isManual && manualTargetKey) {
        loadedManualKeyRef.current = manualTargetKey
      } else {
        loadedSearchMolblockRef.current = ''
      }
      markReady()
      return
    }

    ketcher.setMolecule(molblockToLoad)
      .then(() => {
        loadedModeRef.current = isManual ? 'manual' : 'search'
        if (isManual && manualTargetKey) {
          loadedManualKeyRef.current = manualTargetKey
        } else {
          loadedSearchMolblockRef.current = molblockToLoad
        }
      })
      .catch(() => {
        onError('结构载入失败，请重新绘制')
      })
      .finally(markReady)
  }, [initialMolblock, manualEditTarget, manualTargetKey, onError])

  useEffect(() => {
    if (!open || !editorReady || !manualEditTarget || !manualTargetKey) return
    if (loadedManualKeyRef.current === manualTargetKey) return
    loadManualMolecule(manualEditTarget, manualTargetKey)
  }, [editorReady, loadManualMolecule, manualEditTarget, manualTargetKey, open])

  useEffect(() => {
    if (!open || !editorReady || manualEditTarget || loadedModeRef.current !== 'manual') return
    loadedManualKeyRef.current = null
    loadMolecule(initialMolblock ?? searchMolblockBeforeManualRef.current ?? '', 'search')
    searchMolblockBeforeManualRef.current = null
  }, [editorReady, initialMolblock, loadMolecule, manualEditTarget, open])

  return { ketcherRef, editorReady, handleEditorInit }
}

export function StructureSearchDialog({
  open,
  initialMolblock,
  keepMounted = false,
  manualEditTarget,
  onOpenChange,
  onDraftChange,
  onManualSaved,
  onResults,
}: Readonly<StructureSearchDialogProps>) {
  const manualTargetKey = getManualTargetKey(manualEditTarget)
  const isManualMode = Boolean(manualEditTarget)
  const [searchingMode, setSearchingMode] = useState<StructureSearchMode | null>(null)
  const [savingManual, setSavingManual] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { ketcherRef, editorReady, handleEditorInit } = useKetcherMoleculeLoader({
    open,
    manualEditTarget,
    manualTargetKey,
    initialMolblock,
    onError: setError,
  })

  const handleEditorError = useCallback((message: string) => {
    setError(message || '结构编辑器出错')
  }, [])

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (manualEditTarget) {
      onOpenChange(false)
      return
    }

    trySaveStructureDraft(ketcherRef.current, onDraftChange).then(() => {
      onOpenChange(false)
    })
  }, [ketcherRef, manualEditTarget, onDraftChange, onOpenChange])

  const handleSearch = useCallback(async (matchMode: StructureSearchMode) => {
    setError(null)
    setSearchingMode(matchMode)
    try {
      const exported = await exportStructureQuery(ketcherRef.current, matchMode)
      const payload = await structureSearchAPI.searchSubstructure({
        query: exported.query,
        format: exported.format,
        match_mode: matchMode,
        limit: DEFAULT_SEARCH_LIMIT,
        only_in_stock: false,
      })
      await onResults(payload, matchMode, exported.molblock, exported.query, exported.format)
      onOpenChange(false)
    } catch (searchError) {
      setError(getApiErrorMessage(searchError, '结构检索失败'))
    } finally {
      setSearchingMode(null)
    }
  }, [ketcherRef, onOpenChange, onResults])

  const handleManualSave = useCallback(async () => {
    if (!manualEditTarget) return
    setError(null)
    setSavingManual(true)
    try {
      const ketcher = ketcherRef.current
      if (!ketcher) {
        throw new Error('结构编辑器仍在加载，请稍后再试')
      }
      const molblock = await exportCurrentMolblock(ketcher)
      if (!molblock) {
        throw new Error('请先绘制结构')
      }
      const cache = await structureSearchAPI.saveManualStructure(
        manualEditTarget.casNumber,
        { molblock },
      )
      onManualSaved?.(cache)
      onOpenChange(false)
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, '结构保存失败'))
    } finally {
      setSavingManual(false)
    }
  }, [ketcherRef, manualEditTarget, onManualSaved, onOpenChange])

  return (
    <Dialog open={open} keepMounted={keepMounted} onOpenChange={handleDialogOpenChange}>
      <DialogContent aria-describedby={undefined} className="flex h-[82vh] max-h-[820px] w-[94vw] max-w-[1180px] flex-col overflow-hidden p-3 md:w-[88vw] md:p-4">
        <DialogHeader className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <DialogTitle className="mb-0 px-3 py-1.5">
            {isManualMode ? `手工确认结构：${manualEditTarget?.casNumber}` : '结构检索'}
          </DialogTitle>
          <StructureDialogActions
            editorReady={editorReady}
            isManualMode={isManualMode}
            savingManual={savingManual}
            searchingMode={searchingMode}
            onClose={() => handleDialogOpenChange(false)}
            onManualSave={handleManualSave}
            onSearch={handleSearch}
          />
        </DialogHeader>
        <StructureEditorSurface
          editorReady={editorReady}
          error={error}
          onEditorError={handleEditorError}
          onEditorInit={handleEditorInit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default StructureSearchDialog
