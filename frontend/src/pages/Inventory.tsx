// 库存管理页面。
import React, { useState, useMemo, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { UseFormReturn, FieldErrors } from 'react-hook-form'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { StructureSearchResultsPanel } from '@/components/chem/StructureSearchResultsPanel'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/lib/toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import { BorrowDialog } from '@/components/BorrowDialog'
import { EditDialogActions } from '@/components/EditDialogActions'
import useDialogState from '@/hooks/useDialogState'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { FilterTable } from '@/components/ui/FilterTable'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import type { FilterAPI } from '@/hooks/useTableState'

// 工具与API
import { inventoryAPI, chemicalAPI } from '@/api/client'
import type { SubstructureSearchResponse } from '@/api/structureSearchApi'
import { isStructureSearchFeatureEnabled } from '@/lib/apiConfig'
import { downloadBlobResponse, formatDate, processNotes } from '@/lib/utils'
import {
  InventoryFormSchema,
  applyValidationErrors,
  parseSpecification,
  createValibotResolver,
  validateAndNormalizeCASInput,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { InventoryFormData, InventoryFormInputData } from '@/lib/validationSchemas'
import { getInventoryTableColumns } from '@/lib/tableConfigs'
import { UserRoles } from '@/lib/constants'
import { useSSEStore } from '@/store/sseStore'
import { useAuthStore } from '@/store/useStore'
import { INVENTORY_SSE_EVENTS } from '@/lib/sseEvents'

// 表单配置
import { defaultInventoryValues, enhanceCasLookupField, getInventoryFormFields } from '@/lib/formConfigs'

// 图标
import {
  ArrowUpFromLine,
  Plus,
  Package,
  ScanSearch
} from 'lucide-react'

// ============================================================================
// 类型扩展与定义
// ============================================================================

export interface InventoryItem {
  id: number
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
}

type InventoryDialogState = 'edit' | 'add' | null

const columnHelper = createColumnHelper<InventoryItem>()
const StructureSearchDialog = React.lazy(() => import('@/components/chem/StructureSearchDialog'))
const structureSearchEnabled = isStructureSearchFeatureEnabled()

// ============================================================================
// 页面辅助函数
// ============================================================================

// 将库存行数据回填到表单中。 让编辑入口复用统一的字段归一化规则，并保留 `null`/`0` 的原始展示语义。
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

// 根据规格文本推导编辑态的初始量上限。 把规格解析和剩余量校验拆开，避免提交处理器内出现嵌套分支。
function resolveInventoryInitialQuantity(editingItem: InventoryItem, specification: string | undefined): number {
  const parsedValue = specification ? parseSpecification(specification) : null
  return parsedValue ?? editingItem.initial_quantity
}

// 校验编辑态的剩余量上限。 维持原有业务判断不变，同时让提交逻辑只保留流程编排。
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

// 在编辑态校验失败时补上剩余量必填错误。 保持当前“Schema 之外仍补做剩余量必填检查”的行为，而不让提交回调继续膨胀。
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

// 生成库存编辑请求体。 把字段默认值与备注清洗收口，避免更新逻辑散落在提交流程里。
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

// 生成手动入库请求体。 把新增模式的 `undefined` 语义和瓶数参数收口到单点。
function createInventoryCreatePayload(formData: InventoryFormData) {
  return {
    cas_number: formData.cas_number,
    name: formData.name,
    english_name: formData.english_name || undefined,
    alias: formData.alias || undefined,
    specification: formData.specification || '',
    quantity_bottles: formData.quantity_bottles as number,
    brand: formData.brand || undefined,
    category: formData.category || undefined,
    purity: formData.purity || undefined,
    storage_location: formData.storage_location || undefined,
    is_hazardous: formData.is_hazardous,
    notes: processNotes(formData.notes),
  }
}

// 按当前弹窗模式执行库存新增或编辑请求。 把接口调用分支从提交流程中抽离，让主提交处理器只保留业务编排。
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

// 生成库存弹窗的表单字段配置。 把 CAS 自动识别按钮的挂载逻辑从 JSX 中拿开，减少页面渲染分支。
function createInventoryFormFields(params: {
  dialogState: InventoryDialogState
  initialQuantity?: number
  handleCasLookup: () => Promise<void>
  isCasLookupLoading: boolean
}) {
  const { dialogState, initialQuantity, handleCasLookup, isCasLookupLoading } = params
  const fields = getInventoryFormFields(dialogState === 'edit', initialQuantity)
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

// 格式化库存展开行里的“上次借用”展示文本。 消除 JSX 中的嵌套三元表达式，同时保持原有文案与状态语义不变。
function formatInventoryBorrowerDisplay(item: InventoryItem): string {
  if (item.borrower_name) {
    return `${item.borrower_name} (未归还)`
  }
  if (item.last_borrower_name) {
    return `${item.last_borrower_name} (已归还)`
  }
  return '-'
}

// 管理库存弹窗、表单与删除/CAS 联动。 把页面主组件收束成列表编排层，并把库存特有的表单规则集中在一个局部控制器中。
function useInventoryDialogController(refreshInventory: () => void | Promise<void>) {
  const [dialogState, setDialogState] = useDialogState<'edit' | 'add'>()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
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
    setDeleteConfirm(false)
    form.reset(defaultInventoryValues)
    setDialogState('add')
  }, [form, setDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    setEditingItem(item)
    setDeleteConfirm(false)
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

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await inventoryAPI.delete(editingItem.id)
      setDialogState(null)
      await Promise.resolve(refreshInventory())
      toast.success('库存已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [deleteConfirm, editingItem, refreshInventory, setDialogState])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogState(null)
      form.reset()
      setDeleteConfirm(false)
    }
  }, [form, setDialogState])

  const formFields = useMemo(() => {
    return createInventoryFormFields({
      dialogState,
      initialQuantity: editingItem?.initial_quantity,
      handleCasLookup,
      isCasLookupLoading,
    })
  }, [dialogState, editingItem?.initial_quantity, handleCasLookup, isCasLookupLoading])

  return {
    dialogState,
    deleteConfirm,
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

// 创建库存页的表格列。 把操作列拼装从页面主函数中拿开，减少页面承担的表格细节。
function createInventoryColumns(): ColumnDef<Record<string, unknown>, unknown>[] {
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
          onBorrowSuccess={meta?.onBorrowSuccess as () => void}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

// 渲染库存展开行内容。 把扩展信息展示从页面主组件中拆出，并显式消除嵌套条件表达式。
function InventoryExpandedRow({ item }: { item: InventoryItem }) {
  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
        <div className="col-span-2">英文名称：{item.english_name || '-'}</div>
        <div>别名：{item.alias || '-'}</div>
        <NoteDisplay className="col-span-2" label="备注" text={item.notes ?? undefined} />
        <div>纯度：{item.purity || '-'}</div>
        <div>入库时间：{formatDate(item.created_at)}</div>
        <div>入库用户：{item.created_by_name || '-'}</div>
        <div>上次借用：{formatInventoryBorrowerDisplay(item)}</div>
      </div>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================

// 直接组合列表、页头和叶子组件，避免继续保留只转发参数的壳层。
export function InventoryPage() {
  const queryClient = useQueryClient()
  const clearRoomStale = useSSEStore((state) => state.clearRoomStale)
  const [structureDialogOpen, setStructureDialogOpen] = useState(false)
  const [structureResults, setStructureResults] = useState<SubstructureSearchResponse | null>(null)
  const loadInventory = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] })
    clearRoomStale('inventory')
  }, [clearRoomStale, queryClient])
  const dialogController = useInventoryDialogController(loadInventory)

  const handleExport = useCallback(async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      downloadBlobResponse(response, `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  const columns = useMemo(() => createInventoryColumns(), [])
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    return <InventoryExpandedRow item={item} />
  }, [])
  const handleStructureResults = useCallback((payload: SubstructureSearchResponse) => {
    setStructureResults(payload)
  }, [])
  const structureSearchAction = useMemo(() => (
    <Button type="button" variant="modern" onClick={() => setStructureDialogOpen(true)}>
      <ScanSearch className="size-4" />
      结构检索
    </Button>
  ), [])
  const structureDialogFallback = useMemo(() => (
    <Dialog open={structureDialogOpen} onOpenChange={setStructureDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="mb-4">结构检索</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">结构编辑器加载中...</div>
      </DialogContent>
    </Dialog>
  ), [structureDialogOpen])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">库存管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={dialogController.handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动入库
          </Button>
          <Button variant="modern" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>
      {structureSearchEnabled && structureResults && (
        <StructureSearchResultsPanel
          payload={structureResults}
          onClear={() => setStructureResults(null)}
          onSearchAgain={() => setStructureDialogOpen(true)}
        />
      )}
      <Dialog open={dialogController.dialogState !== null} onOpenChange={dialogController.handleDialogOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogController.dialogState === 'edit' ? '编辑库存' : '手动入库'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={dialogController.handleFormSubmit}>
            <BaseForm form={dialogController.form} fields={dialogController.formFields} />
            <EditDialogActions
              mode={dialogController.dialogState ?? 'add'}
              onCancel={() => dialogController.setDialogState(null)}
              onDelete={
                dialogController.dialogState === 'edit' && dialogController.editingItem
                  ? dialogController.handleDeleteClick
                  : undefined
              }
              deleteConfirm={dialogController.deleteConfirm}
              submitLabelEdit="保存"
              submitLabelAdd="确认入库"
              isSubmitting={dialogController.isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>
      {structureSearchEnabled && structureDialogOpen && (
        <React.Suspense fallback={structureDialogFallback}>
          <StructureSearchDialog
            open={structureDialogOpen}
            onOpenChange={setStructureDialogOpen}
            onResults={handleStructureResults}
          />
        </React.Suspense>
      )}
      <FilterTable
        api={inventoryAPI as FilterAPI}
        queryKey={['inventory']}
        tableId="inventory-table"
        realtime={{
          room: 'inventory',
          eventTypes: INVENTORY_SSE_EVENTS,
          onRefresh: loadInventory,
        }}
        customColumns={columns}
        onEdit={dialogController.handleEditClick}
        onBorrowSuccess={loadInventory}
        title={<><Package className="w-5 h-5" /> 库存列表</>}
        searchPlaceholder="搜索名称、CAS号、位置..."
        searchActions={structureSearchEnabled ? structureSearchAction : undefined}
        noteField="notes"
        renderExpandedRow={renderExpandedRow}
      />
    </div>
  )
}

// ============================================================================
// 表格操作按钮组件
// ============================================================================

// 渲染库存行级操作。 把借用、编辑等动作限制在表格单元内，避免页面主组件承担行级业务细节。
const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onBorrowSuccess
}: {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onBorrowSuccess: () => void | Promise<void>
}) {
  const currentUser = useAuthStore((state) => state.user)
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC
  const [borrowDialogOpen, setBorrowDialogOpen] = useState(false)
  const [pendingBorrowItem, setPendingBorrowItem] = useState<InventoryItem | null>(null)
  const [isSubmittingBorrow, setIsSubmittingBorrow] = useState(false)

  const executeBorrow = useCallback(async (inventoryId: number, actualBorrowerId?: number) => {
    setIsSubmittingBorrow(true)
    try {
      await inventoryAPI.borrow(
        inventoryId,
        actualBorrowerId ? { actual_borrower_id: actualBorrowerId } : undefined
      )
      await onBorrowSuccess()
      toast.success('借用成功')
      setBorrowDialogOpen(false)
      setPendingBorrowItem(null)
    } catch (error) {
      const maybeStatus = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined
      const message = getApiErrorMessage(error, '借用失败')
      toast[maybeStatus === 409 ? 'warning' : 'error'](message)
      throw error
    } finally {
      setIsSubmittingBorrow(false)
    }
  }, [onBorrowSuccess])

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
        confirm: true,
        confirmLabel: '确认',
        showWhen: (currItem: InventoryItem) => currItem.status === 'in_stock',
        onClick: async (currItem: InventoryItem) => {
          // 借用前校验：检查规格和剩余量是否填写
          if (!currItem.specification || currItem.specification.trim() === '') {
            toast.warning('请先填写规格才能借用')
            throw new Error('规格未填写')
          }
          if (currItem.remaining_quantity === undefined || currItem.remaining_quantity === null) {
            toast.warning('请先填写剩余量才能借用')
            throw new Error('剩余量未填写')
          }

          if (isPublicUser) {
            setPendingBorrowItem(currItem)
            setBorrowDialogOpen(true)
            return
          }

          await executeBorrow(currItem.id)
        }
      }
    ]
  }, [isPublicUser, executeBorrow])

  return (
    <>
      <TableActionButtonsMemo
        item={item}
        actions={actions}
        showEdit={true}
        onEdit={onEdit}
        statusField="status"
        statusDisplay={statusDisplay}
      />
      <BorrowDialog
        open={borrowDialogOpen}
        onOpenChange={(open) => {
          setBorrowDialogOpen(open)
          if (!open) {
            setPendingBorrowItem(null)
          }
        }}
        isSubmitting={isSubmittingBorrow}
        onConfirm={async (actualBorrowerId) => {
          if (!pendingBorrowItem) return
          await executeBorrow(pendingBorrowItem.id, actualBorrowerId)
        }}
      />
    </>
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit || prevProps.onBorrowSuccess !== nextProps.onBorrowSuccess) {
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
