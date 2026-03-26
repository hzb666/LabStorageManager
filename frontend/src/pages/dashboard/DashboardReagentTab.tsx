// 仪表盘中的试剂订单页签，承载本地筛选、编辑、到货确认和入库流程。
import { useMemo, useState, useCallback } from 'react'
import * as v from 'valibot'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { FlaskConical, PackageCheck, Warehouse } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { ReagentOrderExpandedRow } from '@/components/ReagentOrderExpandedRow'
import { toast } from '@/lib/toast'
import { processNotes } from '@/lib/utils'
import { UserRoles } from '@/lib/constants'
import { useAuthStore } from '@/store/useStore'

import { reagentOrderAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { getReagentOrderTableColumns } from '@/lib/tableConfigs'
import {
  ReagentOrderSchema,
  StockInFormSchema,
  type StockInFormInputData,
  type ReagentOrderFormData,
  type ReagentOrderFormInputData,
  createValibotResolver,
  createRemainingQuantitySchema,
  extractApiErrorDetail,
  getApiErrorMessage,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import {
  getReagentOrderFormFields,
  defaultReagentOrderValues,
  defaultStockInValues,
  getStockInFormFields,
} from '@/lib/formConfigs'

import {
  type DashboardReagentOrder,
  type DashboardParams,
  REAGENT_STATUS_OPTIONS,
  DASHBOARD_REAGENT_SEARCH_FIELDS,
  buildLocalListData,
  flattenGroupedOrders,
  removeApplicantColumn,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const reagentColumnHelper = createColumnHelper<DashboardReagentOrder>()

type StockinMode = 'quick' | 'arrived'

// Dashboard 接口返回按状态分组的订单，这里先拍平成 `FilterTable` 需要的本地列表。
function createReagentDashboardAPI(currentUserId?: number): FilterAPI {
  return {
    list: async (params) => {
      const response = await reagentOrderAPI.getMyReagentOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardReagentOrder>(grouped, currentUserId)
      const local = buildLocalListData(rows, params as DashboardParams, [
        'name',
        'cas_number',
        'brand',
        'specification',
        'created_at',
      ])
      return { data: local }
    },
  }
}

// `public` 不能编辑，非管理员只能编辑本人订单，管理员不受 `applicant_id` 限制。
function getReagentEditBlockMessage(
  item: DashboardReagentOrder,
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

// 映射编辑表单需要回填的订单字段，其中 `cas_number` 仅用于展示与回填，不参与更新提交。
function buildReagentFormValues(item: DashboardReagentOrder): ReagentOrderFormInputData {
  return {
    name: String(item.name ?? ''),
    cas_number: String(item.cas_number ?? ''),
    english_name: String(item.english_name ?? ''),
    alias: String(item.alias ?? ''),
    category: String(item.category ?? ''),
    brand: String(item.brand ?? ''),
    specification: String(item.specification ?? ''),
    quantity: Number(item.quantity ?? 1),
    price: (item.price as number | undefined) ?? undefined,
    order_reason: String(item.order_reason ?? '') as ReagentOrderFormData['order_reason'],
    is_hazardous: Boolean(item.is_hazardous),
    notes: String(item.notes ?? ''),
  }
}

// `quick` 模式默认用 `initial_quantity` 填充 `remaining_quantity`，`arrived` 模式默认留空。
function buildStockinFormValues(item: DashboardReagentOrder, mode: StockinMode): StockInFormInputData {
  return {
    remaining_quantity: mode === 'quick' ? (item.initial_quantity ?? '') : '',
    storage_location: '',
  }
}

// `approved` 状态显示“到货 / 一键入库”，`arrived` 状态显示“入库”。
function createReagentActions(
  refreshTables: () => Promise<void>,
  openStockinDialog: (item: DashboardReagentOrder, mode: StockinMode) => void
) {
  return [
    {
      id: 'confirm-arrival',
      label: '到货',
      icon: <PackageCheck className="size-4" />,
      variant: 'modern' as const,
      className: 'text-blue-600/90 hover:text-blue-700 dark:text-blue-400/70 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
      confirm: true,
      confirmLabel: '确认',
      showWhen: (currItem: DashboardReagentOrder) => currItem.status === 'approved',
      onClick: async (currItem: DashboardReagentOrder) => {
        await reagentOrderAPI.confirmArrival(currItem.id, {})
        await refreshTables()
        toast.success('确认到货成功')
      },
    },
    {
      id: 'quick-stock-in',
      label: '一键入库',
      icon: <Warehouse className="size-4" />,
      variant: 'modern' as const,
      className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
      showWhen: (currItem: DashboardReagentOrder) => currItem.status === 'approved',
      onClick: (currItem: DashboardReagentOrder) => {
        openStockinDialog(currItem, 'quick')
      },
    },
    {
      id: 'arrived-stock-in',
      label: '入库',
      showWhen: (currItem: DashboardReagentOrder) => currItem.status === 'arrived',
      onClick: (currItem: DashboardReagentOrder) => {
        openStockinDialog(currItem, 'arrived')
      },
    },
  ]
}

// 复用通用列、移除申请人列，并按角色和申请人归属决定编辑按钮是否禁用。
function createReagentColumns({
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
  onEdit,
  openStockinDialog,
}: Readonly<{
  currentUserId: number | undefined
  currentUserRole: string | undefined
  isAdmin: boolean
  refreshTables: () => Promise<void>
  onEdit: (item: DashboardReagentOrder) => void
  openStockinDialog: (item: DashboardReagentOrder, mode: StockinMode) => void
}>): ColumnDef<Record<string, unknown>, unknown>[] {
  const baseColumns = removeApplicantColumn(
    getReagentOrderTableColumns() as ColumnDef<Record<string, unknown>, unknown>[]
  )
  const actions = createReagentActions(refreshTables, openStockinDialog)
  const actionColumn = reagentColumnHelper.display({
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
          onEdit={(target) => onEdit(target as DashboardReagentOrder)}
          isAdmin={isAdmin}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

// `approved` / `rejected` 状态只允许删除，不允许保存编辑。
function DashboardReagentEditDialog({
  dialog,
}: Readonly<{
  dialog: ReturnType<typeof useReagentEditDialog>
}>) {
  const {
    editingReagent,
    deleteConfirm,
    reagentForm,
    isSubmittingReagent,
    handleDeleteReagent,
    closeReagentDialog,
    submitReagentEdit,
  } = dialog
  const isReagentEditLocked =
    editingReagent?.status === 'approved' || editingReagent?.status === 'rejected'

  return (
    <Dialog open={editingReagent !== null} onOpenChange={(open) => { if (!open) closeReagentDialog() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>编辑试剂订单</span>
            {isReagentEditLocked ? <span className="text-base text-muted-foreground">当前状态仅支持删除</span> : null}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submitReagentEdit}>
            <BaseForm form={reagentForm} fields={getReagentOrderFormFields()} disabled={isReagentEditLocked} />
          <EditDialogActions
            mode="edit"
            onCancel={closeReagentDialog}
            onDelete={handleDeleteReagent}
            deleteConfirm={deleteConfirm}
            submitLabelEdit="保存"
            submitLabelAdd="保存"
            isSubmitting={isSubmittingReagent}
            disableSubmit={isReagentEditLocked}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 同一弹窗承载 `quick / arrived` 两种入库流程，标题与默认值随 `stockinMode` 变化。
function DashboardReagentStockinDialog({
  dialog,
}: Readonly<{
  dialog: ReturnType<typeof useReagentStockinDialog>
}>) {
  const {
    stockinTarget,
    stockinMode,
    stockinForm,
    isSubmittingStockin,
    closeStockinDialog,
    submitStockin,
  } = dialog

  return (
    <Dialog open={stockinTarget !== null} onOpenChange={(open) => { if (!open) closeStockinDialog() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stockinMode === 'quick' ? '一键入库' : '入库'}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submitStockin}>
          <div>
            <p>{stockinTarget?.name}</p>
            <p className="text-sm text-muted-foreground">
              CAS: {stockinTarget?.cas_number} • 规格: {stockinTarget?.specification || '-'}
            </p>
          </div>

          <BaseForm
            form={stockinForm}
            fields={getStockInFormFields(stockinTarget?.unit ?? undefined)}
            layout="stack"
          />

          <div className="flex gap-3 mt-8">
            <Button type="button" variant="modern" onClick={closeStockinDialog} className="flex-1" size="lg" disabled={isSubmittingStockin}>
              取消
            </Button>
            <LoadingButton
              type="submit"
              isLoading={isSubmittingStockin}
              loadingText="处理中..."
              className="flex-1"
              size="lg"
            >
              确认入库
            </LoadingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 统一管理编辑目标、删除确认、表单实例、提交后的刷新和字段错误回填。
function useReagentEditDialog({
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
}: Readonly<{
  currentUserId: number | undefined
  currentUserRole: string | undefined
  isAdmin: boolean
  refreshTables: () => Promise<void>
}>) {
  const [editingReagent, setEditingReagent] = useState<DashboardReagentOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmittingReagent, setIsSubmittingReagent] = useState(false)

  const reagentForm = useForm<ReagentOrderFormInputData, unknown, ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })

  // 进入编辑前先做角色和归属校验，通过后再重置表单并清空删除确认态。
  const handleReagentEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardReagentOrder
    const blockMessage = getReagentEditBlockMessage(item, currentUserRole, currentUserId, isAdmin)
    if (blockMessage) {
      toast.warning(blockMessage)
      return
    }

    setEditingReagent(item)
    setDeleteConfirm(false)
    reagentForm.reset(buildReagentFormValues(item))
  }, [currentUserId, currentUserRole, isAdmin, reagentForm])

  // 编辑成功后同时刷新 Dashboard、订单列表和库存缓存；字段级错误回填表单而不是 toast。
  const submitReagentEdit = reagentForm.handleSubmit(async (formData) => {
    if (!editingReagent) return
    setIsSubmittingReagent(true)
    try {
      await reagentOrderAPI.update(editingReagent.id, {
        name: formData.name,
        english_name: formData.english_name || '',
        alias: formData.alias || '',
        category: formData.category || '',
        brand: formData.brand || '',
        specification: formData.specification || '',
        quantity: formData.quantity,
        price: formData.price,
        order_reason: formData.order_reason,
        is_hazardous: formData.is_hazardous,
        notes: processNotes(formData.notes),
      })
      setDeleteConfirm(false)
      setEditingReagent(null)
      await refreshTables()
      toast.success('试剂订单已更新')
    } catch (err) {
      const detail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            reagentForm.setError(e.loc[1] as keyof ReagentOrderFormData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '更新失败'))
    } finally {
      setIsSubmittingReagent(false)
    }
  })

  // 删除走二次确认：第一次只切换确认态，第二次才真正调用删除接口。
  const handleDeleteReagent = useCallback(async () => {
    if (!editingReagent) return

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await reagentOrderAPI.delete(editingReagent.id)
      setDeleteConfirm(false)
      setEditingReagent(null)
      reagentForm.reset(defaultReagentOrderValues)
      await refreshTables()
      toast.success('试剂订单已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [deleteConfirm, editingReagent, reagentForm, refreshTables])

  // 关闭编辑弹窗时统一清空当前记录、删除确认和表单默认值。
  const closeReagentDialog = useCallback(() => {
    setEditingReagent(null)
    setDeleteConfirm(false)
    reagentForm.reset(defaultReagentOrderValues)
  }, [reagentForm])

  return {
    editingReagent,
    deleteConfirm,
    isSubmittingReagent,
    reagentForm,
    handleReagentEdit,
    submitReagentEdit,
    handleDeleteReagent,
    closeReagentDialog,
  }
}

// 统一管理入库目标、入库模式、表单默认值、关闭保护和提交后的重置。
function useReagentStockinDialog(refreshTables: () => Promise<void>) {
  const [stockinTarget, setStockinTarget] = useState<DashboardReagentOrder | null>(null)
  const [stockinMode, setStockinMode] = useState<StockinMode>('quick')
  const [isSubmittingStockin, setIsSubmittingStockin] = useState(false)

  const stockinForm = useForm<StockInFormInputData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  // 提交成功和手动关闭共用同一套入库重置逻辑。
  const resetStockinDialog = useCallback(() => {
    setStockinTarget(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm])

  // 打开入库弹窗时按 `mode` 设置默认剩余量。
  const openStockinDialog = useCallback((item: DashboardReagentOrder, mode: StockinMode) => {
    setStockinTarget(item)
    setStockinMode(mode)
    stockinForm.reset(buildStockinFormValues(item, mode))
  }, [stockinForm])

  // 提交中禁止关闭；关闭时重置记录和表单，避免上次输入残留到下一次入库。
  const closeStockinDialog = useCallback(() => {
    if (isSubmittingStockin) return
    resetStockinDialog()
  }, [isSubmittingStockin, resetStockinDialog])

  // 入库前先按 `initial_quantity` 校验 `remaining_quantity` 上限，后端字段错误继续映射回表单。
  const submitStockin = stockinForm.handleSubmit(async (formData) => {
    if (!stockinTarget) return
    const remaining = Number(formData.remaining_quantity)
    const maxValue = stockinTarget.initial_quantity

    if (typeof maxValue === 'number') {
      const check = createRemainingQuantitySchema('剩余量', maxValue)
      const parsed = v.safeParse(check, remaining)
      if (!parsed.success) {
        stockinForm.setError('remaining_quantity', { message: parsed.issues[0]?.message || '输入不合法' })
        return
      }
    }

    setIsSubmittingStockin(true)
    try {
      await reagentOrderAPI.stockIn(stockinTarget.id, {
        storage_location: formData.storage_location,
        remaining_quantity: remaining,
      })
      resetStockinDialog()
      await refreshTables()
      toast.success('入库成功')
    } catch (err) {
      const detail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            stockinForm.setError(e.loc[1] as keyof StockInFormInputData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '入库失败'))
    } finally {
      setIsSubmittingStockin(false)
    }
  })

  return {
    stockinTarget,
    stockinMode,
    stockinForm,
    isSubmittingStockin,
    openStockinDialog,
    closeStockinDialog,
    submitStockin,
  }
}

// 页面只负责任务列表查询刷新、列配置，以及编辑/入库弹窗编排。
export function DashboardReagentTab() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'reagents'] }),
      queryClient.invalidateQueries({ queryKey: ['reagent-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    requestDashboardCountsRefresh()
  }, [queryClient])

  const reagentDashboardAPI = useMemo(
    () => createReagentDashboardAPI(currentUser?.id),
    [currentUser?.id]
  )

  const reagentEditDialog = useReagentEditDialog({
    currentUserId: currentUser?.id,
    currentUserRole: currentUser?.role,
    isAdmin,
    refreshTables,
  })

  const stockinDialog = useReagentStockinDialog(refreshTables)
  const handleReagentEdit = reagentEditDialog.handleReagentEdit
  const openStockinDialog = stockinDialog.openStockinDialog

  const reagentColumns = useMemo(
    () => createReagentColumns({
      currentUserId: currentUser?.id,
      currentUserRole: currentUser?.role,
      isAdmin,
      refreshTables,
      onEdit: (item) => handleReagentEdit(item as unknown as Record<string, unknown>),
      openStockinDialog,
    }),
    [
      currentUser?.id,
      currentUser?.role,
      isAdmin,
      handleReagentEdit,
      refreshTables,
      openStockinDialog,
    ]
  )

  return (
    <>
      <FilterTable
        api={reagentDashboardAPI}
        queryKey={['dashboard', 'reagents']}
        tableId="dashboard-reagent-orders"
        customColumns={reagentColumns}
        statusOptions={REAGENT_STATUS_OPTIONS}
        searchFieldOptions={DASHBOARD_REAGENT_SEARCH_FIELDS}
        searchPlaceholder="搜索名称、CAS号、品牌、订购时间..."
        title={<><FlaskConical className="w-5 h-5" /> 我的试剂订单</>}
        noteField="notes"
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as DashboardReagentOrder
          return <ReagentOrderExpandedRow item={item} />
        }}
      />
      <DashboardReagentEditDialog
        dialog={reagentEditDialog}
      />
      <DashboardReagentStockinDialog
        dialog={stockinDialog}
      />
    </>
  )
}
