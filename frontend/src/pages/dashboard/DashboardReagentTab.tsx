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
import { FlaskConical } from 'lucide-react'

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
  type ValidationError,
  createValibotResolver,
  createRemainingQuantitySchema,
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
} from '../../lib/dashboardUtils'

const reagentColumnHelper = createColumnHelper<DashboardReagentOrder>()

type StockinMode = 'quick' | 'arrived'

export function DashboardReagentTab() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const [editingReagent, setEditingReagent] = useState<DashboardReagentOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmittingReagent, setIsSubmittingReagent] = useState(false)
  const [stockinTarget, setStockinTarget] = useState<DashboardReagentOrder | null>(null)
  const [stockinMode, setStockinMode] = useState<StockinMode>('quick')
  const [isSubmittingStockin, setIsSubmittingStockin] = useState(false)

  const reagentForm = useForm<ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })

  const stockinForm = useForm<StockInFormInputData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'reagents'] }),
      queryClient.invalidateQueries({ queryKey: ['reagent-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
  }, [queryClient])

  const reagentDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await reagentOrderAPI.getMyReagentOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardReagentOrder>(grouped, currentUser?.id)
      const local = buildLocalListData(rows, params as DashboardParams, ['name', 'cas_number', 'brand', 'specification', 'created_at'])
      return { data: local }
    },
  }), [currentUser?.id])

  const handleReagentEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardReagentOrder
    if (currentUser?.role === UserRoles.PUBLIC) {
      toast.warning('公用账户不能编辑订单')
      return
    }
    if (!isAdmin && item.applicant_id !== currentUser?.id) {
      toast.warning('只能编辑自己创建的订单')
      return
    }

    setEditingReagent(item)
    setDeleteConfirm(false)
    reagentForm.reset({
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
    })
  }, [isAdmin, currentUser?.id, currentUser?.role, reagentForm])

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
      const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = error.response?.data?.detail
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
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(normalizeApiErrorMessage(err.response?.data?.detail, '删除失败'))
    }
  }, [deleteConfirm, editingReagent, reagentForm, refreshTables])

  const openStockinDialog = useCallback((item: DashboardReagentOrder, mode: StockinMode) => {
    setStockinTarget(item)
    setStockinMode(mode)
    stockinForm.reset({
      remaining_quantity: mode === 'quick' ? (item.initial_quantity ?? '') : '',
      storage_location: '',
    })
  }, [stockinForm])

  const closeStockinDialog = useCallback(() => {
    if (isSubmittingStockin) return
    setStockinTarget(null)
    stockinForm.reset(defaultStockInValues)
  }, [isSubmittingStockin, stockinForm])

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
      const result = await reagentOrderAPI.stockIn(stockinTarget.id, {
        storage_location: formData.storage_location,
        remaining_quantity: remaining,
      })
      closeStockinDialog()
      await refreshTables()
      toast.success(result.data?.message || '入库成功')
    } catch (err) {
      const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = error.response?.data?.detail
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

  const reagentColumns = useMemo(() => {
    const baseColumns = removeApplicantColumn(getReagentOrderTableColumns() as ColumnDef<Record<string, unknown>, unknown>[])
    const actionColumn = reagentColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: (info) => {
        const item = info.row.original
        const actions = [
          {
            id: 'confirm-arrival',
            label: '到货',
            confirm: true,
            confirmLabel: '确认',
            showWhen: (currItem: DashboardReagentOrder) => currItem.status === 'approved',
            onClick: async (currItem: DashboardReagentOrder) => {
              const result = await reagentOrderAPI.confirmArrival(currItem.id, {})
              await refreshTables()
              toast.success(result.data.message || '确认到货成功')
            },
          },
          {
            id: 'quick-stock-in',
            label: '一键入库',
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

        const disableEdit = currentUser?.role === UserRoles.PUBLIC || (!isAdmin && item.applicant_id !== currentUser?.id)

        return (
          <TableActionButtonsMemo
            item={item}
            actions={actions}
            showEdit={true}
            disableEdit={disableEdit}
            onEdit={(target) => handleReagentEdit(target as Record<string, unknown>)}
            isAdmin={isAdmin}
          />
        )
      },
    })
    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [currentUser?.id, currentUser?.role, handleReagentEdit, isAdmin, openStockinDialog, refreshTables])

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

      <Dialog
        open={editingReagent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingReagent(null)
            setDeleteConfirm(false)
            reagentForm.reset(defaultReagentOrderValues)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑试剂订单</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReagentEdit}>
            <BaseForm form={reagentForm} fields={getReagentOrderFormFields()} />
            <EditDialogActions
              mode="edit"
              onCancel={() => setEditingReagent(null)}
              onDelete={handleDeleteReagent}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存"
              submitLabelAdd="保存"
              isSubmitting={isSubmittingReagent}
            />
          </form>
        </DialogContent>
      </Dialog>

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
    </>
  )
}
