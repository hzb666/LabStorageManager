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
import { useSSE, type SSEEventHandler } from '@/hooks/useSSE'
import type { FilterAPI } from '@/hooks/useTableState'
import useDialogState from '@/hooks/useDialogState'
import { defaultInventoryValues, getInventoryFormFields } from '@/lib/formConfigs'
import { getCommonShelfTableColumns } from '@/lib/tableConfigs'
import { COMMON_SHELF_BRAND_OPTIONS, COMMON_SHELF_CATEGORY_OPTIONS } from '@/lib/options'
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

/**
 * 定义常用货架单项数据结构。
 * 这个接口存在是为了统一表格行数据字段，避免编辑、展示与操作时字段不一致。
 */
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

/**
 * 约束常用货架弹窗模式。
 * 这个类型存在是为了限制弹窗状态取值，避免状态分支出现无效字符串。
 */
type CommonShelfDialogMode = 'edit' | 'add'

/**
 * 描述常用货架弹窗状态 Hook 的返回结构。
 * 这个接口存在是为了固定弹窗、提交和表单字段编排契约，便于页面统一消费。
 */
interface CommonShelfDialogState {
  dialogState: CommonShelfDialogMode | null
  editingItem: CommonShelfItem | null
  deleteConfirm: boolean
  isSubmitting: boolean
  isCasLookupLoading: boolean
  formFields: ReturnType<typeof getInventoryFormFields>
  handleAddClick: () => void
  handleEditClick: (itemRaw: Record<string, unknown>) => void
  handleDeleteClick: () => Promise<void>
  handleSubmit: () => Promise<void>
  handleDialogChange: (open: boolean) => void
}

/**
 * 定义常用货架页面展示层组件的入参。
 * 这个接口存在是为了让展示组件只关注渲染，不关心外部状态管理细节。
 */
interface CommonShelfPageContentProps {
  dialogState: CommonShelfDialogMode | null
  deleteConfirm: boolean
  isSubmitting: boolean
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>
  formFields: ReturnType<typeof getInventoryFormFields>
  onAddClick: () => void
  onExport: () => Promise<void>
  onDialogChange: (open: boolean) => void
  onDelete: () => Promise<void>
  onSubmit: () => Promise<void>
}

/**
 * 定义常用货架状态筛选选项。
 * 这个常量存在是为了集中维护状态枚举与文案映射，避免筛选配置散落在页面中。
 */
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'run_short', label: '快用完' },
  { value: 'consumed', label: '已耗尽' },
]

/**
 * 定义常用货架搜索字段选项。
 * 这个常量存在是为了统一搜索字段范围，保证筛选组件与后端字段语义一致。
 */
const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'alias', label: '别名' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
  { value: 'storage_location', label: '位置' },
]

/**
 * 声明需要监听的常用货架 SSE 事件列表。
 * 这个常量存在是为了集中管理实时刷新事件来源，减少事件名硬编码。
 */
const COMMON_SHELF_SSE_EVENTS = [
  'common_shelf.created',
  'common_shelf.updated',
  'common_shelf.deleted',
  'common_shelf.consumed',
] as const

/**
 * 创建常用货架表格列辅助器。
 * 这个常量存在是为了复用列定义构建能力并保留类型推导。
 */
const columnHelper = createColumnHelper<CommonShelfItem>()

/**
 * 将行数据安全转换成常用货架项。
 * 这个函数存在是为了把类型断言集中到一处，避免多个处理器重复做同样的转换。
 */
function toCommonShelfItem(itemRaw: Record<string, unknown>) {
  return itemRaw as unknown as CommonShelfItem
}

/**
 * 重置常用货架表单，保证新增和关闭弹窗时使用同一套初始状态。
 * 这个函数存在是为了统一表单重置语义，减少页面里散落的 reset 逻辑。
 */
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

/**
 * 构建常用货架编辑请求体，保持接口字段与旧实现一致。
 * 这个函数存在是为了把编辑路径的字段映射从提交处理器中拆出，降低复杂度。
 */
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

/**
 * 构建常用货架新增请求体，保持接口字段与旧实现一致。
 * 这个函数存在是为了把新增路径的字段映射独立出来，避免提交逻辑继续膨胀。
 */
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

/**
 * 将后端返回的校验错误回填到表单字段。
 * 这个函数存在是为了复用错误映射逻辑，并把提交处理器中的分支数量压下来。
 */
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

/**
 * 提交常用货架表单，保持新增、编辑与错误提示行为不变。
 * 这个函数存在是为了把主要副作用链路从页面组件中抽离，降低主组件和回调复杂度。
 */
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

/**
 * 构建常用货架表单字段配置，保持编辑/新增模式的字段差异不变。
 * 这个函数存在是为了把字段配置映射从页面主体中拆出，降低页面复杂度。
 */
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

/**
 * 生成常用货架 SSE 处理器映射，保持所有事件统一刷新列表。
 * 这个函数存在是为了把事件映射细节从页面组件中抽离，减少主组件代码量。
 */
function createCommonShelfSSEHandlers(
  handleCommonShelfSSEEvent: SSEEventHandler
): Record<string, SSEEventHandler> {
  return COMMON_SHELF_SSE_EVENTS.reduce<Record<string, SSEEventHandler>>((acc, eventType) => {
    acc[eventType] = handleCommonShelfSSEEvent
    return acc
  }, {})
}

/**
 * 渲染常用货架展开行内容。
 * 这个函数存在是为了把展开区块的展示结构从主页面中拆出，减少页面主体长度。
 */
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

/**
 * 创建常用货架操作列，保持编辑和“拿一瓶”行为不变。
 * 这个函数存在是为了把操作列装配从页面组件中拆出，降低主组件复杂度。
 */
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

/**
 * 维护常用货架页面的弹窗状态、提交流程和表单字段。
 * 这个函数存在是为了把表单与副作用编排从主页面中拆出，压缩主函数长度。
 */
function useCommonShelfDialogState(
  form: ReturnType<typeof useForm<InventoryFormInputData, unknown, InventoryFormData>>,
  refreshCommonShelf: () => Promise<void>
): CommonShelfDialogState {
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
    editingItem,
    deleteConfirm,
    isSubmitting,
    isCasLookupLoading,
    formFields,
    handleAddClick,
    handleEditClick,
    handleDeleteClick,
    handleSubmit,
    handleDialogChange,
  }
}

/**
 * 渲染常用货架页面主体结构。
 * 这个函数存在是为了把展示层从页面主函数中拆出，让主函数专注于状态和数据编排。
 */
function CommonShelfPageContent({
  dialogState,
  deleteConfirm,
  isSubmitting,
  form,
  formFields,
  onAddClick,
  onExport,
  onDialogChange,
  onDelete,
  onSubmit,
}: CommonShelfPageContentProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">常用货架</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动添加
          </Button>
          <Button variant="modern" size="lg" onClick={onExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>

      <Dialog open={dialogState !== null} onOpenChange={onDialogChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑常用货架分组' : '手动加入常用货架'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit}>
            <BaseForm
              form={form}
              fields={formFields}
            />
            <EditDialogActions
              mode={dialogState ?? 'add'}
              onCancel={() => onDialogChange(false)}
              onDelete={dialogState === 'edit' ? onDelete : undefined}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存分组"
              submitLabelAdd="确认添加"
              isSubmitting={isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * 常用货架页负责弹窗、SSE 刷新和表格组合。
 * 这个函数存在是为了保持原有接口和交互不变的前提下，压缩页面主函数复杂度。
 */
export function CommonShelfPage() {
  const queryClient = useQueryClient()

  const form = useForm<InventoryFormInputData, unknown, InventoryFormData>({
    resolver: createValibotResolver(InventoryFormSchema),
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })

  const refreshCommonShelf = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['common-shelf'] })
  }, [queryClient])

  const handleCommonShelfSSEEvent = useCallback<SSEEventHandler>(() => {
    void refreshCommonShelf()
  }, [refreshCommonShelf])

  useSSE({
    rooms: ['common_shelf'],
    handlers: useMemo(
      () => createCommonShelfSSEHandlers(handleCommonShelfSSEEvent),
      [handleCommonShelfSSEEvent]
    ),
  })

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
      <CommonShelfPageContent
        dialogState={dialogState}
        deleteConfirm={deleteConfirm}
        isSubmitting={isSubmitting}
        form={form}
        formFields={formFields}
        onAddClick={handleAddClick}
        onExport={handleExport}
        onDialogChange={handleDialogChange}
        onDelete={handleDeleteClick}
        onSubmit={handleSubmit}
      />

      <FilterTable
        api={commonShelfAPI as FilterAPI}
        queryKey={['common-shelf']}
        tableId="common-shelf-table"
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

/**
 * 渲染常用货架操作按钮，保持“拿一瓶”和编辑行为不变。
 * 这个函数存在是为了隔离表格操作配置，避免操作列继续膨胀。
 */
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
