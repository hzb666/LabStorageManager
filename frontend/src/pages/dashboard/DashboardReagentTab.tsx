/**
 * 仪表盘 - 试剂订单 Tab
 * 展示当前用户的试剂订单列表，支持编辑和确认到货
 */
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

/**
 * 创建试剂仪表盘列表的本地筛选 API 适配器。
 * 存在原因：Dashboard 接口返回的是按状态分组的订单，需要先拍平再交给 FilterTable。
 */
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

/**
 * 计算当前记录是否禁止编辑，并返回保持原有提示文案的原因。
 * 存在原因：把权限判断和表单填充解耦，降低编辑回调的复杂度。
 */
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

/**
 * 把试剂订单转换成编辑表单默认值。
 * 存在原因：编辑表单字段较多，单独提取可以避免点击处理器承载过多赋值细节。
 */
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

/**
 * 生成入库弹窗的默认表单值。
 * 存在原因：一键入库与到货后入库的默认剩余量不同，需要集中管理初始化规则。
 */
function buildStockinFormValues(item: DashboardReagentOrder, mode: StockinMode): StockInFormInputData {
  return {
    remaining_quantity: mode === 'quick' ? (item.initial_quantity ?? '') : '',
    storage_location: '',
  }
}

/**
 * 组装试剂订单的操作按钮配置。
 * 存在原因：操作列的状态分支较多，抽出后可让列定义保持线性。
 */
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

/**
 * 构造试剂订单列表列定义和操作列。
 * 存在原因：把表格列逻辑从页面主体移出，便于主组件专注于数据与弹窗状态。
 */
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

/**
 * 渲染试剂订单编辑弹窗。
 * 存在原因：编辑表单较长，独立后能显著缩短页面主函数。
 */
function DashboardReagentEditDialog({
  editingReagent,
  isReagentEditLocked,
  deleteConfirm,
  reagentForm,
  isSubmittingReagent,
  onDelete,
  onClose,
  onSubmit,
}: Readonly<{
  editingReagent: DashboardReagentOrder | null
  isReagentEditLocked: boolean
  deleteConfirm: boolean
  reagentForm: ReturnType<typeof useForm<ReagentOrderFormInputData, unknown, ReagentOrderFormData>>
  isSubmittingReagent: boolean
  onDelete: () => void
  onClose: () => void
  onSubmit: () => void
}>) {
  return (
    <Dialog open={editingReagent !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>编辑试剂订单</span>
            {isReagentEditLocked ? <span className="text-base text-muted-foreground">当前状态仅支持删除</span> : null}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <BaseForm form={reagentForm} fields={getReagentOrderFormFields()} disabled={isReagentEditLocked} />
          <EditDialogActions
            mode="edit"
            onCancel={onClose}
            onDelete={onDelete}
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

/**
 * 渲染试剂入库弹窗。
 * 存在原因：一键入库与到货后入库共用一套 UI，但不应该继续占据页面主体长度。
 */
function DashboardReagentStockinDialog({
  stockinTarget,
  stockinMode,
  stockinForm,
  isSubmittingStockin,
  onClose,
  onSubmit,
}: Readonly<{
  stockinTarget: DashboardReagentOrder | null
  stockinMode: StockinMode
  stockinForm: ReturnType<typeof useForm<StockInFormInputData>>
  isSubmittingStockin: boolean
  onClose: () => void
  onSubmit: () => void
}>) {
  return (
    <Dialog open={stockinTarget !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stockinMode === 'quick' ? '一键入库' : '入库'}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
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
            <Button type="button" variant="modern" onClick={onClose} className="flex-1" size="lg" disabled={isSubmittingStockin}>
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

/**
 * 管理试剂订单编辑弹窗的状态、表单与提交流程。
 * 存在原因：编辑链路字段多、校验分支多，需要从主页面中下沉为局部 hook。
 */
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

  const isReagentEditLocked = editingReagent?.status === 'approved' || editingReagent?.status === 'rejected'

  /**
   * 打开试剂编辑弹窗，并在进入前执行权限校验与表单重置。
   * 存在原因：避免把权限分支和字段赋值全部塞进点击处理器。
   */
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

  /**
   * 提交试剂订单编辑。
   * 存在原因：保存后需要同时刷新 Dashboard、订单列表和库存相关缓存。
   */
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

  /**
   * 处理试剂订单删除的二次确认与实际删除。
   * 存在原因：保留既有交互节奏，同时把删除逻辑集中到一个入口。
   */
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

  /**
   * 关闭试剂编辑弹窗并恢复默认表单状态。
   * 存在原因：让关闭逻辑统一处理编辑记录、删除确认和表单重置。
   */
  const closeReagentDialog = useCallback(() => {
    setEditingReagent(null)
    setDeleteConfirm(false)
    reagentForm.reset(defaultReagentOrderValues)
  }, [reagentForm])

  return {
    editingReagent,
    deleteConfirm,
    isSubmittingReagent,
    isReagentEditLocked,
    reagentForm,
    handleReagentEdit,
    submitReagentEdit,
    handleDeleteReagent,
    closeReagentDialog,
  }
}

/**
 * 管理试剂入库弹窗的状态、表单与提交流程。
 * 存在原因：一键入库与到货入库共享一套弹窗，适合独立为局部 hook。
 */
function useReagentStockinDialog(refreshTables: () => Promise<void>) {
  const [stockinTarget, setStockinTarget] = useState<DashboardReagentOrder | null>(null)
  const [stockinMode, setStockinMode] = useState<StockinMode>('quick')
  const [isSubmittingStockin, setIsSubmittingStockin] = useState(false)

  const stockinForm = useForm<StockInFormInputData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  /**
   * 清空入库弹窗的选中记录与表单状态。
   * 存在原因：提交成功后的程序化关闭与用户手动关闭需要共享同一份清理逻辑。
   */
  const resetStockinDialog = useCallback(() => {
    setStockinTarget(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm])

  /**
   * 打开入库弹窗并根据入库模式设置默认剩余量。
   * 存在原因：一键入库和到货后入库共享弹窗，但默认表单值不同。
   */
  const openStockinDialog = useCallback((item: DashboardReagentOrder, mode: StockinMode) => {
    setStockinTarget(item)
    setStockinMode(mode)
    stockinForm.reset(buildStockinFormValues(item, mode))
  }, [stockinForm])

  /**
   * 关闭入库弹窗并恢复默认表单状态。
   * 存在原因：防止处理中被关闭，同时避免上次输入残留到下一次入库。
   */
  const closeStockinDialog = useCallback(() => {
    if (isSubmittingStockin) return
    resetStockinDialog()
  }, [isSubmittingStockin, resetStockinDialog])

  /**
   * 提交试剂入库。
   * 存在原因：入库前既要保留前端剩余量校验，也要复用后端错误映射逻辑。
   */
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

/**
 * 管理仪表盘中的试剂订单列表、编辑和入库流程。
 * 存在原因：试剂订单动作最多，主组件需要退回到“状态编排 + 组件组合”的职责。
 */
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

  const {
    editingReagent,
    deleteConfirm,
    isSubmittingReagent,
    isReagentEditLocked,
    reagentForm,
    handleReagentEdit,
    submitReagentEdit,
    handleDeleteReagent,
    closeReagentDialog,
  } = useReagentEditDialog({
    currentUserId: currentUser?.id,
    currentUserRole: currentUser?.role,
    isAdmin,
    refreshTables,
  })

  const {
    stockinTarget,
    stockinMode,
    stockinForm,
    isSubmittingStockin,
    openStockinDialog,
    closeStockinDialog,
    submitStockin,
  } = useReagentStockinDialog(refreshTables)

  const reagentColumns = useMemo(
    () => createReagentColumns({
      currentUserId: currentUser?.id,
      currentUserRole: currentUser?.role,
      isAdmin,
      refreshTables,
      onEdit: (item) => handleReagentEdit(item as unknown as Record<string, unknown>),
      openStockinDialog,
    }),
    [currentUser?.id, currentUser?.role, handleReagentEdit, isAdmin, openStockinDialog, refreshTables]
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
        editingReagent={editingReagent}
        isReagentEditLocked={isReagentEditLocked}
        deleteConfirm={deleteConfirm}
        reagentForm={reagentForm}
        isSubmittingReagent={isSubmittingReagent}
        onDelete={handleDeleteReagent}
        onClose={closeReagentDialog}
        onSubmit={submitReagentEdit}
      />
      <DashboardReagentStockinDialog
        stockinTarget={stockinTarget}
        stockinMode={stockinMode}
        stockinForm={stockinForm}
        isSubmittingStockin={isSubmittingStockin}
        onClose={closeStockinDialog}
        onSubmit={submitStockin}
      />
    </>
  )
}
