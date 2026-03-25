/**
 * 仪表盘 - 耗材订单 Tab
 * 展示当前用户的耗材订单列表，支持编辑和确认收货
 */
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

/**
 * 创建耗材仪表盘列表的本地筛选 API 适配器。
 * 存在原因：Dashboard 接口返回的是分组订单结构，需要先拍平再复用通用表格能力。
 */
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

/**
 * 计算当前记录是否禁止编辑，并返回保持原文案的提示。
 * 存在原因：把权限判断从点击处理器中抽出，降低页面主流程分支。
 */
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

/**
 * 把耗材订单转换成编辑表单默认值。
 * 存在原因：页面点击编辑时需要重置较多字段，独立函数能避免回调过长。
 */
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

/**
 * 构造耗材订单列表列定义和操作列。
 * 存在原因：把表格列拼装从页面主体移出，让页面只负责状态和事件编排。
 */
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

/**
 * 渲染耗材订单编辑弹窗。
 * 存在原因：弹窗表单和删除确认流程较长，独立出来后页面主体更聚焦。
 */
function DashboardConsumableEditDialog({
  editingConsumable,
  isConsumableEditLocked,
  deleteConfirm,
  consumableForm,
  isSubmittingConsumable,
  onDelete,
  onClose,
  onSubmit,
}: Readonly<{
  editingConsumable: DashboardConsumableOrder | null
  isConsumableEditLocked: boolean
  deleteConfirm: boolean
  consumableForm: ReturnType<typeof useForm<ConsumableOrderFormInputData, unknown, ConsumableOrderFormData>>
  isSubmittingConsumable: boolean
  onDelete: () => void
  onClose: () => void
  onSubmit: () => void
}>) {
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

/**
 * 管理仪表盘中的耗材订单列表、编辑和确认收货流程。
 * 存在原因：这是耗材订单页的轻量容器，负责把通用表格、弹窗和权限判断组合起来。
 */
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

  const isConsumableEditLocked = editingConsumable?.status === 'approved' || editingConsumable?.status === 'rejected'

  const consumableDashboardAPI = useMemo(
    () => createConsumableDashboardAPI(currentUser?.id),
    [currentUser?.id]
  )

  /**
   * 打开耗材编辑弹窗并按当前订单内容重置表单。
   * 存在原因：编辑前需要统一执行权限检查与表单填充，避免逻辑散落在操作列里。
   */
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

  /**
   * 提交耗材订单编辑。
   * 存在原因：保存成功后需要同时刷新 Dashboard 与订单页缓存。
   */
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

  /**
   * 处理耗材订单删除的二次确认与实际删除。
   * 存在原因：保持原有“第一次点删除只切换确认态”的交互不变。
   */
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

  /**
   * 关闭编辑弹窗并恢复默认表单状态。
   * 存在原因：让关闭动作只有一个出口，避免遗漏 deleteConfirm 清理。
   */
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
        editingConsumable={editingConsumable}
        isConsumableEditLocked={isConsumableEditLocked}
        deleteConfirm={deleteConfirm}
        consumableForm={consumableForm}
        isSubmittingConsumable={isSubmittingConsumable}
        onDelete={handleDeleteConsumable}
        onClose={closeConsumableDialog}
        onSubmit={submitConsumableEdit}
      />
    </>
  )
}
