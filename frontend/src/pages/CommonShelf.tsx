import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Archive, ArrowUpFromLine, Database, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'

import {
  chemicalNameMapAPI,
  commonShelfAPI,
  reagentOrderAPI,
  ReagentOrderReason,
  type ChemicalCategory,
  type ChemicalNameMapItem,
  type CommonShelfGroup,
  type CommonShelfGroupItem,
} from '@/api/client'
import { BaseForm } from '@/components/BaseForm'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { FilterTable } from '@/components/ui/FilterTable'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import type { FilterAPI, FilterOption } from '@/hooks/useTableState'
import { UserRoles } from '@/lib/constants'
import { canWriteNonPublicData } from '@/lib/permissions'
import {
  getCommonShelfQuickOrderFormFields,
} from '@/lib/formConfigs'
import {
  getReagentBrandOptionsQueryOptions,
} from '@/lib/reagentBrandOptions'
import { COMMON_SHELF_SSE_EVENTS } from '@/lib/sseEvents'
import {
  COMMON_SHELF_EMPTY_LOCATION_VALUE,
  COMMON_SHELF_GROUP_SEARCH_FIELD_OPTIONS,
  getChemicalNameMapTableColumns,
  getCommonShelfGroupTableColumns,
} from '@/lib/tableConfigs'
import { toast } from '@/lib/toast'
import {
  applyValidationErrors,
  ChemicalNameMapSchema,
  CommonShelfAddBottlesSchema,
  CommonShelfGroupEditSchema,
  CommonShelfManualAddSchema,
  CommonShelfQuickOrderSchema,
  CommonShelfRemoveOneSchema,
  type ChemicalNameMapFormData,
  type ChemicalNameMapFormInputData,
  type CommonShelfAddBottlesData,
  type CommonShelfAddBottlesInputData,
  type CommonShelfGroupEditData,
  type CommonShelfGroupEditInputData,
  type CommonShelfItemEditRowData,
  type CommonShelfManualAddData,
  type CommonShelfManualAddInputData,
  type CommonShelfQuickOrderData,
  type CommonShelfQuickOrderInputData,
  type CommonShelfRemoveOneData,
  type CommonShelfRemoveOneInputData,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  normalizeApiErrorMessage,
  toValidationErrors,
} from '@/lib/validationSchemas'
import {
  downloadBlobResponse,
  formatChinaDateForFilename,
  formatDate,
  processNotes,
} from '@/lib/utils'
import {
  ChemicalNameMapEditorDialog,
  ChemicalNameMapManagementDialog,
  CommonShelfDialogs,
  type ChemicalNameMapEditorController,
  type CommonShelfDialogController,
  type CommonShelfDialogMode,
} from '@/components/CommonShelfDialogs'
import { useAuthStore } from '@/store/useStore'

const DEFAULT_MANUAL_ADD_FORM: CommonShelfManualAddInputData = {
  cas_number: '',
  name_snapshot: '',
  brand: '',
  purity: '',
  specification: '',
  count: '1',
  storage_location: '',
  notes: '',
}

const DEFAULT_EDIT_FORM: CommonShelfGroupEditInputData = {
  brand: '',
  specification: '',
  confirm_merge: undefined,
}

const DEFAULT_ADD_BOTTLES_FORM: CommonShelfAddBottlesInputData = {
  count: '1',
  storage_location: '',
  purity: '',
  notes: '',
}

const DEFAULT_QUICK_ORDER_FORM: CommonShelfQuickOrderInputData = {
  quantity: '1',
  price: undefined as unknown as number,
  purity: '',
  notes: '',
}

const DEFAULT_REMOVE_ONE_FORM: CommonShelfRemoveOneInputData = {
  storage_location: '',
}

const DEFAULT_CHEMICAL_NAME_MAP_FORM: ChemicalNameMapFormInputData = {
  cas_number: '',
  name: '',
  english_name: '',
  alias_1: '',
  alias_2: '',
  alias_3: '',
  category: 'other',
}
const COMMON_SHELF_STATUS_FILTER_OPTIONS: FilterOption[] = []

type ManualAddPayload = {
  cas_number: string
  name_snapshot: string
  brand: string
  purity?: string
  specification: string
  count: number
  storage_location?: string
  notes?: string
}

type CommonShelfDialogForms = CommonShelfDialogController['forms']

type CommonShelfQuickOrderController = {
  state: {
    targetGroup: CommonShelfGroup | null
    isSubmitting: boolean
  }
  form: UseFormReturn<CommonShelfQuickOrderInputData, unknown, CommonShelfQuickOrderData>
  actions: {
    openQuickOrderDialog: (item: CommonShelfGroup) => void
    handleOpenChange: (open: boolean) => void
    handleSubmit: () => Promise<void>
  }
}

type CommonShelfDialogControllerParams = {
  refreshCommonShelf: () => Promise<void>
  onRequireChemicalNameMap: (payload: ManualAddPayload) => void
}

type CommonShelfPageController = {
  dialogController: CommonShelfDialogController
  chemicalNameMapController: ReturnType<typeof useChemicalNameMapController>
  quickOrderController: CommonShelfQuickOrderController
  brandOptions: { label: string; value: string }[]
  columns: ColumnDef<Record<string, unknown>, unknown>[]
  renderExpandedRow: (itemRaw: Record<string, unknown>) => ReactElement
  refreshCommonShelf: () => Promise<void>
  handleExport: () => Promise<void>
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = (value || '').trim()
  return trimmed ? trimmed : undefined
}

function normalizeCategoryValue(value: string | null | undefined): ChemicalCategory | null {
  return (normalizeOptionalText(value) as ChemicalCategory | undefined) ?? null
}

function normalizeLocationValue(value: string) {
  if (value === COMMON_SHELF_EMPTY_LOCATION_VALUE) {
    return undefined
  }
  return normalizeOptionalText(value)
}

function buildCommonShelfEditForm(item: CommonShelfGroup): CommonShelfGroupEditInputData {
  return {
    brand: item.group.brand || '',
    specification: item.group.specification_text || '',
    confirm_merge: undefined,
  }
}

function buildChemicalNameMapForm(item: ChemicalNameMapItem | null): ChemicalNameMapFormInputData {
  if (!item) {
    return DEFAULT_CHEMICAL_NAME_MAP_FORM
  }

  return {
    cas_number: item.cas_number,
    name: item.name,
    english_name: item.english_name || '',
    alias_1: item.alias_1 || '',
    alias_2: item.alias_2 || '',
    alias_3: item.alias_3 || '',
    category: item.category || 'other',
  }
}

function buildManualAddPayload(data: CommonShelfManualAddData): ManualAddPayload {
  return {
    cas_number: data.cas_number,
    name_snapshot: data.name_snapshot,
    brand: data.brand,
    purity: normalizeOptionalText(data.purity),
    specification: data.specification,
    count: data.count,
    storage_location: normalizeOptionalText(data.storage_location),
    notes: normalizeOptionalText(data.notes),
  }
}

function buildChemicalNameMapPayload(data: ChemicalNameMapFormData) {
  return {
    cas_number: data.cas_number,
    name: data.name,
    english_name: normalizeOptionalText(data.english_name),
    alias_1: normalizeOptionalText(data.alias_1),
    alias_2: normalizeOptionalText(data.alias_2),
    alias_3: normalizeOptionalText(data.alias_3),
    category: normalizeCategoryValue(data.category),
  }
}

function getQuickOrderBrand(item: CommonShelfGroup) {
  return normalizeOptionalText(item.group.brand)
}

function buildQuickOrderPayload(item: CommonShelfGroup, data: CommonShelfQuickOrderData) {
  const brand = getQuickOrderBrand(item)
  if (!brand) {
    return null
  }

  return {
    cas_number: item.group.cas_number,
    name: item.display.name,
    english_name: normalizeOptionalText(item.display.english_name),
    category: normalizeOptionalText(item.display.category),
    brand,
    purity: normalizeOptionalText(data.purity),
    specification: item.group.specification_text,
    quantity: data.quantity,
    price: data.price,
    order_reason: ReagentOrderReason.COMMON_PUBLIC,
    notes: processNotes(data.notes),
  }
}

function toCommonShelfGroup(row: Record<string, unknown>) {
  return row as unknown as CommonShelfGroup
}

function canDeleteCommonShelfGroup(group: CommonShelfGroup | null): group is CommonShelfGroup {
  return Boolean(group && group.bottle_count === 0)
}

function formatAliasList(values: readonly unknown[]) {
  const aliases = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return aliases.length > 0 ? aliases.join(' / ') : '-'
}

function renderChemicalAliases(row: Record<string, unknown>) {
  return formatAliasList([row.alias_1, row.alias_2, row.alias_3])
}

function renderCommonShelfAliases(item: CommonShelfGroup) {
  return formatAliasList([item.display.alias_1, item.display.alias_2, item.display.alias_3])
}

function renderCommonShelfLocations(item: CommonShelfGroup) {
  const recentLocations = item.recent_locations ?? []
  const locationsText = recentLocations.length > 0
    ? recentLocations
        .map((location) => `${location.storage_location || '未填写'}（${location.bottle_count}瓶）`)
        .join(' / ')
    : '-'
  return item.location_count > 3 ? `${locationsText}（${item.location_count}个位置）` : locationsText
}

function useCommonShelfDialogForms(): CommonShelfDialogForms {
  return {
    manualAddForm: useForm<CommonShelfManualAddInputData, unknown, CommonShelfManualAddData>({
      resolver: createValibotResolver(CommonShelfManualAddSchema),
      defaultValues: DEFAULT_MANUAL_ADD_FORM,
    }),
    editForm: useForm<CommonShelfGroupEditInputData, unknown, CommonShelfGroupEditData>({
      resolver: createValibotResolver(CommonShelfGroupEditSchema),
      defaultValues: DEFAULT_EDIT_FORM,
    }),
    addBottlesForm: useForm<CommonShelfAddBottlesInputData, unknown, CommonShelfAddBottlesData>({
      resolver: createValibotResolver(CommonShelfAddBottlesSchema),
      defaultValues: DEFAULT_ADD_BOTTLES_FORM,
    }),
    removeOneForm: useForm<CommonShelfRemoveOneInputData, unknown, CommonShelfRemoveOneData>({
      resolver: createValibotResolver(CommonShelfRemoveOneSchema),
      defaultValues: DEFAULT_REMOVE_ONE_FORM,
    }),
  }
}

function resetCommonShelfDialogForms(forms: CommonShelfDialogForms) {
  forms.manualAddForm.reset(DEFAULT_MANUAL_ADD_FORM)
  forms.editForm.reset(DEFAULT_EDIT_FORM)
  forms.addBottlesForm.reset(DEFAULT_ADD_BOTTLES_FORM)
  forms.removeOneForm.reset(DEFAULT_REMOVE_ONE_FORM)
}

function useCommonShelfDialogState(forms: CommonShelfDialogForms) {
  const [mode, setMode] = useState<CommonShelfDialogMode>(null)
  const [selectedGroup, setSelectedGroup] = useState<CommonShelfGroup | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editNeedsMergeConfirm, setEditNeedsMergeConfirm] = useState(false)

  const resetDialogState = useCallback(() => {
    setMode(null)
    setSelectedGroup(null)
    setDeleteConfirm(false)
    setEditNeedsMergeConfirm(false)
    resetCommonShelfDialogForms(forms)
  }, [forms])

  const openManualAddDialog = useCallback(() => {
    resetDialogState()
    setMode('manual-add')
  }, [resetDialogState])

  const openEditDialog = useCallback((item: CommonShelfGroup) => {
    resetDialogState()
    setSelectedGroup(item)
    forms.editForm.reset(buildCommonShelfEditForm(item))
    setMode('edit')
  }, [forms.editForm, resetDialogState])

  const openAddBottlesDialog = useCallback((item: CommonShelfGroup) => {
    resetDialogState()
    setSelectedGroup(item)
    setMode('add-bottles')
  }, [resetDialogState])

  const openRemoveOneDialog = useCallback((item: CommonShelfGroup) => {
    resetDialogState()
    setSelectedGroup(item)
    setMode('remove-one')
  }, [resetDialogState])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) resetDialogState()
  }, [resetDialogState])

  return {
    mode,
    selectedGroup,
    deleteConfirm,
    editNeedsMergeConfirm,
    setDeleteConfirm,
    setEditNeedsMergeConfirm,
    resetDialogState,
    openManualAddDialog,
    openEditDialog,
    openAddBottlesDialog,
    openRemoveOneDialog,
    handleOpenChange,
  }
}

function CommonShelfExpandedRow({ item }: Readonly<{ item: CommonShelfGroup }>) {
  return (
    <div className="flex min-h-[124px] flex-col gap-4 border-b border-border p-3 md:flex-row">
      <div className="hidden shrink-0 md:block">
        <MoleculeStructure casNumber={item.group.cas_number} width={150} height={100} />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-x-6 gap-y-2 md:m-2 md:grid-cols-2">
        <div className="break-words">英文名称：{item.display.english_name || '-'}</div>
        <div className="break-words">别名：{renderCommonShelfAliases(item)}</div>
        <div className="break-words md:col-span-2">位置：{renderCommonShelfLocations(item)}</div>
        <div>创建时间：{formatDate(item.created_at)}</div>
        <div>最近变动：{formatDate(item.updated_at)}</div>
      </div>
    </div>
  )
}

function createCommonShelfColumns(params: {
  onEdit: (item: CommonShelfGroup) => void
  onAddBottles: (item: CommonShelfGroup) => void
  onRemoveOne: (item: CommonShelfGroup) => void
  onQuickOrder: (item: CommonShelfGroup) => void
  showQuickOrder: boolean
}) {
  return getCommonShelfGroupTableColumns({
    renderActions: (row) => {
      const item = row as unknown as CommonShelfGroup
      return (
        <CommonShelfActionButtons
          item={item}
          onEdit={params.onEdit}
          onAddBottles={params.onAddBottles}
          onRemoveOne={params.onRemoveOne}
          onQuickOrder={params.onQuickOrder}
          showQuickOrder={params.showQuickOrder}
        />
      )
    },
  }) as unknown as ColumnDef<Record<string, unknown>, unknown>[]
}

function createChemicalNameMapColumns(params: {
  canWrite: boolean
  onEdit: (item: ChemicalNameMapItem) => void
  onDelete: (item: ChemicalNameMapItem) => Promise<void>
}) {
  return getChemicalNameMapTableColumns({
    renderAliases: renderChemicalAliases,
    renderActions: params.canWrite
      ? (row) => {
        const item = row as unknown as ChemicalNameMapItem
        return (
          <ChemicalNameMapActionButtons
            item={item}
            onEdit={params.onEdit}
            onDelete={params.onDelete}
          />
        )
      }
      : undefined,
  }) as unknown as ColumnDef<Record<string, unknown>, unknown>[]
}

function applyFormValidationDetail(
  detail: unknown,
  setFieldError: (fieldName: string, message: string) => void,
) {
  return applyValidationErrors(toValidationErrors(detail), setFieldError)
}

const QUICK_ORDER_FIELD_NAMES = new Set(['quantity', 'price', 'purity', 'notes'])

function applyQuickOrderValidationDetail(
  detail: unknown,
  setFieldError: (fieldName: string, message: string) => void,
) {
  let applied = false
  toValidationErrors(detail).forEach((errorItem) => {
    const fieldName = errorItem.loc?.[1]
    if (!QUICK_ORDER_FIELD_NAMES.has(String(fieldName))) {
      return
    }
    setFieldError(String(fieldName), errorItem.msg || '输入不合法')
    applied = true
  })
  return applied
}

// 把字符串字段名统一映射到 react-hook-form 的 setError，避免每个提交处理器都写一遍类型转换。
function createFormFieldErrorSetter<TInput extends FieldValues, TOutput>(
  form: Pick<UseFormReturn<TInput, unknown, TOutput>, 'setError'>,
) {
  return (fieldName: string, message: string) => {
    type FormFieldName = Parameters<typeof form.setError>[0]
    form.setError(fieldName as FormFieldName, { message })
  }
}

// 多个提交流程都需要同样的 loading 包装；这里只抽公共壳子，不隐藏具体业务逻辑。
async function runWithSubmitting(
  setIsSubmitting: (value: boolean) => void,
  task: () => Promise<void>,
) {
  setIsSubmitting(true)
  try {
    await task()
  } finally {
    setIsSubmitting(false)
  }
}

function useCommonShelfQuickOrderController({
  refreshReagentOrders,
}: {
  refreshReagentOrders: () => Promise<void>
}): CommonShelfQuickOrderController {
  const [targetGroup, setTargetGroup] = useState<CommonShelfGroup | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<CommonShelfQuickOrderInputData, unknown, CommonShelfQuickOrderData>({
    resolver: createValibotResolver(CommonShelfQuickOrderSchema),
    defaultValues: DEFAULT_QUICK_ORDER_FORM,
  })

  const resetQuickOrderDialog = useCallback(() => {
    setTargetGroup(null)
    form.reset(DEFAULT_QUICK_ORDER_FORM)
  }, [form])

  const openQuickOrderDialog = useCallback((item: CommonShelfGroup) => {
    if (!normalizeOptionalText(item.display.name)) {
      toast.error('当前 CAS 主数据缺少名称，请先补录后再快速购买')
      return
    }
    if (!getQuickOrderBrand(item)) {
      toast.error('当前分组缺少品牌，请先编辑分组品牌后再快速购买')
      return
    }
    form.reset(DEFAULT_QUICK_ORDER_FORM)
    setTargetGroup(item)
  }, [form])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      resetQuickOrderDialog()
    }
  }, [resetQuickOrderDialog])

  const handleSubmit = useCallback(async () => {
    await form.handleSubmit(async (data) => {
      const item = targetGroup
      if (!item) {
        return
      }
      const payload = buildQuickOrderPayload(item, data)
      if (!payload) {
        toast.error('当前分组缺少品牌，请先编辑分组品牌后再快速购买')
        return
      }

      await runWithSubmitting(setIsSubmitting, async () => {
        try {
          await reagentOrderAPI.create(payload)
          toast.success('常用试剂订单已提交')
          resetQuickOrderDialog()
          await refreshReagentOrders()
        } catch (error) {
          const errorDetail = extractApiErrorDetail(error)
          if (applyQuickOrderValidationDetail(errorDetail, createFormFieldErrorSetter(form))) {
            return
          }
          toast.error(normalizeApiErrorMessage(errorDetail, '提交失败'))
        }
      })
    })()
  }, [form, refreshReagentOrders, resetQuickOrderDialog, targetGroup])

  return {
    state: {
      targetGroup,
      isSubmitting,
    },
    form,
    actions: {
      openQuickOrderDialog,
      handleOpenChange,
      handleSubmit,
    },
  }
}

async function executeCommonShelfManualAdd(params: {
  payload: ManualAddPayload
  setFieldError: (fieldName: string, message: string) => void
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
  onRequireChemicalNameMap: (payload: ManualAddPayload) => void
}) {
  const { payload, setFieldError, refreshCommonShelf, resetDialogState, onRequireChemicalNameMap } = params

  try {
    await commonShelfAPI.manualAdd(payload)
    toast.success('已加入常用货架')
    resetDialogState()
    await refreshCommonShelf()
  } catch (error) {
    const errorDetail = extractApiErrorDetail(error)
    if (typeof errorDetail === 'string' && /CAS master data not found/i.test(errorDetail)) {
      // 先补 chemical_name_map，再续写这次手动加瓶，避免货架页出现无法展示名称的脏数据。
      onRequireChemicalNameMap(payload)
      return
    }
    if (applyFormValidationDetail(errorDetail, setFieldError)) {
      return
    }
    toast.error(normalizeApiErrorMessage(errorDetail, '添加失败'))
  }
}

async function executeCommonShelfGroupEdit(params: {
  groupKey: string
  data: CommonShelfGroupEditData
  editNeedsMergeConfirm: boolean
  setEditNeedsMergeConfirm: (value: boolean) => void
  setFieldError: (fieldName: string, message: string) => void
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const {
    groupKey,
    data,
    editNeedsMergeConfirm,
    setEditNeedsMergeConfirm,
    setFieldError,
    refreshCommonShelf,
    resetDialogState,
  } = params

  try {
      const response = await commonShelfAPI.updateGroup(groupKey, {
      brand: data.brand,
      specification: data.specification,
      // merge 是两阶段确认：第一次只探测撞组，第二次才真的写库。
      confirm_merge: editNeedsMergeConfirm || undefined,
    })

    if (response.data?.requires_confirmation) {
      setEditNeedsMergeConfirm(true)
      toast.error(String(response.data.message || '修改后将与其他分组合并，请再次确认'))
      return
    }

    toast.success('常用货架分组已更新')
    resetDialogState()
    await refreshCommonShelf()
  } catch (error) {
    const errorDetail = extractApiErrorDetail(error)
    if (applyFormValidationDetail(errorDetail, setFieldError)) {
      return
    }
    toast.error(normalizeApiErrorMessage(errorDetail, '保存失败'))
  }
}

async function executeCommonShelfItemEdit(params: {
  groupKey: string
  itemId: number
  data: CommonShelfItemEditRowData
  setFieldError: (fieldName: string, message: string) => void
  refreshCommonShelf: () => Promise<void>
}) {
  const { groupKey, itemId, data, setFieldError, refreshCommonShelf } = params

  try {
    await commonShelfAPI.updateItem(groupKey, itemId, {
      purity: normalizeOptionalText(data.purity),
      storage_location: normalizeOptionalText(data.storage_location),
      notes: normalizeOptionalText(data.notes),
    })
    toast.success('常用货架条目已更新')
    await refreshCommonShelf()
  } catch (error) {
    const errorDetail = extractApiErrorDetail(error)
    if (applyFormValidationDetail(errorDetail, setFieldError)) {
      return
    }
    toast.error(normalizeApiErrorMessage(errorDetail, '保存失败'))
  }
}

async function executeCommonShelfItemDelete(params: {
  groupKey: string
  itemId: number
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const { groupKey, itemId, refreshCommonShelf, resetDialogState } = params

  try {
    const response = await commonShelfAPI.deleteItem(groupKey, itemId)
    toast.success('常用货架条目已删除')
    if (response.data?.group_exists === false) {
      resetDialogState()
    }
    await refreshCommonShelf()
  } catch (error) {
    toast.error(getApiErrorMessage(error, '删除失败'))
  }
}

async function executeCommonShelfAddBottles(params: {
  groupKey: string
  data: CommonShelfAddBottlesData
  setFieldError: (fieldName: string, message: string) => void
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const { groupKey, data, setFieldError, refreshCommonShelf, resetDialogState } = params

  try {
    await commonShelfAPI.addBottles(groupKey, {
      count: data.count,
      storage_location: normalizeOptionalText(data.storage_location),
      purity: normalizeOptionalText(data.purity),
      notes: normalizeOptionalText(data.notes),
    })
    toast.success('常用货架已加瓶')
    resetDialogState()
    await refreshCommonShelf()
  } catch (error) {
    const errorDetail = extractApiErrorDetail(error)
    if (applyFormValidationDetail(errorDetail, setFieldError)) {
      return
    }
    toast.error(normalizeApiErrorMessage(errorDetail, '加瓶失败'))
  }
}

async function executeCommonShelfRemoveOne(params: {
  groupKey: string
  data: CommonShelfRemoveOneData
  setFieldError: (fieldName: string, message: string) => void
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const { groupKey, data, setFieldError, refreshCommonShelf, resetDialogState } = params

  try {
    await commonShelfAPI.removeOne(groupKey, {
      storage_location: normalizeLocationValue(data.storage_location),
    })
    toast.success('已扣减 1 瓶')
    resetDialogState()
    await refreshCommonShelf()
  } catch (error) {
    const errorDetail = extractApiErrorDetail(error)
    if (applyFormValidationDetail(errorDetail, setFieldError)) {
      return
    }
    toast.error(normalizeApiErrorMessage(errorDetail, '扣减失败'))
  }
}

async function executeCommonShelfDeleteGroup(params: {
  groupKey: string
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const { groupKey, refreshCommonShelf, resetDialogState } = params

  try {
    await commonShelfAPI.deleteGroup(groupKey)
    toast.success('常用货架分组已删除')
    resetDialogState()
    await refreshCommonShelf()
  } catch (error) {
    toast.error(getApiErrorMessage(error, '删除失败'))
  }
}

function useCommonShelfItemEditActions(params: {
  mode: CommonShelfDialogMode
  selectedGroup: CommonShelfGroup | null
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
}) {
  const { mode, selectedGroup, refreshCommonShelf, resetDialogState } = params
  const [submittingItemId, setSubmittingItemId] = useState<number | null>(null)
  const [deleteItemConfirmId, setDeleteItemConfirmId] = useState<number | null>(null)

  const handleSubmitEditItem = useCallback(async (
    item: CommonShelfGroupItem,
    data: CommonShelfItemEditRowData,
    setFieldError: (fieldName: string, message: string) => void,
  ) => {
    if (!selectedGroup) return
    setSubmittingItemId(item.id)
    try {
      await executeCommonShelfItemEdit({
        groupKey: selectedGroup.group.group_key,
        itemId: item.id,
        data,
        setFieldError,
        refreshCommonShelf,
      })
    } finally {
      setSubmittingItemId(null)
    }
  }, [refreshCommonShelf, selectedGroup])

  const handleDeleteEditItem = useCallback(async (item: CommonShelfGroupItem) => {
    if (!selectedGroup) return
    if (deleteItemConfirmId !== item.id) {
      setDeleteItemConfirmId(item.id)
      return
    }

    setSubmittingItemId(item.id)
    try {
      await executeCommonShelfItemDelete({
        groupKey: selectedGroup.group.group_key,
        itemId: item.id,
        refreshCommonShelf,
        resetDialogState,
      })
      setDeleteItemConfirmId(null)
    } finally {
      setSubmittingItemId(null)
    }
  }, [deleteItemConfirmId, refreshCommonShelf, resetDialogState, selectedGroup])

  const handleCancelDeleteEditItemConfirm = useCallback((item: CommonShelfGroupItem) => {
    setDeleteItemConfirmId((currentId) => (currentId === item.id ? null : currentId))
  }, [])

  useEffect(() => {
    if (mode === 'edit') {
      return
    }
    setSubmittingItemId(null)
    setDeleteItemConfirmId(null)
  }, [mode])

  return {
    submittingItemId,
    deleteItemConfirmId,
    handleSubmitEditItem,
    handleDeleteEditItem,
    handleCancelDeleteEditItemConfirm,
  }
}

function useCommonShelfGroupEditActions(params: {
  deleteConfirm: boolean
  editNeedsMergeConfirm: boolean
  editForm: CommonShelfDialogForms['editForm']
  refreshCommonShelf: () => Promise<void>
  resetDialogState: () => void
  selectedGroup: CommonShelfGroup | null
  setDeleteConfirm: (value: boolean) => void
  setEditNeedsMergeConfirm: (value: boolean) => void
  setIsSubmitting: (value: boolean) => void
}) {
  const {
    deleteConfirm,
    editNeedsMergeConfirm,
    editForm,
    refreshCommonShelf,
    resetDialogState,
    selectedGroup,
    setDeleteConfirm,
    setEditNeedsMergeConfirm,
    setIsSubmitting,
  } = params

  const handleSubmitEdit = useCallback(async () => {
    await editForm.handleSubmit(async (data) => {
      if (!selectedGroup) return
      await runWithSubmitting(setIsSubmitting, async () => {
        await executeCommonShelfGroupEdit({
          groupKey: selectedGroup.group.group_key,
          data,
          editNeedsMergeConfirm,
          setEditNeedsMergeConfirm,
          setFieldError: createFormFieldErrorSetter(editForm),
          refreshCommonShelf,
          resetDialogState,
        })
      })
    })()
  }, [editForm, editNeedsMergeConfirm, refreshCommonShelf, resetDialogState, selectedGroup, setEditNeedsMergeConfirm, setIsSubmitting])

  const handleDelete = useCallback(async () => {
    const group = selectedGroup
    if (!canDeleteCommonShelfGroup(group)) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    await runWithSubmitting(setIsSubmitting, async () => {
      await executeCommonShelfDeleteGroup({
        groupKey: group.group.group_key,
        refreshCommonShelf,
        resetDialogState,
      })
    })
  }, [deleteConfirm, refreshCommonShelf, resetDialogState, selectedGroup, setDeleteConfirm, setIsSubmitting])

  useEffect(() => {
    const subscription = editForm.watch((_value, info) => {
      if (!editNeedsMergeConfirm) {
        return
      }
      if (info.name === 'brand' || info.name === 'specification') {
        setEditNeedsMergeConfirm(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [editForm, editNeedsMergeConfirm, setEditNeedsMergeConfirm])

  return {
    handleSubmitEdit,
    handleDelete,
  }
}

// 这里集中管理常用货架弹窗，主页面只负责“何时打开、刷新什么”，避免再分散成多层只转发参数的 hook。
function useCommonShelfDialogController({
  refreshCommonShelf,
  onRequireChemicalNameMap,
}: CommonShelfDialogControllerParams): CommonShelfDialogController {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const forms = useCommonShelfDialogForms()
  const {
    manualAddForm,
    editForm,
    addBottlesForm,
    removeOneForm,
  } = forms
  const {
    mode,
    selectedGroup,
    deleteConfirm,
    editNeedsMergeConfirm,
    setDeleteConfirm,
    setEditNeedsMergeConfirm,
    resetDialogState,
    openManualAddDialog,
    openEditDialog,
    openAddBottlesDialog,
    openRemoveOneDialog,
    handleOpenChange,
  } = useCommonShelfDialogState(forms)

  const handleSubmitManualAdd = useCallback(async () => {
    await manualAddForm.handleSubmit(async (data) => {
      await runWithSubmitting(setIsSubmitting, async () => {
        await executeCommonShelfManualAdd({
          payload: buildManualAddPayload(data),
          setFieldError: createFormFieldErrorSetter(manualAddForm),
          refreshCommonShelf,
          resetDialogState,
          onRequireChemicalNameMap,
        })
      })
    })()
  }, [manualAddForm, onRequireChemicalNameMap, refreshCommonShelf, resetDialogState])

  const handleSubmitAddBottles = useCallback(async () => {
    await addBottlesForm.handleSubmit(async (data) => {
      if (!selectedGroup) return
      await runWithSubmitting(setIsSubmitting, async () => {
        await executeCommonShelfAddBottles({
          groupKey: selectedGroup.group.group_key,
          data,
          setFieldError: createFormFieldErrorSetter(addBottlesForm),
          refreshCommonShelf,
          resetDialogState,
        })
      })
    })()
  }, [addBottlesForm, refreshCommonShelf, resetDialogState, selectedGroup])

  const handleSubmitRemoveOne = useCallback(async () => {
    await removeOneForm.handleSubmit(async (data) => {
      if (!selectedGroup) return
      if (!data.storage_location) {
        removeOneForm.setError('storage_location', { message: '请选择位置' })
        return
      }
      await runWithSubmitting(setIsSubmitting, async () => {
        await executeCommonShelfRemoveOne({
          groupKey: selectedGroup.group.group_key,
          data,
          setFieldError: createFormFieldErrorSetter(removeOneForm),
          refreshCommonShelf,
          resetDialogState,
        })
      })
    })()
  }, [refreshCommonShelf, removeOneForm, resetDialogState, selectedGroup])

  const {
    submittingItemId,
    deleteItemConfirmId,
    handleSubmitEditItem,
    handleDeleteEditItem,
    handleCancelDeleteEditItemConfirm,
  } = useCommonShelfItemEditActions({
    mode,
    selectedGroup,
    refreshCommonShelf,
    resetDialogState,
  })
  const {
    handleSubmitEdit,
    handleDelete,
  } = useCommonShelfGroupEditActions({
    deleteConfirm,
    editNeedsMergeConfirm,
    editForm,
    refreshCommonShelf,
    resetDialogState,
    selectedGroup,
    setDeleteConfirm,
    setEditNeedsMergeConfirm,
    setIsSubmitting,
  })

  return {
    state: {
      mode,
      selectedGroup,
      isSubmitting,
      deleteConfirm,
      editNeedsMergeConfirm,
    },
    forms,
    itemEdit: {
      submittingItemId,
      deleteItemConfirmId,
      handleSubmitEditItem,
      handleDeleteEditItem,
      handleCancelDeleteEditItemConfirm,
    },
    actions: {
      handleOpenChange,
      handleSubmitManualAdd,
      handleSubmitEdit,
      handleSubmitAddBottles,
      handleSubmitRemoveOne,
      handleDelete,
      openManualAddDialog,
      openEditDialog,
      openAddBottlesDialog,
      openRemoveOneDialog,
      resetDialogState,
    },
  }
}

function useChemicalNameMapController({
  canWrite,
  refreshChemicalNameMap,
  refreshCommonShelf,
  resetCommonShelfDialog,
}: {
  canWrite: boolean
  refreshChemicalNameMap: () => Promise<void>
  refreshCommonShelf: () => Promise<void>
  resetCommonShelfDialog: () => void
}) {
  const [managementOpen, setManagementOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ChemicalNameMapItem | null>(null)
  const [pendingManualAddPayload, setPendingManualAddPayload] = useState<ManualAddPayload | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<ChemicalNameMapFormInputData, unknown, ChemicalNameMapFormData>({
    resolver: createValibotResolver(ChemicalNameMapSchema),
    defaultValues: DEFAULT_CHEMICAL_NAME_MAP_FORM,
  })

  const resetChemicalNameMapEditor = useCallback((clearPendingManualAdd = true) => {
    setEditorOpen(false)
    setEditingItem(null)
    form.reset(DEFAULT_CHEMICAL_NAME_MAP_FORM)
    if (clearPendingManualAdd) {
      setPendingManualAddPayload(null)
    }
  }, [form, setPendingManualAddPayload])

  const openChemicalNameMapCreateDialog = useCallback((params?: {
    prefill?: Partial<ChemicalNameMapFormInputData>
    keepPendingManualAdd?: boolean
  }) => {
    if (!canWrite) return

    setEditingItem(null)
    form.reset({
      ...DEFAULT_CHEMICAL_NAME_MAP_FORM,
      ...params?.prefill,
    })
    if (!params?.keepPendingManualAdd) {
      setPendingManualAddPayload(null)
    }
    setEditorOpen(true)
  }, [canWrite, form, setPendingManualAddPayload])

  const openChemicalNameMapEditDialog = useCallback((item: ChemicalNameMapItem) => {
    if (!canWrite) return

    setEditingItem(item)
    form.reset(buildChemicalNameMapForm(item))
    setEditorOpen(true)
  }, [canWrite, form])

  const promptCreateForMissingCas = useCallback((payload: ManualAddPayload) => {
    if (!canWrite) return toast.error('公用用户只能查看 CAS 主数据')

    setPendingManualAddPayload(payload)
    openChemicalNameMapCreateDialog({
      keepPendingManualAdd: true,
      prefill: {
        cas_number: payload.cas_number,
        name: payload.name_snapshot,
      },
    })
    toast.warning('该 CAS 还未录入主数据，请先补录')
  }, [canWrite, openChemicalNameMapCreateDialog])

  const handleDeleteChemicalNameMap = useCallback(async (item: ChemicalNameMapItem) => {
    if (!canWrite) return

    try {
      await chemicalNameMapAPI.delete(item.id)
      toast.success('CAS 主数据已删除')
      await refreshChemicalNameMap()
      await refreshCommonShelf()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [canWrite, refreshChemicalNameMap, refreshCommonShelf])

  const handleSubmit = useCallback(async () => {
    if (!canWrite) return

    await form.handleSubmit(async (data) => {
      const payload = buildChemicalNameMapPayload(data)

      await runWithSubmitting(setIsSubmitting, async () => {
        try {
          if (editingItem) {
            await chemicalNameMapAPI.update(editingItem.id, payload)
            toast.success('CAS 主数据已更新')
          } else {
            await chemicalNameMapAPI.create(payload)
            toast.success('CAS 主数据已新增')
          }

          await refreshChemicalNameMap()
          resetChemicalNameMapEditor(false)

          if (!pendingManualAddPayload) {
            await refreshCommonShelf()
            return
          }

          try {
            // 缺失主数据时，用户补录成功后要把被中断的“加入常用货架”继续执行完。
            await commonShelfAPI.manualAdd(pendingManualAddPayload)
            toast.success('CAS 主数据已录入，并已加入常用货架')
            setPendingManualAddPayload(null)
            resetCommonShelfDialog()
            await refreshCommonShelf()
          } catch (error) {
            setPendingManualAddPayload(null)
            toast.error(getApiErrorMessage(error, 'CAS 主数据已录入，但加入常用货架失败'))
          }
        } catch (error) {
          const errorDetail = extractApiErrorDetail(error)
          if (applyFormValidationDetail(errorDetail, createFormFieldErrorSetter(form))) {
            return
          }
          toast.error(normalizeApiErrorMessage(errorDetail, '保存失败'))
        }
      })
    })()
  }, [
    canWrite,
    editingItem,
    form,
    pendingManualAddPayload,
    refreshChemicalNameMap,
    refreshCommonShelf,
    resetChemicalNameMapEditor,
    resetCommonShelfDialog,
    setPendingManualAddPayload,
  ])

  const columns = useMemo(() => createChemicalNameMapColumns({
    canWrite,
    onEdit: openChemicalNameMapEditDialog,
    onDelete: handleDeleteChemicalNameMap,
  }), [canWrite, handleDeleteChemicalNameMap, openChemicalNameMapEditDialog])

  const editorDialog: ChemicalNameMapEditorController = {
    open: editorOpen,
    editingItem,
    form,
    isSubmitting,
    onOpenChange: (open: boolean) => {
      if (!open) {
        resetChemicalNameMapEditor()
      }
    },
    onSubmit: handleSubmit,
  }

  return {
    canWrite,
    managementOpen,
    setManagementOpen,
    openCreateDialog: () => openChemicalNameMapCreateDialog(),
    promptCreateForMissingCas,
    columns,
    editorDialog,
  }
}

// 收拢货架页的刷新、弹窗、表格列和导出逻辑。
function useCommonShelfPageController(): CommonShelfPageController {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const requireChemicalNameMapRef = useRef<(payload: ManualAddPayload) => void>(() => undefined)
  const canQuickOrder = Boolean(currentUser && currentUser.role !== UserRoles.PUBLIC)
  const canWriteChemicalNameMap = canWriteNonPublicData(currentUser?.role)
  const { data: brandOptions = [] } = useQuery(getReagentBrandOptionsQueryOptions())

  const refreshCommonShelf = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['common-shelf'] }),
      queryClient.invalidateQueries({ queryKey: ['common-shelf-group-items'] }),
      queryClient.invalidateQueries({ queryKey: ['common-shelf-location-suggestions'] }),
      queryClient.invalidateQueries({ queryKey: ['common-shelf-remove-locations'] }),
      queryClient.invalidateQueries({ queryKey: ['common-shelf-order-location-suggestions'] }),
    ])
  }, [queryClient])

  const refreshChemicalNameMap = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['chemical-name-map'] })
  }, [queryClient])

  const refreshReagentOrders = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['reagent-orders'] })
  }, [queryClient])

  const dialogController = useCommonShelfDialogController({
    refreshCommonShelf,
    onRequireChemicalNameMap: (payload) => {
      requireChemicalNameMapRef.current(payload)
    },
  })
  const dialogActions = dialogController.actions
  const quickOrderController = useCommonShelfQuickOrderController({
    refreshReagentOrders,
  })

  const chemicalNameMapController = useChemicalNameMapController({
    canWrite: canWriteChemicalNameMap,
    refreshChemicalNameMap,
    refreshCommonShelf,
    resetCommonShelfDialog: dialogActions.resetDialogState,
  })
  useEffect(() => {
    requireChemicalNameMapRef.current = chemicalNameMapController.promptCreateForMissingCas
  }, [chemicalNameMapController.promptCreateForMissingCas])

  const handleExport = useCallback(async () => {
    try {
      const response = await commonShelfAPI.exportCommonShelf()
      downloadBlobResponse(response, `common_shelf_export_${formatChinaDateForFilename()}.xlsx`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, '导出失败'))
    }
  }, [])

  const columns = useMemo(() => createCommonShelfColumns({
    onEdit: dialogActions.openEditDialog,
    onAddBottles: dialogActions.openAddBottlesDialog,
    onRemoveOne: dialogActions.openRemoveOneDialog,
    onQuickOrder: quickOrderController.actions.openQuickOrderDialog,
    showQuickOrder: canQuickOrder,
  }), [
    canQuickOrder,
    dialogActions.openAddBottlesDialog,
    dialogActions.openEditDialog,
    dialogActions.openRemoveOneDialog,
    quickOrderController.actions.openQuickOrderDialog,
  ])

  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    return <CommonShelfExpandedRow item={toCommonShelfGroup(itemRaw)} />
  }, [])

  return {
    dialogController,
    chemicalNameMapController,
    quickOrderController,
    brandOptions,
    columns,
    renderExpandedRow,
    refreshCommonShelf,
    handleExport,
  }
}

function CommonShelfPageHeader({
  onOpenManualAdd,
  onOpenChemicalNameMapManagement,
  onExport,
}: {
  onOpenManualAdd: () => void
  onOpenChemicalNameMapManagement: () => void
  onExport: () => void
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 className="text-3xl font-bold text-primary">常用货架</h1>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onOpenManualAdd} size="lg">
          <Plus className="mr-1.5 h-4 w-4" />
          手动添加
        </Button>
        <Button variant="modern" size="lg" onClick={onOpenChemicalNameMapManagement}>
          <Database className="mr-1.5 h-4 w-4" />
          CAS 主数据管理
        </Button>
        <Button variant="modern" size="lg" onClick={onExport}>
          <ArrowUpFromLine className="mr-1.5 h-4 w-4" />
          导出
        </Button>
      </div>
    </div>
  )
}

function QuickOrderSummaryField({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{value || '-'}</div>
    </div>
  )
}

function CommonShelfQuickOrderDialog({
  controller,
}: {
  controller: CommonShelfQuickOrderController
}) {
  const { actions, form, state } = controller
  const targetGroup = state.targetGroup
  const fields = useMemo(() => getCommonShelfQuickOrderFormFields(), [])

  return (
    <Dialog open={Boolean(targetGroup)} onOpenChange={actions.handleOpenChange}>
      <DialogContent className="max-h-[85vh] w-[92vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>快速购买常用</DialogTitle>
        </DialogHeader>
        {targetGroup && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              actions.handleSubmit().catch(() => undefined)
            }}
          >
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-border/70 pb-3 sm:grid-cols-2">
              <QuickOrderSummaryField label="名称" value={targetGroup.display.name} />
              <QuickOrderSummaryField label="CAS" value={targetGroup.group.cas_number} />
              <QuickOrderSummaryField label="品牌" value={targetGroup.group.brand} />
              <QuickOrderSummaryField label="规格" value={targetGroup.group.specification_text} />
              <QuickOrderSummaryField label="订购原因" value="公用常用" />
            </div>

            <BaseForm form={form} fields={fields} columns={2} />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="modern"
                size="lg"
                className="min-w-24"
                onClick={() => actions.handleOpenChange(false)}
              >
                取消
              </Button>
              <LoadingButton type="submit" size="lg" className="min-w-36" isLoading={state.isSubmitting}>
                提交订单
              </LoadingButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CommonShelfPage() {
  const {
    dialogController,
    chemicalNameMapController,
    quickOrderController,
    brandOptions,
    columns,
    renderExpandedRow,
    refreshCommonShelf,
    handleExport,
  } = useCommonShelfPageController()
  const dialogActions = dialogController.actions

  return (
    <div className="space-y-6">
      <CommonShelfPageHeader
        onOpenManualAdd={dialogActions.openManualAddDialog}
        onOpenChemicalNameMapManagement={() => chemicalNameMapController.setManagementOpen(true)}
        onExport={() => {
          void handleExport()
        }}
      />

      <CommonShelfDialogs
        dialog={dialogController}
        showDelete={canDeleteCommonShelfGroup(dialogController.state.selectedGroup)}
        brandOptions={brandOptions}
      />

      <CommonShelfQuickOrderDialog controller={quickOrderController} />

      <ChemicalNameMapManagementDialog
        open={chemicalNameMapController.managementOpen}
        canWrite={chemicalNameMapController.canWrite}
        onOpenChange={chemicalNameMapController.setManagementOpen}
        onCreate={chemicalNameMapController.openCreateDialog}
        columns={chemicalNameMapController.columns}
      />

      <ChemicalNameMapEditorDialog dialog={chemicalNameMapController.editorDialog} />

      <FilterTable
        api={commonShelfAPI as FilterAPI}
        queryKey={['common-shelf']}
        tableId="common-shelf-table"
        realtime={{
          room: 'common_shelf',
          eventTypes: COMMON_SHELF_SSE_EVENTS,
          moveUpdatedRowToStartWhenUnsorted: true,
          onRefresh: refreshCommonShelf,
        }}
        customColumns={columns}
        statusOptions={COMMON_SHELF_STATUS_FILTER_OPTIONS}
        searchFieldOptions={COMMON_SHELF_GROUP_SEARCH_FIELD_OPTIONS}
        title={<><Archive className="h-5 w-5" /> 常用货架</>}
        searchPlaceholder="搜索名称、别名、CAS号、品牌..."
        renderExpandedRow={renderExpandedRow}
        emptyText="暂无常用货架记录"
      />
    </div>
  )
}

const CommonShelfActionButtons = function CommonShelfActionButtons({
  item,
  onEdit,
  onAddBottles,
  onRemoveOne,
  onQuickOrder,
  showQuickOrder,
}: {
  item: CommonShelfGroup
  onEdit: (item: CommonShelfGroup) => void
  onAddBottles: (item: CommonShelfGroup) => void
  onRemoveOne: (item: CommonShelfGroup) => void
  onQuickOrder: (item: CommonShelfGroup) => void
  showQuickOrder: boolean
}) {
  const actions = useMemo(() => [
    {
      id: 'quick-order',
      label: '快速购买',
      icon: <ShoppingCart className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950 dark:hover:text-blue-300',
      onClick: onQuickOrder,
      showWhen: () => showQuickOrder,
    },
    {
      id: 'add-bottles',
      label: '加瓶',
      icon: <Plus className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
      onClick: onAddBottles,
    },
    {
      id: 'remove-one',
      label: '扣减 1 瓶',
      icon: <Minus className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      onClick: onRemoveOne,
      showWhen: (currentItem: CommonShelfGroup) => currentItem.bottle_count > 0,
    },
  ], [onAddBottles, onQuickOrder, onRemoveOne, showQuickOrder])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
    />
  )
}

function ChemicalNameMapActionButtons({
  item,
  onEdit,
  onDelete,
}: {
  item: ChemicalNameMapItem
  onEdit: (item: ChemicalNameMapItem) => void
  onDelete: (item: ChemicalNameMapItem) => Promise<void>
}) {
  const actions = useMemo(() => [
    {
      id: 'delete',
      label: '删除',
      icon: <Trash2 className="size-4 text-destructive" />,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      confirm: true,
      confirmLabel: '确认删除',
      onClick: onDelete,
    },
  ], [onDelete])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
    />
  )
}
