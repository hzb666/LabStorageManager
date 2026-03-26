// 仪表盘中的耗材订单页签，承载本地筛选、编辑和确认收货流程。
import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { ShoppingCart } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { ConsumableOrderExpandedRow } from '@/components/ConsumableOrderExpandedRow'
import { toast } from '@/lib/toast'
import { processNotes, toText } from '@/lib/utils'
import { UserRoles } from '@/lib/constants'
import { useAuthStore } from '@/store/useStore'

import { consumableOrderAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { getConsumableOrderTableColumns } from '@/lib/tableConfigs'
import {
  ConsumableOrderSchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ConsumableOrderFormData, ConsumableOrderFormInputData } from '@/lib/validationSchemas'
import { getConsumableOrderFormFields, defaultConsumableOrderValues } from '@/lib/formConfigs'

import {
  type DashboardConsumableOrder,
  type DashboardParams,
  CONSUMABLE_STATUS_OPTIONS,
  DASHBOARD_CONSUMABLE_SEARCH_FIELDS,
  buildLocalListData,
  flattenGroupedOrders,
  removeApplicantColumn,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const consumableColumnHelper = createColumnHelper<DashboardConsumableOrder>()

// Dashboard 接口返回分组订单，这里先拍平成 `FilterTable` 可消费的本地列表结构。
function createConsumableDashboardAPI(currentUserId?: number): FilterAPI {
  return {
    list: async (params) => {
      const response = await consumableOrderAPI.getMyConsumableOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardConsumableOrder>(grouped, currentUserId)
      const local = buildLocalListData(rows, params as DashboardParams, ['name', 'specification', 'created_at'])
      return { data: local }
    },
  }
}

// `public` 账户永远不能编辑，非管理员只能编辑本人订单；返回值直接复用为提示文案。
function getConsumableEditBlockMessage(
  item: DashboardConsumableOrder,
  currentUserRole: string | undefined,
  currentUserId: number | undefined,
  isAdmin: boolean
): string | null {
  if (currentUserRole === UserRoles.PUBLIC) {
    return '公用账户不能编辑订单'
  }
  if (!isAdmin && item.applicant_id !== currentUserId) {
    return '只能编辑自己创建的订单'
  }
  return null
}

// 把后端可空字段收口成 RHF 可控输入默认值，避免编辑弹窗拿到 `undefined` 或 `null`。
function buildConsumableFormValues(item: DashboardConsumableOrder): ConsumableOrderFormInputData {
  return {
    name: String(item.name ?? ''),
    english_name: String(item.english_name ?? ''),
    specification: String(item.specification ?? ''),
    unit: toText(item.unit),
    quantity: Number(item.quantity ?? 1),
    price: (item.price as number | undefined) ?? undefined,
    communication: String(item.communication ?? ''),
    notes: String(item.notes ?? ''),
  }
}

// “我的耗材订单”会移除申请人列；仅 `approved` 状态显示确认收货，编辑按钮按角色和归属禁用。
function createConsumableColumns({
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
  onEdit,
}: Readonly<{
  currentUserId: number | undefined
  currentUserRole: string | undefined
  isAdmin: boolean
  refreshTables: () => Promise<void>
  onEdit: (item: DashboardConsumableOrder) => void
}>): ColumnDef<Record<string, unknown>, unknown>[] {
  const baseColumns = removeApplicantColumn(
    getConsumableOrderTableColumns() as ColumnDef<Record<string, unknown>, unknown>[]
  )
  const actions = [
    {
      id: 'confirm-complete',
      label: '确认收货',
      confirm: true,
      confirmLabel: '确认',
      showWhen: (currItem: DashboardConsumableOrder) => currItem.status === 'approved',
      onClick: async (currItem: DashboardConsumableOrder) => {
        await consumableOrderAPI.complete(currItem.id)
        await refreshTables()
        toast.success('已确认收货')
      },
    },
  ]
  const actionColumn = consumableColumnHelper.display({
    id: 'actions',
    header: '操作',
    size: 180,
    cell: (info) => {
      const item = info.row.original
      const disableEdit =
        currentUserRole === UserRoles.PUBLIC || (!isAdmin && item.applicant_id !== currentUserId)

      return (
        <TableActionButtonsMemo
          item={item}
          actions={actions}
          showEdit={true}
          disableEdit={disableEdit}
          onEdit={(target) => onEdit(target as DashboardConsumableOrder)}
          isAdmin={isAdmin}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

// `approved` / `rejected` 订单仍可进入弹窗，但只能删除，不能再提交编辑。
function DashboardConsumableEditDialog({
  dialog,
}: Readonly<{
  dialog: {
    editingConsumable: DashboardConsumableOrder | null
    deleteConfirm: boolean
    consumableForm: ReturnType<typeof useForm<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>>
    isSubmittingConsumable: boolean
    onDelete: () => void
    onClose: () => void
    onSubmit: () => void
  }
}>) {
  const {
    editingConsumable,
    deleteConfirm,
    consumableForm,
    isSubmittingConsumable,
    onDelete,
    onClose,
    onSubmit,
  } = dialog
  const isConsumableEditLocked =
    editingConsumable?.status === 'approved' || editingConsumable?.status === 'rejected'

  return (
    <Dialog open={editingConsumable !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>编辑耗材订单</span>
            {isConsumableEditLocked ? <span className="text-base text-muted-foreground">当前状态仅支持删除</span> : null}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <BaseForm form={consumableForm} fields={getConsumableOrderFormFields()} disabled={isConsumableEditLocked} />
          <EditDialogActions
            mode="edit"
            onCancel={onClose}
            onDelete={onDelete}
            deleteConfirm={deleteConfirm}
            submitLabelEdit="保存"
            submitLabelAdd="保存"
            isSubmitting={isSubmittingConsumable}
            disableSubmit={isConsumableEditLocked}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DashboardConsumableTab() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const [editingConsumable, setEditingConsumable] = useState<DashboardConsumableOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmittingConsumable, setIsSubmittingConsumable] = useState(false)

  const consumableForm = useForm<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'consumables'] }),
      queryClient.invalidateQueries({ queryKey: ['consumable-orders'] }),
    ])
    requestDashboardCountsRefresh()
  }, [queryClient])

  const consumableDashboardAPI = useMemo(
    () => createConsumableDashboardAPI(currentUser?.id),
    [currentUser?.id]
  )

  // 打开编辑前先做权限拦截，拦截失败直接 toast，不进入弹窗状态。
  const handleConsumableEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardConsumableOrder
    const blockMessage = getConsumableEditBlockMessage(item, currentUser?.role, currentUser?.id, isAdmin)
    if (blockMessage) {
      toast.warning(blockMessage)
      return
    }

    setEditingConsumable(item)
    setDeleteConfirm(false)
    consumableForm.reset(buildConsumableFormValues(item))
  }, [isAdmin, currentUser?.id, currentUser?.role, consumableForm])

  // 提交成功后同时失效 Dashboard 列表和订单列表缓存；字段级校验错误回填表单而不是 toast。
  const submitConsumableEdit = consumableForm.handleSubmit(async (formData) => {
    if (!editingConsumable) return
    setIsSubmittingConsumable(true)
    try {
      await consumableOrderAPI.update(editingConsumable.id, {
        name: formData.name,
        english_name: formData.english_name || '',
        specification: formData.specification || '',
        unit: formData.unit || '',
        quantity: formData.quantity,
        price: formData.price,
        communication: formData.communication || '',
        notes: processNotes(formData.notes),
      })
      setDeleteConfirm(false)
      setEditingConsumable(null)
      await refreshTables()
      toast.success('耗材订单已更新')
    } catch (err) {
      const detail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            consumableForm.setError(e.loc[1] as keyof ConsumableOrderFormData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '更新失败'))
    } finally {
      setIsSubmittingConsumable(false)
    }
  })

  // 删除采用两段式确认：第一次只切确认态，第二次才真正调用删除接口。
  const handleDeleteConsumable = useCallback(async () => {
    if (!editingConsumable) return

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await consumableOrderAPI.delete(editingConsumable.id)
      setDeleteConfirm(false)
      setEditingConsumable(null)
      consumableForm.reset(defaultConsumableOrderValues)
      await refreshTables()
      toast.success('耗材订单已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [consumableForm, deleteConfirm, editingConsumable, refreshTables])

  // 关闭弹窗时同时清理 `editingConsumable`、`deleteConfirm` 和表单默认值。
  const closeConsumableDialog = useCallback(() => {
    setEditingConsumable(null)
    setDeleteConfirm(false)
    consumableForm.reset(defaultConsumableOrderValues)
  }, [consumableForm])

  const consumableColumns = useMemo(
    () => createConsumableColumns({
      currentUserId: currentUser?.id,
      currentUserRole: currentUser?.role,
      isAdmin,
      refreshTables,
      onEdit: (item) => handleConsumableEdit(item as unknown as Record<string, unknown>),
    }),
    [currentUser?.id, currentUser?.role, handleConsumableEdit, isAdmin, refreshTables]
  )
  const consumableEditDialog = {
    editingConsumable,
    deleteConfirm,
    consumableForm,
    isSubmittingConsumable,
    onDelete: handleDeleteConsumable,
    onClose: closeConsumableDialog,
    onSubmit: submitConsumableEdit,
  }

  return (
    <>
      <FilterTable
        api={consumableDashboardAPI}
        queryKey={['dashboard', 'consumables']}
        tableId="dashboard-consumable-orders"
        customColumns={consumableColumns}
        statusOptions={CONSUMABLE_STATUS_OPTIONS}
        searchFieldOptions={DASHBOARD_CONSUMABLE_SEARCH_FIELDS}
        searchPlaceholder="搜索名称、规格、订购时间..."
        title={<><ShoppingCart className="w-5 h-5" /> 我的耗材订单</>}
        noteField="notes"
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as DashboardConsumableOrder
          return <ConsumableOrderExpandedRow item={item} />
        }}
      />
      <DashboardConsumableEditDialog
        dialog={consumableEditDialog}
      />
    </>
  )
}
