// 耗材订单页面 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、完成 参考 Inventory 页面实现，使用 FilterTable 组件
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useForm } from 'react-hook-form'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { toast } from '@/lib/toast'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'
import { UserRoles } from '@/lib/constants'
import { useTableState, type FilterAPI } from '@/hooks/useTableState'

// 工具与API
import { consumableOrderAPI } from '@/api/client'
import { downloadBlobResponse, processNotes } from '@/lib/utils'
import { ConsumableOrderExpandedRow } from '@/components/ConsumableOrderExpandedRow'
import {
  ConsumableOrderSchema,
  applyValidationErrors,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ConsumableOrderFormData, ConsumableOrderFormInputData } from '@/lib/validationSchemas'
import { getConsumableOrderTableColumns } from '@/lib/tableConfigs'
import {
  getConsumableOrderFormFields,
  defaultConsumableOrderValues
} from '@/lib/formConfigs'
import { getDialogSubmitSuccessMessage, submitByDialogState } from '@/lib/orderSubmitHelpers'

// 图标
import {
  Plus,
  ShoppingCart,
  ArrowUpFromLine,
  Check,
  X,
} from 'lucide-react'

interface ConsumableOrder {
  id: number
  name: string
  english_name: string | null
  product_number: string | null
  specification: string
  unit: string | null
  quantity: number
  price: number | null
  communication: string | null
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
  status: string
  created_at: string
  updated_at: string
}

const columnHelper = createColumnHelper<ConsumableOrder>()

// 耗材订单状态筛选选项
const CONSUMABLE_ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'completed', label: '已完成' },
]

// 耗材订单搜索字段选项
const CONSUMABLE_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'specification', label: '规格' },
  { value: 'applicant', label: '订购人' },
  { value: 'created_at', label: '订购时间' },
]

// ============================================================================
// 页面辅助函数
// ============================================================================

// 将耗材订单回填到表单中。 让编辑入口复用统一的字段归一化规则，避免重置表单时散落默认值逻辑。
function createConsumableOrderFormValues(item: ConsumableOrder): ConsumableOrderFormInputData {
  return {
    name: item.name || '',
    english_name: item.english_name || '',
    specification: item.specification || '',
    unit: item.unit || '',
    quantity: item.quantity || 1,
    product_number: item.product_number || '',
    price: item.price || undefined,
    communication: item.communication || '',
    notes: item.notes || '',
  }
}

// 生成新增耗材订单的请求体。 把表单值与接口对 `undefined`/空字符串的契约收口到同一处。
function createConsumableOrderCreatePayload(formData: ConsumableOrderFormData) {
  return {
    name: formData.name,
    english_name: formData.english_name || undefined,
    product_number: formData.product_number || undefined,
    specification: formData.specification,
    unit: formData.unit || undefined,
    quantity: formData.quantity,
    price: formData.price,
    communication: formData.communication || undefined,
    notes: processNotes(formData.notes),
  }
}

// 生成编辑耗材订单的请求体。 保持更新接口继续沿用当前空字符串回写语义，而不是把判断堆在提交处理器里。
function createConsumableOrderUpdatePayload(formData: ConsumableOrderFormData) {
  return {
    name: formData.name,
    english_name: formData.english_name || '',
    product_number: formData.product_number || '',
    specification: formData.specification || '',
    unit: formData.unit || '',
    quantity: formData.quantity,
    price: formData.price,
    communication: formData.communication || '',
    notes: processNotes(formData.notes),
  }
}

// 管理耗材订单弹窗、表单与提交删除流程。 把页面主组件收回成列表编排层，只保留筛选、表格和入口按钮。
function useConsumableOrderDialogController(refreshOrders: () => void | Promise<void>) {
  const [dialogState, setDialogState] = useDialogState<'edit' | 'add'>()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<ConsumableOrder | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultConsumableOrderValues)
    setDialogState('add')
  }, [form, setDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ConsumableOrder
    setEditingItem(item)
    setDeleteConfirm(false)
    form.reset(createConsumableOrderFormValues(item))
    setDialogState('edit')
  }, [form, setDialogState])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogState(null)
      setDeleteConfirm(false)
      form.reset()
    }
  }, [form, setDialogState])

  const handleFormSubmit = form.handleSubmit(async (formData) => {
    setIsSubmitting(true)
    try {
      await submitByDialogState({
        dialogState,
        editingItem,
        formData,
        onUpdate: (currentEditingItem, currentFormData) =>
          consumableOrderAPI.update(currentEditingItem.id, createConsumableOrderUpdatePayload(currentFormData)),
        onCreate: (currentFormData) =>
          consumableOrderAPI.create(createConsumableOrderCreatePayload(currentFormData)),
      })
      await Promise.resolve(refreshOrders())
      const successMessage = getDialogSubmitSuccessMessage(dialogState, {
        edit: '订单信息已更新',
        add: '耗材订单创建成功',
      })
      if (successMessage) {
        toast.success(successMessage)
      }
      setDeleteConfirm(false)
      setDialogState(null)
    } catch (err) {
      const errorDetail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(errorDetail)
      if (applyValidationErrors(validationErrors, (fieldName, message) => {
        form.setError(fieldName as keyof ConsumableOrderFormData, { message })
      })) {
        return
      }
      toast.error(normalizeApiErrorMessage(errorDetail, '操作失败'))
    } finally {
      setIsSubmitting(false)
    }
  })

  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) return

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await consumableOrderAPI.delete(editingItem.id)
      setDeleteConfirm(false)
      setEditingItem(null)
      setDialogState(null)
      await Promise.resolve(refreshOrders())
      toast.success('耗材订单已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [deleteConfirm, editingItem, refreshOrders, setDialogState])

  return {
    dialogState,
    deleteConfirm,
    editingItem,
    isSubmitting,
    form,
    handleAddClick,
    handleEditClick,
    handleDialogOpenChange,
    handleFormSubmit,
    handleDeleteClick,
    setDialogState,
  }
}

// 创建耗材订单页的表格列。 把管理员操作列的拼装从页面主函数中移走，避免页面继续承担表格细节。
function createConsumableOrderColumns(
  isAdmin: boolean,
  onRefresh: () => void | Promise<void>,
): ColumnDef<Record<string, unknown>, unknown>[] {
  const baseColumns = getConsumableOrderTableColumns()
  if (!isAdmin) {
    return baseColumns as ColumnDef<Record<string, unknown>, unknown>[]
  }

  const actionColumn = columnHelper.display({
    id: 'actions',
    header: '操作',
    size: 100,
    minSize: 100,
    maxSize: 100,
    cell: (info) => {
      const meta = info.table.options.meta
      return (
        <ActionButtons
          item={info.row.original as unknown as Record<string, unknown>}
          onEdit={meta?.onEdit as unknown as (item: Record<string, unknown>) => void}
          onRefresh={onRefresh}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

// ============================================================================
// 主组件
// ============================================================================

// 直接组合列表、筛选与叶子组件，避免继续保留只转发参数的头部和弹窗壳层。
export function ConsumableOrdersPage() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const canCreateOrder = currentUser?.role !== UserRoles.PUBLIC
  const filter = useTableState({
    api: consumableOrderAPI,
    queryKey: ['consumable-orders'],
    tableId: 'consumable-orders-table',
    statusOptions: CONSUMABLE_ORDER_STATUS_OPTIONS,
    searchFieldOptions: CONSUMABLE_SEARCH_FIELD_OPTIONS,
  })
  const dialogController = useConsumableOrderDialogController(filter.invalidate)

  const handleExport = useCallback(async () => {
    try {
      const response = await consumableOrderAPI.exportOrders()
      downloadBlobResponse(response, `consumable_orders_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  const columns = useMemo(() => {
    return createConsumableOrderColumns(isAdmin, filter.invalidate)
  }, [isAdmin, filter.invalidate])

  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ConsumableOrder
    return <ConsumableOrderExpandedRow item={item} showExtraFields={true} />
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">耗材订购</h1>
        <div className="flex flex-wrap gap-2">
          {canCreateOrder && (
            <Button onClick={dialogController.handleAddClick} size="lg">
              <Plus className="w-4 h-4 mr-1.5" /> 创建订单
            </Button>
          )}
          {isAdmin && (
            <Button variant="modern" size="lg" onClick={handleExport}>
              <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
            </Button>
          )}
        </div>
      </div>
      <Dialog open={dialogController.dialogState !== null} onOpenChange={dialogController.handleDialogOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogController.dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={dialogController.handleFormSubmit}>
            <BaseForm form={dialogController.form} fields={getConsumableOrderFormFields()} />
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
              submitLabelAdd="提交订单"
              isSubmitting={dialogController.isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>
      <FilterTable
        api={consumableOrderAPI as FilterAPI}
        queryKey={['consumable-orders']}
        tableId="consumable-orders-table"
        statusOptions={CONSUMABLE_ORDER_STATUS_OPTIONS}
        searchFieldOptions={CONSUMABLE_SEARCH_FIELD_OPTIONS}
        customColumns={columns}
        onEdit={dialogController.handleEditClick}
        title={<><ShoppingCart className="w-5 h-5" /> 耗材订单列表</>}
        searchPlaceholder="搜索名称、规格、订购人、订购时间..."
        renderExpandedRow={renderExpandedRow}
        noteField="notes"
      />
    </div>
  )
}

// ============================================================================
// 表格操作按钮组件
// ============================================================================

// 渲染耗材订单行级操作。 把审批/驳回/完成动作集中在表格行内，避免页面主组件直接处理行级业务按钮。
const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  onRefresh,
}: {
  item: Record<string, unknown>
  onEdit: (item: Record<string, unknown>) => void
  onRefresh: () => void | Promise<void>
}) {
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const actions = useMemo(() => [
    {
      id: 'approve',
      label: '审批',
      icon: <Check className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
      confirm: true,
      confirmLabel: '确认审批',
      disableWhen: (currItem: Record<string, unknown>) => currItem.status !== 'pending' && currItem.status !== 'rejected',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.approve(currItem.id as number)
        await onRefreshRef.current()
        toast.success('审批通过')
      }
    },
    {
      id: 'reject',
      label: '驳回',
      icon: <X className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      confirm: true,
      confirmLabel: '确认驳回',
      disableWhen: (currItem: Record<string, unknown>) => currItem.status !== 'pending' && currItem.status !== 'approved',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.reject(currItem.id as number, '管理员驳回')
        await onRefreshRef.current()
        toast.success('已驳回')
      }
    },
    {
      id: 'complete',
      label: '确认完成',
      showWhen: (currItem: Record<string, unknown>) => currItem.status === 'approved',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.complete(currItem.id as number)
        await onRefreshRef.current()
        toast.success('耗材订单已完成')
      }
    }
  ], [])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
    />
  )
}, (prevProps, nextProps) => {
  if (
    prevProps.onEdit !== nextProps.onEdit
    || prevProps.onRefresh !== nextProps.onRefresh
  ) {
    return false
  }

  const prevItem = prevProps.item
  const nextItem = nextProps.item
  return (
    prevItem.id === nextItem.id
    && prevItem.status === nextItem.status
    && prevItem.updated_at === nextItem.updated_at
  )
})
