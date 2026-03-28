import React, { useMemo, useCallback, useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Archive, ArrowUpFromLine, Plus, ScanSearch } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { FilterTable } from '@/components/ui/FilterTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { chemicalAPI, commonShelfAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import useDialogState from '@/hooks/useDialogState'
import { defaultInventoryValues, getInventoryFormFields } from '@/lib/formConfigs'
import { getCommonShelfTableColumns } from '@/lib/tableConfigs'
import { COMMON_SHELF_BRAND_OPTIONS, COMMON_SHELF_CATEGORY_OPTIONS } from '@/lib/options'
import { COMMON_SHELF_SSE_EVENTS } from '@/lib/sseEvents'
import { useSSEStore } from '@/store/sseStore'
import { downloadBlobResponse, formatDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import {
  InventoryFormSchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  normalizeApiErrorMessage,
  toValidationErrors,
  validateAndNormalizeCASInput,
} from '@/lib/validationSchemas'
import type { InventoryFormData, InventoryFormInputData, ValidationError } from '@/lib/validationSchemas'

// 表格展示、编辑弹窗和操作列都依赖这一组常用货架字段。
interface CommonShelfItem {
  id: number
  sample_inventory_id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number | null
  unit: string | null
  is_hazardous: boolean
  status: string
  created_at: string
  created_by_name?: string | null
  notes?: string | null
  available_bottles: number
  total_bottles: number
  consumed_bottles: number
  specification?: string | null
  group_names?: string[]
  other_names?: string[]
}

// 常用货架弹窗只允许 `add / edit` 两种模式。
type CommonShelfDialogMode = 'edit' | 'add'

// 状态筛选的 value 和文案映射必须与后端状态语义保持一致。
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'run_short', label: '快用完' },
  { value: 'consumed', label: '已耗尽' },
]

// 搜索字段范围和后端可搜索字段保持一致，避免前后端搜索语义漂移。
const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'alias', label: '别名' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
  { value: 'storage_location', label: '位置' },
]

// 为常用货架列定义保留字段级类型推导。
const columnHelper = createColumnHelper<CommonShelfItem>()

// 把表格行数据统一收口成 `CommonShelfItem`，避免各处理器重复断言。
function toCommonShelfItem(itemRaw: Record<string, unknown>) {
  return itemRaw as unknown as CommonShelfItem
}

// 统一处理新增默认值与编辑回填；关闭弹窗时走无 `item` 分支回到默认值。
function resetCommonShelfForm(
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>,
  item?: CommonShelfItem
) {
  if (!item) {
    form.reset(defaultInventoryValues)
    return
  }

  form.reset({
    name: item.name || '',
    cas_number: item.cas_number || '',
    english_name: item.english_name || '',
    alias: item.alias || '',
    specification: item.specification || '',
    category: item.category || '',
    brand: item.brand || '',
    storage_location: item.storage_location || '',
    quantity_bottles: 1,
    initial_quantity: item.initial_quantity ?? undefined,
    remaining_quantity: undefined,
    is_hazardous: item.is_hazardous || false,
    notes: item.notes || '',
    is_running_short: item.status === 'run_short',
  })
}

// 编辑请求只组装接口需要的字段，避免把表格展示字段带入提交。
function buildCommonShelfEditPayload(formData: InventoryFormData) {
  return {
    name: formData.name || '',
    cas_number: formData.cas_number || '',
    english_name: formData.english_name || '',
    alias: formData.alias || '',
    category: formData.category || '',
    storage_location: formData.storage_location || '',
    brand: formData.brand || '',
    is_hazardous: formData.is_hazardous,
    is_running_short: formData.is_running_short ?? false,
    notes: formData.notes || '',
    specification: formData.specification || '',
  }
}

// 新增请求体复用共同字段映射，并保留新增路径自己的库存初始化字段。
function buildCommonShelfAddPayload(formData: InventoryFormData) {
  return {
    cas_number: formData.cas_number,
    name: formData.name,
    english_name: formData.english_name || undefined,
    alias: formData.alias || undefined,
    specification: formData.specification || '',
    quantity_bottles: formData.quantity_bottles as number,
    brand: formData.brand || undefined,
    category: formData.category || undefined,
    storage_location: formData.storage_location || undefined,
    is_hazardous: formData.is_hazardous,
    notes: formData.notes || undefined,
  }
}

// 后端字段级校验错误继续回填到表单，而不是转成 toast。
function applyCommonShelfValidationErrors(
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>,
  validationErrors: ValidationError[]
) {
  validationErrors.forEach((error) => {
    if (error.loc?.[1]) {
      form.setError(error.loc[1] as keyof InventoryFormData, { message: error.msg || '输入不合法' })
    }
  })
}

// 提交入口同时覆盖新增、编辑和错误回填，成功后统一刷新列表和关闭弹窗。
async function submitCommonShelfForm(params: {
  dialogState: CommonShelfDialogMode | null
  editingItem: CommonShelfItem | null
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>
  formData: InventoryFormData
  refreshCommonShelf: () => Promise<void>
  setDialogState: (value: CommonShelfDialogMode | null) => void
}) {
  const { dialogState, editingItem, form, formData, refreshCommonShelf, setDialogState } = params

  try {
    if (dialogState === 'edit' && editingItem) {
      await commonShelfAPI.updateGroup(
        editingItem.sample_inventory_id,
        buildCommonShelfEditPayload(formData)
      )
      toast.success('常用货架分组已更新')
    } else if (dialogState === 'add') {
      await commonShelfAPI.manualAdd(buildCommonShelfAddPayload(formData))
      toast.success('已加入常用货架')
    }

    await refreshCommonShelf()
    setDialogState(null)
  } catch (error) {
    const detail = extractApiErrorDetail(error)
    const validationErrors = toValidationErrors(detail)
    if (validationErrors.length > 0) {
      applyCommonShelfValidationErrors(form, validationErrors)
      return
    }

    toast.error(normalizeApiErrorMessage(detail, '操作失败'))
  }
}

// 新增和编辑共用同一套字段配置，只在必要处保留模式差异。
function buildCommonShelfFormFields(
  dialogState: CommonShelfDialogMode | null,
  isCasLookupLoading: boolean,
  handleCasLookup: () => Promise<void>
) {
  const fields = getInventoryFormFields(false, undefined, {
    categoryOptions: COMMON_SHELF_CATEGORY_OPTIONS,
    brandOptions: COMMON_SHELF_BRAND_OPTIONS,
    includeRunningShort: dialogState === 'edit',
  })

  return fields.map((field) => {
    if (dialogState === 'edit' && field.name === 'quantity_bottles') {
      return { ...field, hidden: true }
    }

    if ((dialogState === 'add' || dialogState === 'edit') && field.name === 'name') {
      return {
        ...field,
        enableTagToggle: true,
        tag: '[std]',
        placeholder: '输入名称或点击左侧图标标记为标准名',
      }
    }

    if (dialogState === 'add' && field.name === 'cas_number') {
      return {
        ...field,
        prefixButton: {
          onClick: handleCasLookup,
          loading: isCasLookupLoading,
          title: '识别 CAS 号',
          icon: ScanSearch,
        },
      }
    }

    return field
  })
}

// 展开行补充英文名、别名、分类、品牌、创建信息、库存统计和备注等明细字段。
function renderCommonShelfExpandedRow(itemRaw: Record<string, unknown>) {
  const item = toCommonShelfItem(itemRaw)

  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 flex-1">
        <div>英文名称：{item.english_name || '-'}</div>
        <div>别名：{item.alias || '-'}</div>
        <div>其他名称：{item.other_names && item.other_names.length > 0 ? item.other_names.join(' / ') : '-'}</div>
        <div>分类：{item.category || '-'}</div>
        <div>品牌：{item.brand || '-'}</div>
        <div>创建人：{item.created_by_name || '-'}</div>
        <div>入库时间：{formatDate(item.created_at)}</div>
        <div>可用/总计：{item.available_bottles} / {item.total_bottles} 瓶</div>
        <div>已耗尽：{item.consumed_bottles} 瓶</div>
        <NoteDisplay label="备注" text={item.notes ?? undefined} />
      </div>
    </div>
  )
}

// 操作列继续保留编辑和“拿一瓶”入口，并复用原有禁用/确认语义。
function createCommonShelfActionColumn(): ColumnDef<CommonShelfItem, unknown> {
  return columnHelper.display({
    id: 'actions',
    header: '操作',
    size: 100,
    minSize: 100,
    maxSize: 140,
    cell: (info) => {
      const meta = info.table.options.meta
      return (
        <CommonShelfActionButtons
          item={info.row.original}
          onEdit={meta?.onEdit as (item: CommonShelfItem) => void}
          onConsumeSuccess={meta?.onBorrowSuccess as () => void}
        />
      )
    },
  })
}

// 集中管理弹窗状态、表单实例、提交动作和字段配置。
function useCommonShelfDialogState(
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>,
  refreshCommonShelf: () => Promise<void>
) {
  const [dialogState, internalSetDialogState] = useDialogState<CommonShelfDialogMode>()
  const [editingItem, setEditingItem] = useState<CommonShelfItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    resetCommonShelfForm(form)
    internalSetDialogState('add')
  }, [form, internalSetDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = toCommonShelfItem(itemRaw)
    setEditingItem(item)
    setDeleteConfirm(false)
    resetCommonShelfForm(form, item)
    internalSetDialogState('edit')
  }, [form, internalSetDialogState])

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

  const formFields = useMemo(
    () => buildCommonShelfFormFields(dialogState, isCasLookupLoading, handleCasLookup),
    [dialogState, handleCasLookup, isCasLookupLoading]
  )

  const handleSubmit = form.handleSubmit(async (formData) => {
    setIsSubmitting(true)
    try {
      await submitCommonShelfForm({
        dialogState,
        editingItem,
        form,
        formData,
        refreshCommonShelf,
        setDialogState: internalSetDialogState,
      })
    } finally {
      setIsSubmitting(false)
    }
  })

  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) {
      return
    }

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await commonShelfAPI.deleteGroup(editingItem.sample_inventory_id)
      toast.success('常用货架分组已删除')
      internalSetDialogState(null)
      await refreshCommonShelf()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [deleteConfirm, editingItem, internalSetDialogState, refreshCommonShelf])

  const handleDialogChange = useCallback((open: boolean) => {
    if (!open) {
      internalSetDialogState(null)
      setDeleteConfirm(false)
      resetCommonShelfForm(form)
    }
  }, [form, internalSetDialogState])

  return {
    dialogState,
    deleteConfirm,
    isSubmitting,
    formFields,
    handleAddClick,
    handleEditClick,
    handleDeleteClick,
    handleSubmit,
    handleDialogChange,
  }
}

// 页面主组件负责编排弹窗、SSE 刷新和表格查询。
export function CommonShelfPage() {
  const queryClient = useQueryClient()
  const clearRoomStale = useSSEStore((state) => state.clearRoomStale)

  const form = useForm<InventoryFormInputData, unknown, InventoryFormData>({
    resolver: createValibotResolver(InventoryFormSchema),
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })

  const refreshCommonShelf = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['common-shelf'] })
    clearRoomStale('common_shelf')
  }, [clearRoomStale, queryClient])

  const {
    dialogState,
    deleteConfirm,
    isSubmitting,
    formFields,
    handleAddClick,
    handleEditClick,
    handleDeleteClick,
    handleSubmit,
    handleDialogChange,
  } = useCommonShelfDialogState(form, refreshCommonShelf)

  const columns = useMemo(() => {
    const actionColumn = createCommonShelfActionColumn()
    return [...getCommonShelfTableColumns(), actionColumn] as unknown as ColumnDef<Record<string, unknown>, unknown>[]
  }, [])

  const handleExport = useCallback(async () => {
    try {
      const response = await commonShelfAPI.exportCommonShelf()
      downloadBlobResponse(response, `common_shelf_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">常用货架</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动添加
          </Button>
          <Button variant="modern" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>

      <Dialog open={dialogState !== null} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑常用货架分组' : '手动加入常用货架'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <BaseForm
              form={form}
              fields={formFields}
            />
            <EditDialogActions
              mode={dialogState ?? 'add'}
              onCancel={() => handleDialogChange(false)}
              onDelete={dialogState === 'edit' ? handleDeleteClick : undefined}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存分组"
              submitLabelAdd="确认添加"
              isSubmitting={isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>

      <FilterTable
        api={commonShelfAPI as FilterAPI}
        queryKey={['common-shelf']}
        tableId="common-shelf-table"
        realtime={{
          room: 'common_shelf',
          eventTypes: COMMON_SHELF_SSE_EVENTS,
          staleOnly: true,
          onRefresh: refreshCommonShelf,
        }}
        customColumns={columns}
        onEdit={handleEditClick}
        onBorrowSuccess={refreshCommonShelf}
        statusOptions={STATUS_OPTIONS}
        searchFieldOptions={SEARCH_FIELD_OPTIONS}
        title={<><Archive className="w-5 h-5" /> 常用/公用试剂</>}
        searchPlaceholder="搜索名称、别名、CAS号、品牌..."
        renderExpandedRow={renderCommonShelfExpandedRow}
        noteField="notes"
      />
    </div>
  )
}

// 行操作按钮继续保留“拿一瓶”和编辑，两者都沿用原有表格交互语义。
const CommonShelfActionButtons = React.memo(function CommonShelfActionButtons({
  item,
  onEdit,
  onConsumeSuccess,
}: {
  item: CommonShelfItem
  onEdit: (item: CommonShelfItem) => void
  onConsumeSuccess: () => void | Promise<void>
}) {
  const actions = useMemo(() => [
    {
      id: 'consume',
      label: '拿一瓶',
      confirm: true,
      confirmLabel: '确认',
      showWhen: (currentItem: CommonShelfItem) => currentItem.available_bottles > 0,
      onClick: async (currentItem: CommonShelfItem) => {
        try {
          await commonShelfAPI.consumeOne(currentItem.sample_inventory_id)
          await onConsumeSuccess()
          toast.success('已记录拿取 1 瓶')
        } catch (error) {
          toast.error(getApiErrorMessage(error, '拿取失败'))
          throw error
        }
      },
    },
  ], [onConsumeSuccess])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
      statusField="status"
    />
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit) return false
  if (prevProps.onConsumeSuccess !== nextProps.onConsumeSuccess) return false

  const prevItem = prevProps.item as unknown as Record<string, unknown>
  const nextItem = nextProps.item as unknown as Record<string, unknown>
  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
