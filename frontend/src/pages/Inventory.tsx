import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { UseFormReturn, FieldErrors } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/lib/toast'

import { BaseForm } from '@/components/BaseForm'
import { BorrowDialog } from '@/components/BorrowDialog'
import { EditDialogActions } from '@/components/EditDialogActions'
import { ProcedureInventoryAnalysisPanel } from '@/components/ProcedureInventoryAnalysisPanel'
import useDialogState from '@/hooks/useDialogState'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { FilterTable } from '@/components/ui/FilterTable'
import type { FilterTableQueryDataReadyContext } from '@/components/ui/FilterTable'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import type { FilterAPI } from '@/hooks/useTableState'

import { inventoryAPI, chemicalAPI, type ProcedureInventorySearchResponse } from '@/api/client'
import type {
  CompoundStructureCache,
  StructureQueryFormat,
  StructureSearchMode,
  SubstructureSearchResponse,
} from '@/api/structureSearchApi'
import type { ManualStructureEditTarget } from '@/components/chem/StructureSearchDialog'
import { isStructureSearchFeatureEnabled } from '@/lib/apiConfig'
import { formatDate, processNotes } from '@/lib/utils'
import { useExportDownload } from '@/hooks/useExportDownload'
import {
  InventoryFormSchema,
  applyValidationErrors,
  parseSpecification,
  createValibotResolver,
  validateAndNormalizeCASInput,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  isEffectivelyEmptyStorageLocation,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import { SEARCH_MATCH_MODES } from '@/lib/searchMatchMode'
import type { InventoryFormData, InventoryFormInputData } from '@/lib/validationSchemas'
import { getInventoryTableColumns } from '@/lib/tableConfigs'
import { UserRoles, type UserRole } from '@/lib/constants'
import { getReagentBrandOptionsQueryOptions } from '@/lib/reagentBrandOptions'
import { refreshDashboardAfterMutation } from '@/lib/dashboardUtils'
import { useAuthStore } from '@/store/useStore'
import { INVENTORY_SSE_EVENTS } from '@/lib/sseEvents'
import { canWriteNonPublicData } from '@/lib/permissions'
import { getProcedureInventorySearchResult } from '@/lib/storage/procedureInventorySearchStorage'

import { defaultInventoryValues, enhanceCasLookupField, getInventoryFormFields } from '@/lib/formConfigs'

import {
  ArrowUpFromLine,
  Database,
  Loader2,
  Plus,
  Package,
  ScanSearch
} from 'lucide-react'

export interface InventoryItem {
  id: number
  internal_code: string
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  purity: string | null
  storage_location: string | null
  initial_quantity: number
  remaining_quantity: number
  remaining_percent?: number | null
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
  temporary_keeper_id?: number | null
  temporary_keeper_name?: string | null
  borrower_id?: number | null
  borrower_name?: string | null
  last_borrower_id?: number | null
  last_borrower_name?: string | null
  structure_matched_smiles?: string | null
}

type InventoryDialogState = 'edit' | 'add' | null
type StructureInventoryFilter = {
  elapsedMs: number
  filterKey: string
  matchMode: StructureSearchMode
  moleculeCount: number
  molblock: string
  query: string
  queryFormat: StructureQueryFormat
  resultCount: number
  searchId: string
  smilesByCas: Map<string, string>
}
type StructureManualSavedHandler = (cache: CompoundStructureCache) => void
type StructureManualEditRequestHandler = (
  cache: CompoundStructureCache,
  onSaved: StructureManualSavedHandler,
) => void
type PendingStructureSearchClose = {
  filterKey: string
  resolve: () => void
  timeoutId: number
}

const columnHelper = createColumnHelper<InventoryItem>()
const loadStructureSearchDialog = () => import('@/components/chem/StructureSearchDialog')
const loadStructureCacheManagerDialog = () => import('@/components/chem/StructureCacheManagerDialog')
const StructureSearchDialog = React.lazy(loadStructureSearchDialog)
const StructureCacheManagerDialog = React.lazy(loadStructureCacheManagerDialog)
const structureSearchEnabled = isStructureSearchFeatureEnabled()
const STRUCTURE_DIALOG_PREWARM_TIMEOUT_MS = 2500
const STRUCTURE_SEARCH_TABLE_READY_TIMEOUT_MS = 5000
const STRUCTURE_SEARCH_TEXT_DISABLED_MESSAGE = '请清除结构搜索后再进行文字搜索'
const PROCEDURE_AVAILABILITY_PAGE_SIZE = 100

function createInventoryFormValues(item: InventoryItem): InventoryFormInputData {
  const remainingQty = item.remaining_quantity
  return {
    name: item.name || '',
    cas_number: item.cas_number || '',
    english_name: item.english_name || '',
    alias: item.alias || '',
    specification: item.specification || '',
    category: item.category || '',
    brand: item.brand || '',
    purity: item.purity || '',
    storage_location: item.storage_location || '',
    quantity_bottles: 1,
    initial_quantity: item.initial_quantity ?? undefined,
    remaining_quantity: remainingQty === null ? undefined : (remainingQty ?? 0),
    is_hazardous: item.is_hazardous || false,
    notes: item.notes || '',
  }
}

function resolveInventoryInitialQuantity(editingItem: InventoryItem, specification: string | undefined): number {
  const parsedValue = specification ? parseSpecification(specification) : null
  return parsedValue ?? editingItem.initial_quantity
}

function getCurrentUserId(user: { id: number } | null): number | null {
  return user?.id ?? null
}

function useProcedureInventoryAvailability(result: ProcedureInventorySearchResponse | null) {
  const casQuery = result?.cas_query?.trim() ?? ''
  const query = useQuery({
    queryKey: ['procedure-inventory-availability', casQuery],
    queryFn: () => fetchProcedureInventoryFoundCasNumbers(casQuery),
    enabled: casQuery.length > 0,
    staleTime: 30_000,
  })

  return {
    foundCasNumbers: query.data ?? [],
    isError: query.isError,
    isLoading: casQuery.length > 0 && (query.isLoading || query.isFetching),
  }
}

async function fetchProcedureInventoryFoundCasNumbers(casQuery: string): Promise<string[]> {
  const targetCasNumbers = new Set(splitCasQuery(casQuery))
  const foundCasNumbers = new Set<string>()
  let skip = 0
  let total = 0

  do {
    const response = await inventoryAPI.list({
      search: casQuery,
      search_field: 'cas_number',
      match_mode: SEARCH_MATCH_MODES.EXACT,
      skip,
      limit: PROCEDURE_AVAILABILITY_PAGE_SIZE,
    })
    const page = response.data as InventoryAvailabilityPage
    collectFoundCasNumbers(page.data, targetCasNumbers, foundCasNumbers)
    if (foundCasNumbers.size >= targetCasNumbers.size) {
      break
    }
    total = Number(page.total ?? 0)
    skip += Number(page.limit ?? PROCEDURE_AVAILABILITY_PAGE_SIZE)
  } while (skip < total)

  return Array.from(foundCasNumbers)
}

interface InventoryAvailabilityPage {
  data?: unknown[]
  limit?: number
  total?: number
}

function splitCasQuery(casQuery: string): string[] {
  return casQuery
    .split('&&')
    .map(normalizeCasForCompare)
    .filter(Boolean)
}

function collectFoundCasNumbers(
  rows: unknown[] | undefined,
  targetCasNumbers: Set<string>,
  foundCasNumbers: Set<string>,
) {
  if (!Array.isArray(rows)) {
    return
  }
  rows.forEach((row) => {
    const casNumber = normalizeCasForCompare(getInventoryRowCasNumber(row))
    if (targetCasNumbers.has(casNumber)) {
      foundCasNumbers.add(casNumber)
    }
  })
}

function getInventoryRowCasNumber(row: unknown): string {
  return typeof row === 'object' && row !== null && 'cas_number' in row
    ? String((row as { cas_number?: unknown }).cas_number ?? '')
    : ''
}

function normalizeCasForCompare(value: string): string {
  return value.trim().toUpperCase()
}

function validateInventoryRemainingQuantity(params: {
  dialogState: InventoryDialogState
  editingItem: InventoryItem | null
  formData: InventoryFormData
  form: UseFormReturn<InventoryFormInputData, unknown, InventoryFormData>
}): boolean {
  const { dialogState, editingItem, formData, form } = params
  if (dialogState !== 'edit' || !editingItem) {
    return true
  }

  const remaining = formData.remaining_quantity
  const initial = resolveInventoryInitialQuantity(editingItem, formData.specification)
  if (remaining !== undefined && remaining !== null && remaining > initial) {
    form.setError('remaining_quantity', { message: `剩余量不能超过规格 (${initial})` })
    return false
  }
  return true
}

// 编辑态仍需补做一次剩余量必填校验，不能只依赖 Schema。
function ensureInventoryRemainingQuantityError(params: {
  dialogState: InventoryDialogState
  editingItem: InventoryItem | null
  form: UseFormReturn<InventoryFormInputData, unknown, InventoryFormData>
  errors: FieldErrors<InventoryFormInputData>
}) {
  const { dialogState, editingItem, form, errors } = params
  if (dialogState !== 'edit' || !editingItem) {
    return
  }

  const remainingValue = form.getValues('remaining_quantity')
  if ((remainingValue === undefined || remainingValue === null) && !errors.remaining_quantity) {
    form.setError('remaining_quantity', { message: '剩余数量不能为空' })
  }
}

function createInventoryUpdatePayload(formData: InventoryFormData) {
  return {
    name: formData.name || '',
    cas_number: formData.cas_number || '',
    english_name: formData.english_name || '',
    alias: formData.alias || '',
    category: formData.category || '',
    storage_location: formData.storage_location || '',
    remaining_quantity: formData.remaining_quantity,
    brand: formData.brand || '',
    purity: formData.purity || '',
    is_hazardous: formData.is_hazardous,
    notes: processNotes(formData.notes),
    specification: formData.specification || '',
  }
}

// 新增接口依赖 `undefined` 表达可选字段缺省，不能改成空字符串。
function createInventoryCreatePayload(formData: InventoryFormData) {
  return {
    cas_number: formData.cas_number,
    name: formData.name,
    english_name: formData.english_name || undefined,
    alias: formData.alias || undefined,
    specification: formData.specification || '',
    quantity_bottles: formData.quantity_bottles as number,
    brand: formData.brand,
    category: formData.category || undefined,
    purity: formData.purity || undefined,
    storage_location: formData.storage_location || undefined,
    is_hazardous: formData.is_hazardous,
    notes: processNotes(formData.notes),
  }
}

async function submitInventoryRequest(params: {
  dialogState: InventoryDialogState
  editingItem: InventoryItem | null
  formData: InventoryFormData
}) {
  const { dialogState, editingItem, formData } = params
  if (dialogState === 'edit' && editingItem) {
    await inventoryAPI.update(editingItem.id, createInventoryUpdatePayload(formData))
    return
  }

  if (dialogState === 'add') {
    await inventoryAPI.manualAdd(createInventoryCreatePayload(formData))
  }
}

function createInventoryFormFields(params: {
  dialogState: InventoryDialogState
  initialQuantity?: number
  requireManualStorageLocation: boolean
  brandOptions: { label: string; value: string }[]
  handleCasLookup: () => Promise<void>
  isCasLookupLoading: boolean
}) {
  const {
    dialogState,
    initialQuantity,
    requireManualStorageLocation,
    brandOptions,
    handleCasLookup,
    isCasLookupLoading,
  } = params
  const fields = getInventoryFormFields(dialogState === 'edit', initialQuantity, {
    brandOptions,
    requireStorageLocation: dialogState === 'add' && requireManualStorageLocation,
  })
  if (dialogState !== 'add') {
    return fields
  }

  return enhanceCasLookupField(fields, {
    prefixButton: {
      onClick: handleCasLookup,
      loading: isCasLookupLoading,
      title: '识别 CAS 号',
      icon: ScanSearch,
    },
  })
}

function validateManualStorageLocation(params: {
  dialogState: InventoryDialogState
  formData: InventoryFormData
  form: UseFormReturn<InventoryFormInputData, unknown, InventoryFormData>
  requireManualStorageLocation: boolean
}): boolean {
  const { dialogState, formData, form, requireManualStorageLocation } = params
  if (dialogState !== 'add' || !requireManualStorageLocation) {
    return true
  }
  if (!isEffectivelyEmptyStorageLocation(formData.storage_location)) {
    return true
  }
  form.setError('storage_location', { message: '请填写存放位置' })
  return false
}

function formatInventoryBorrowerDisplay(item: InventoryItem): string {
  if (item.borrower_name) {
    return `${item.borrower_name} (未归还)`
  }
  if (item.last_borrower_name) {
    return `${item.last_borrower_name} (已归还)`
  }
  return '-'
}

function useInventoryDialogController(
  refreshInventory: () => void | Promise<void>,
  requireManualStorageLocation: boolean,
) {
  const { data: brandOptions = [] } = useQuery(getReagentBrandOptionsQueryOptions())
  const [dialogState, setDialogState] = useDialogState<'edit' | 'add'>()
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)
  const form = useForm<InventoryFormInputData, unknown, InventoryFormData>({
    resolver: createValibotResolver(InventoryFormSchema),
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    form.reset(defaultInventoryValues)
    setDialogState('add')
  }, [form, setDialogState])
  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    setEditingItem(item)
    form.reset(createInventoryFormValues(item))
    setDialogState('edit')
  }, [form, setDialogState])
  const handleCasLookup = useCallback(async () => {
    const casValue = form.getValues('cas_number')
    const casValidation = validateAndNormalizeCASInput(casValue || '')
    if ('error' in casValidation) {
      form.setError('cas_number', { message: casValidation.error })
      return
    }

    if (isSpecialCasValue(casValidation.normalized)) {
      form.setError('cas_number', { message: '生物试剂不支持 CAS 识别查询' })
      return
    }

    setIsCasLookupLoading(true)
    try {
      const response = await chemicalAPI.getInfo(casValidation.normalized)
      const info = response.data
      if (info.name) {
        form.setValue('name', info.name, { shouldValidate: true })
      }
      if (info.english_name) {
        form.setValue('english_name', info.english_name, { shouldValidate: true })
      }
      toast.success('CAS 号识别成功')
    } catch (error) {
      const detail = extractApiErrorDetail(error)
      if (typeof detail === 'string') {
        form.setError('cas_number', { message: normalizeApiErrorMessage(detail, 'CAS 号识别失败') })
      } else {
        toast.error('CAS 号识别失败')
      }
    } finally {
      setIsCasLookupLoading(false)
    }
  }, [form])
  const handleFormSubmit = form.handleSubmit(async (formData) => {
    if (!validateInventoryRemainingQuantity({ dialogState, editingItem, formData, form })) {
      return
    }
    if (!validateManualStorageLocation({
      dialogState,
      formData,
      form,
      requireManualStorageLocation,
    })) {
      return
    }

    setIsSubmitting(true)
    try {
      await submitInventoryRequest({ dialogState, editingItem, formData })
      await Promise.resolve(refreshInventory())
      if (dialogState === 'edit') {
        toast.success('库存信息已更新')
      } else if (dialogState === 'add') {
        toast.success('手动入库成功！')
      }
      setDialogState(null)
    } catch (err) {
      const errorDetail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(errorDetail)
      if (applyValidationErrors(validationErrors, (fieldName, message) => {
        form.setError(fieldName as keyof InventoryFormData, { message })
      })) {
        return
      }
      toast.error(normalizeApiErrorMessage(errorDetail, '操作失败'))
    } finally {
      setIsSubmitting(false)
    }
  }, (errors) => {
    ensureInventoryRemainingQuantityError({ dialogState, editingItem, form, errors })
  })
  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) return

    try {
      await inventoryAPI.delete(editingItem.id)
      setDialogState(null)
      await Promise.resolve(refreshInventory())
      toast.success('库存已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [editingItem, refreshInventory, setDialogState])
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (open) return
    setDialogState(null)
    form.reset()
  }, [form, setDialogState])
  const formFields = useMemo(() => createInventoryFormFields({
    dialogState,
    initialQuantity: editingItem?.initial_quantity,
    requireManualStorageLocation,
    brandOptions,
    handleCasLookup,
    isCasLookupLoading,
  }), [
    brandOptions,
    dialogState,
    editingItem?.initial_quantity,
    handleCasLookup,
    isCasLookupLoading,
    requireManualStorageLocation,
  ])

  return {
    dialogState,
    editingItem,
    isSubmitting,
    form,
    formFields,
    handleAddClick,
    handleEditClick,
    handleFormSubmit,
    handleDeleteClick,
    handleDialogOpenChange,
    setDialogState,
  }
}

function createInventoryColumns(params: {
  onBorrow: (item: InventoryItem) => void | Promise<void>
}): ColumnDef<Record<string, unknown>, unknown>[] {
  const baseColumns = getInventoryTableColumns()
  const actionColumn = columnHelper.display({
    id: 'actions',
    header: '操作',
    size: 120,
    minSize: 120,
    maxSize: 150,
    cell: (info) => {
      const meta = info.table.options.meta
      return (
        <ActionButtons
          item={{ ...(info.row.original as unknown as InventoryItem) }}
          onEdit={meta?.onEdit as (item: InventoryItem) => void}
          onBorrow={params.onBorrow}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

function InventoryExpandedRow({
  item,
  onViewRecords,
  matchedSmiles,
  highlightMatchMode,
  highlightQuery,
  highlightQueryFormat,
}: {
  item: InventoryItem
  onViewRecords: (internalCode: string) => void
  matchedSmiles?: string | null
  highlightMatchMode?: StructureSearchMode
  highlightQuery?: string | null
  highlightQueryFormat?: StructureQueryFormat
}) {
  return (
    <div className="flex min-h-[124px] flex-col gap-4 border-b border-border p-3 md:flex-row">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure
          casNumber={item.cas_number}
          width={150}
          height={100}
          smiles={matchedSmiles}
          highlightQuery={highlightQuery}
          highlightQueryFormat={highlightQueryFormat}
          highlightMatchMode={highlightMatchMode}
        />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 md:m-2 md:grid-cols-3">
        <div className="col-span-2">英文名称：{item.english_name || '-'}</div>
        <div>别名：{item.alias || '-'}</div>
        <NoteDisplay className="col-span-2" label="备注" text={item.notes ?? undefined} />
        <div>纯度：{item.purity || '-'}</div>
        <div>入库时间：{formatDate(item.created_at)}</div>
        <div>入库用户：{item.created_by_name || '-'}</div>
        <div className="min-w-0">
          <div className="relative inline-block max-w-[calc(100%-clamp(4rem,7vw,6rem))] align-top">
            <span className="block truncate">
              上次借用：{formatInventoryBorrowerDisplay(item)}
            </span>
            <Button
              type="button"
              variant="modern"
              size="sm"
              className="absolute left-[calc(100%+clamp(0.5rem,1.5vw,1.25rem))] top-1/2 h-8 shrink-0 -translate-y-1/2 px-3 text-sm"
              onClick={(event) => {
                event.stopPropagation()
                onViewRecords(item.internal_code)
              }}
            >
              记录
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function createStructureInventoryFilter(
  payload: SubstructureSearchResponse,
  matchMode: StructureSearchMode,
  molblock: string,
  query: string,
  queryFormat: StructureQueryFormat,
): StructureInventoryFilter {
  const smilesByCas = new Map(
    payload.results
      .map((result): [string, string] => [
        result.cas_number.trim(),
        result.smiles_canonical.trim(),
      ])
      .filter(([casNumber, smiles]) => Boolean(casNumber && smiles))
  )

  return {
    elapsedMs: payload.elapsed_ms,
    filterKey: `${matchMode}:${queryFormat}:${query}`,
    matchMode,
    moleculeCount: payload.index.molecule_count,
    molblock,
    query,
    queryFormat,
    resultCount: payload.total,
    searchId: payload.search_id,
    smilesByCas,
  }
}

function createStructureExtraParams(filter: StructureInventoryFilter): Record<string, unknown> {
  return {
    structure_search_id: filter.searchId,
    structure_match_mode: filter.matchMode,
  }
}

function formatStructureFilterTitle(filter: StructureInventoryFilter): string {
  return `耗时 ${filter.elapsedMs} ms，命中 ${filter.resultCount} 个结构，索引 ${filter.moleculeCount} 个结构；点击右侧按钮清除结构筛选`
}

function getStructureInitialMolblock(
  draftMolblock: string | null,
  structureFilter: StructureInventoryFilter | null,
): string | null {
  return draftMolblock ?? structureFilter?.molblock ?? null
}

function getApiErrorStatus(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | undefined)?.response
  return typeof response?.status === 'number' ? response.status : undefined
}

type BrowserIdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number
}

function preloadStructureSearchDialog(): Promise<void> {
  return loadStructureSearchDialog().then(() => undefined)
}

function scheduleStructureDialogPreload(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  let cancelled = false
  const prewarm = () => {
    if (!cancelled) {
      preloadStructureSearchDialog().catch(() => undefined)
    }
  }
  const browserWindow = window as BrowserIdleWindow
  if (browserWindow.requestIdleCallback) {
    const handle = browserWindow.requestIdleCallback(prewarm, {
      timeout: STRUCTURE_DIALOG_PREWARM_TIMEOUT_MS,
    })
    return () => {
      cancelled = true
      browserWindow.cancelIdleCallback?.(handle)
    }
  }

  const timeoutId = window.setTimeout(prewarm, STRUCTURE_DIALOG_PREWARM_TIMEOUT_MS)
  return () => {
    cancelled = true
    window.clearTimeout(timeoutId)
  }
}

function useStructureDialogPreload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    return scheduleStructureDialogPreload()
  }, [enabled])
}

function StructureDialogFallback({
  contentClassName,
  open,
  onOpenChange,
}: Readonly<{
  contentClassName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName ?? "flex h-48 max-w-md items-center justify-center"}>
        <DialogTitle className="sr-only">结构搜索加载中</DialogTitle>
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </DialogContent>
    </Dialog>
  )
}

function useDeferredStructureDialogClose() {
  const pendingCloseRef = useRef<PendingStructureSearchClose | null>(null)

  const resolvePendingStructureSearchClose = useCallback((filterKey?: string) => {
    const pendingClose = pendingCloseRef.current
    if (!pendingClose) return
    if (filterKey && pendingClose.filterKey !== filterKey) return

    window.clearTimeout(pendingClose.timeoutId)
    pendingCloseRef.current = null
    pendingClose.resolve()
  }, [])

  const waitForStructureTableReady = useCallback((filterKey: string) => {
    resolvePendingStructureSearchClose()
    return new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        resolvePendingStructureSearchClose(filterKey)
      }, STRUCTURE_SEARCH_TABLE_READY_TIMEOUT_MS)
      pendingCloseRef.current = { filterKey, resolve, timeoutId }
    })
  }, [resolvePendingStructureSearchClose])

  useEffect(() => {
    return () => resolvePendingStructureSearchClose()
  }, [resolvePendingStructureSearchClose])

  return {
    resolvePendingStructureSearchClose,
    waitForStructureTableReady,
  }
}

function useInventoryStructureEditor() {
  const [structureDialogOpen, setStructureDialogOpen] = useState(false)
  const [manualEditTarget, setManualEditTarget] = useState<ManualStructureEditTarget | null>(null)
  const [structureFilter, setStructureFilter] = useState<StructureInventoryFilter | null>(null)
  const [structureDraftMolblock, setStructureDraftMolblock] = useState<string | null>(null)
  const [structureSearchExpandSignal, setStructureSearchExpandSignal] = useState(0)
  const [structureSearchCollapseSignal, setStructureSearchCollapseSignal] = useState(0)
  const manualSavedHandlerRef = useRef<StructureManualSavedHandler | null>(null)
  const {
    resolvePendingStructureSearchClose,
    waitForStructureTableReady,
  } = useDeferredStructureDialogClose()

  const handleStructureResults = useCallback((
    payload: SubstructureSearchResponse,
    matchMode: StructureSearchMode,
    molblock: string,
    query: string,
    queryFormat: StructureQueryFormat,
  ) => {
    const nextFilter = createStructureInventoryFilter(payload, matchMode, molblock, query, queryFormat)
    setStructureFilter(nextFilter)
    setStructureDraftMolblock(molblock)
    setStructureSearchExpandSignal((value) => value + 1)
    return waitForStructureTableReady(nextFilter.filterKey)
  }, [waitForStructureTableReady])

  const handleClearStructureFilter = useCallback(() => {
    resolvePendingStructureSearchClose()
    setStructureFilter(null)
    setStructureSearchCollapseSignal((value) => value + 1)
  }, [resolvePendingStructureSearchClose])

  const handleStructureDialogOpenChange = useCallback((nextOpen: boolean) => {
    setStructureDialogOpen(nextOpen)
    if (!nextOpen) {
      resolvePendingStructureSearchClose()
      setManualEditTarget(null)
      manualSavedHandlerRef.current = null
    }
  }, [resolvePendingStructureSearchClose])

  const handleManualStructureEdit = useCallback<StructureManualEditRequestHandler>((
    cache,
    onSaved,
  ) => {
    manualSavedHandlerRef.current = onSaved
    setManualEditTarget({ casNumber: cache.cas_number, molblock: cache.molblock })
    setStructureDialogOpen(true)
  }, [])

  const handleOpenStructureDialog = useCallback(() => {
    manualSavedHandlerRef.current = null
    setManualEditTarget(null)
    setStructureDialogOpen(true)
  }, [])

  const structureExtraParams = useMemo<Record<string, unknown>>(() => {
    if (!structureFilter) return {}
    return createStructureExtraParams(structureFilter)
  }, [structureFilter])

  const handleManualStructureSaved = useCallback((cache: CompoundStructureCache) => {
    manualSavedHandlerRef.current?.(cache)
    manualSavedHandlerRef.current = null
  }, [])

  const handleStructureQueryDataReady = useCallback((
    context: FilterTableQueryDataReadyContext,
  ) => {
    if (!structureFilter) return
    if (context.extraParams.structure_search_id !== structureFilter.searchId) return
    if (context.globalFilter || context.searchField !== 'all' || context.hasSorting) return
    resolvePendingStructureSearchClose(structureFilter.filterKey)
  }, [resolvePendingStructureSearchClose, structureFilter])

  return {
    handleClearStructureFilter,
    handleManualStructureEdit,
    handleManualStructureSaved,
    handleOpenStructureDialog,
    handleStructureQueryDataReady,
    handleStructureDialogOpenChange,
    handleStructureResults,
    manualEditTarget,
    structureDialogOpen,
    structureDraftMolblock,
    structureExtraParams,
    structureFilter,
    structureSearchCollapseSignal,
    structureSearchExpandSignal,
  }
}

function StructureCacheManagerEntry({
  onManualEdit,
}: Readonly<{
  onManualEdit: StructureManualEditRequestHandler
}>) {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const handleOpen = useCallback(() => {
    setMounted(true)
    setOpen(true)
  }, [])

  if (!structureSearchEnabled) {
    return null
  }

  return (
    <>
      <Button type="button" variant="modern" size="lg" onClick={handleOpen}>
        <Database className="size-4" />
        {isAdmin ? '结构缓存管理' : '结构缓存查看'}
      </Button>
      {mounted && (
        <React.Suspense
          fallback={(
            <StructureDialogFallback
              contentClassName="flex min-h-[32rem] !w-[98vw] !max-w-[96rem] items-center justify-center p-4 md:p-6"
              open={open}
              onOpenChange={setOpen}
            />
          )}
        >
          <StructureCacheManagerDialog
            open={open}
            onManualEdit={onManualEdit}
            onOpenChange={setOpen}
          />
        </React.Suspense>
      )}
    </>
  )
}

function InventoryFormDialog({
  canDeleteInventory,
  dialogController,
}: Readonly<{
  canDeleteInventory: boolean
  dialogController: ReturnType<typeof useInventoryDialogController>
}>) {
  const isEditing = dialogController.dialogState === 'edit'
  return (
    <Dialog
      open={dialogController.dialogState !== null}
      onOpenChange={dialogController.handleDialogOpenChange}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑库存' : '手动入库'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={dialogController.handleFormSubmit}>
          <BaseForm form={dialogController.form} fields={dialogController.formFields} />
          <EditDialogActions
            mode={dialogController.dialogState ?? 'add'}
            onCancel={() => dialogController.setDialogState(null)}
            onDelete={
              canDeleteInventory && isEditing && dialogController.editingItem
                ? dialogController.handleDeleteClick
                : undefined
            }
            submitLabelEdit="保存"
            submitLabelAdd="确认入库"
            isSubmitting={dialogController.isSubmitting}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InventoryPageHeader({
  canManageInventory,
  dialogController,
  isExporting,
  onExport,
  structureEditor,
}: Readonly<{
  canManageInventory: boolean
  dialogController: ReturnType<typeof useInventoryDialogController>
  isExporting: boolean
  onExport: () => Promise<void>
  structureEditor: ReturnType<typeof useInventoryStructureEditor>
}>) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <h1 className="text-3xl font-bold text-primary">库存管理</h1>
      <div className="flex flex-wrap gap-2">
        {canManageInventory ? (
          <Button onClick={dialogController.handleAddClick} size="lg">
            <Plus className="mr-1.5 h-4 w-4" /> 手动入库
          </Button>
        ) : null}
        <StructureCacheManagerEntry onManualEdit={structureEditor.handleManualStructureEdit} />
        <LoadingButton
          variant="modern"
          size="lg"
          className="px-4"
          isLoading={isExporting}
          loadingText="导出中"
          onClick={onExport}
        >
          <ArrowUpFromLine className="mr-1.5 h-4 w-4" /> 导出
        </LoadingButton>
      </div>
    </div>
  )
}

function InventoryStructureSearchDialog({
  initialMolblock,
  shouldRender,
  structureEditor,
}: Readonly<{
  initialMolblock: string | null
  shouldRender: boolean
  structureEditor: ReturnType<typeof useInventoryStructureEditor>
}>) {
  if (!shouldRender) {
    return null
  }

  return (
    <React.Suspense
      fallback={(
        <StructureDialogFallback
          open={structureEditor.structureDialogOpen}
          onOpenChange={structureEditor.handleStructureDialogOpenChange}
        />
      )}
    >
      <StructureSearchDialog
        open={structureEditor.structureDialogOpen}
        initialMolblock={initialMolblock}
        manualEditTarget={structureEditor.manualEditTarget}
        onManualSaved={structureEditor.handleManualStructureSaved}
        onOpenChange={structureEditor.handleStructureDialogOpenChange}
        onResults={structureEditor.handleStructureResults}
      />
    </React.Suspense>
  )
}

function useInventoryBorrowController({
  currentUserRole,
  refreshInventory,
}: Readonly<{
  currentUserRole?: UserRole | null
  refreshInventory: () => void | Promise<void>
}>) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingItem, setPendingItem] = useState<InventoryItem | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setPendingItem(null)
    }
  }, [])

  const executeBorrow = useCallback(async (inventoryId: number, actualBorrowerId?: number) => {
    setIsSubmitting(true)
    try {
      await inventoryAPI.borrow(
        inventoryId,
        actualBorrowerId ? { actual_borrower_id: actualBorrowerId } : undefined
      )
      await Promise.resolve(refreshInventory())
      toast.success('借用成功')
      setDialogOpen(false)
      setPendingItem(null)
    } catch (error) {
      const maybeStatus = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined
      const message = getApiErrorMessage(error, '借用失败')
      toast[maybeStatus === 409 ? 'warning' : 'error'](message)
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }, [refreshInventory])

  const handleBorrowRequest = useCallback(async (item: InventoryItem) => {
    if (currentUserRole === UserRoles.PUBLIC) {
      setPendingItem(item)
      setDialogOpen(true)
      return
    }
    await executeBorrow(item.id)
  }, [currentUserRole, executeBorrow])

  const handleConfirm = useCallback(async (actualBorrowerId: number) => {
    if (!pendingItem) return
    await executeBorrow(pendingItem.id, actualBorrowerId)
  }, [executeBorrow, pendingItem])

  return {
    dialogOpen,
    handleBorrowRequest,
    handleConfirm,
    handleDialogOpenChange,
    isSubmitting,
  }
}

export function InventoryPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentUser = useAuthStore((state) => state.user)
  const canManageInventory = canWriteNonPublicData(currentUser?.role)
  const structureEditor = useInventoryStructureEditor()
  const procedureSearchId = searchParams.get('procedureSearchId')
  const currentUserId = getCurrentUserId(currentUser)
  const procedureSearchResult = useMemo(
    () => getProcedureInventorySearchResult(procedureSearchId, currentUserId),
    [currentUserId, procedureSearchId],
  )
  const procedureInventoryAvailability = useProcedureInventoryAvailability(procedureSearchResult)
  const {
    handleClearStructureFilter,
    structureFilter,
  } = structureEditor
  useStructureDialogPreload(structureSearchEnabled)
  const loadInventory = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      refreshDashboardAfterMutation(queryClient),
    ])
  }, [queryClient])
  const handleInventoryQueryError = useCallback((error: unknown) => {
    if (!structureFilter || getApiErrorStatus(error) !== 410) {
      return
    }
    toast.warning('结构搜索结果已过期，请重新检索')
    handleClearStructureFilter()
  }, [handleClearStructureFilter, structureFilter])
  const dialogController = useInventoryDialogController(
    loadInventory,
    false,
  )

  const { handleExport, isExporting } = useExportDownload({
    apiCall: inventoryAPI.exportInventory,
    filePrefix: 'inventory_export',
  })

  const borrowController = useInventoryBorrowController({
    currentUserRole: currentUser?.role,
    refreshInventory: loadInventory,
  })

  const columns = useMemo(
    () => createInventoryColumns({ onBorrow: borrowController.handleBorrowRequest }),
    [borrowController.handleBorrowRequest]
  )
  const handleViewRecords = useCallback((internalCode: string) => {
    navigate(`/inventory/${encodeURIComponent(internalCode)}`)
  }, [navigate])
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    return (
      <InventoryExpandedRow
        item={item}
        onViewRecords={handleViewRecords}
        matchedSmiles={
          item.structure_matched_smiles
          ?? structureEditor.structureFilter?.smilesByCas.get(item.cas_number.trim())
        }
        highlightMatchMode={structureEditor.structureFilter?.matchMode}
        highlightQuery={structureEditor.structureFilter?.query ?? null}
        highlightQueryFormat={structureEditor.structureFilter?.queryFormat}
      />
    )
  }, [handleViewRecords, structureEditor.structureFilter])
  const structureFilterSummary = structureEditor.structureFilter
    ? STRUCTURE_SEARCH_TEXT_DISABLED_MESSAGE
    : undefined
  const structureFilterTitle = useMemo(() => (
    structureEditor.structureFilter
      ? formatStructureFilterTitle(structureEditor.structureFilter)
      : undefined
  ), [structureEditor.structureFilter])
  const structureInitialMolblock = getStructureInitialMolblock(
    structureEditor.structureDraftMolblock,
    structureEditor.structureFilter,
  )
  const shouldRenderStructureDialog = structureSearchEnabled && structureEditor.structureDialogOpen

  return (
    <div className="space-y-6">
      <InventoryPageHeader
        canManageInventory={canManageInventory}
        dialogController={dialogController}
        isExporting={isExporting}
        onExport={handleExport}
        structureEditor={structureEditor}
      />
      <ProcedureInventoryAnalysisPanel
        inventoryAvailability={procedureInventoryAvailability}
        result={procedureSearchResult}
      />
      <InventoryFormDialog canDeleteInventory={canManageInventory} dialogController={dialogController} />
      <BorrowDialog
        open={borrowController.dialogOpen}
        onOpenChange={borrowController.handleDialogOpenChange}
        isSubmitting={borrowController.isSubmitting}
        onConfirm={borrowController.handleConfirm}
      />
      <InventoryStructureSearchDialog
        initialMolblock={structureInitialMolblock}
        shouldRender={shouldRenderStructureDialog}
        structureEditor={structureEditor}
      />
      <FilterTable
        api={inventoryAPI as FilterAPI}
        queryKey={['inventory']}
        tableId="inventory-table"
        extraParams={structureEditor.structureExtraParams}
        realtime={{
          room: 'inventory',
          eventTypes: INVENTORY_SSE_EVENTS,
          onRefresh: loadInventory,
        }}
        customColumns={columns}
        onQueryError={handleInventoryQueryError}
        onQueryDataReady={structureEditor.handleStructureQueryDataReady}
        onEdit={dialogController.handleEditClick}
        title={<><Package className="w-5 h-5" /> 库存列表</>}
        searchPlaceholder="搜索名称、CAS号、位置..."
        suppressSorting={Boolean(structureEditor.structureFilter)}
        searchInputDisabled={Boolean(structureEditor.structureFilter)}
        searchInputDisabledReason={structureFilterTitle}
        searchInputDisabledValue={structureFilterSummary}
        onSearchInputDisabledClear={
          structureEditor.structureFilter ? structureEditor.handleClearStructureFilter : undefined
        }
        searchResetSignal={structureEditor.structureFilter?.filterKey ?? null}
        sortingResetSignal={structureEditor.structureFilter?.filterKey ?? null}
        expandAllSignal={structureEditor.structureSearchExpandSignal || null}
        collapseAllSignal={structureEditor.structureSearchCollapseSignal || null}
        disableExpandedRowAnimation={Boolean(structureEditor.structureFilter)}
        searchActions={
          structureSearchEnabled ? (
            <Button type="button" variant="modern" size="lg" onClick={structureEditor.handleOpenStructureDialog}>
              <ScanSearch className="size-4" />
              {structureEditor.structureFilter ? '重新绘制' : '结构检索'}
            </Button>
          ) : undefined
        }
        emptyText={structureEditor.structureFilter ? '没有匹配结构的库存' : '暂无数据'}
        noteField="notes"
        renderExpandedRow={renderExpandedRow}
        inlineCompletionEndpoint="/inventory/"
        enableInlineCompletion
      />
    </div>
  )
}

const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onBorrow
}: {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onBorrow: (item: InventoryItem) => void | Promise<void>
}) {
  const currentUser = useAuthStore((state) => state.user)
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC

  const statusDisplay = useMemo(() => {
    const statusList = [
      {
        value: 'borrowed',
        label: item.borrower_name ? `${item.borrower_name}借用` : '借用中',
        className: 'text-base text-blue-800 dark:text-blue-200',
        title: item.borrower_name ? `借用者: ${item.borrower_name}` : undefined
      }
    ]

    if (item.status === 'in_stock' && !item.storage_location && item.temporary_keeper_name) {
      statusList.push({
        value: 'in_stock',
        label: `${item.temporary_keeper_name}暂存`,
        className: 'text-base text-orange-700 dark:text-orange-300',
        title: `暂存人: ${item.temporary_keeper_name}`
      })
    }

    return statusList
  }, [item.borrower_name, item.status, item.storage_location, item.temporary_keeper_name])

  const actions = useMemo(() => {
    return [
      {
        id: 'borrow',
        label: '借用',
        className: isPublicUser ? 'h-8 px-3' : undefined,
        confirm: !isPublicUser,
        confirmLabel: isPublicUser ? undefined : '确认',
        showWhen: (currItem: InventoryItem) =>
          currItem.status === 'in_stock' && !currItem.temporary_keeper_id,
        onClick: async (currItem: InventoryItem) => {
          await onBorrow(currItem)
        }
      }
    ]
  }, [isPublicUser, onBorrow])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
      statusField="status"
      statusDisplay={statusDisplay}
    />
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit || prevProps.onBorrow !== nextProps.onBorrow) {
    return false;
  }

  const prevItem = prevProps.item as unknown as Record<string, unknown>
  const nextItem = nextProps.item as unknown as Record<string, unknown>

  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
