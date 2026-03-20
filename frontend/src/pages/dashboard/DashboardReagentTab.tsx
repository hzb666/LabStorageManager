/**
 * 仪表盘 - 试剂订单 Tab
 * 展示当前用户的试剂订单列表，支持编辑和确认到货
 */
import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { FlaskConical } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
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
  createValibotResolver,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ReagentOrderFormData, ValidationError } from '@/lib/validationSchemas'
import { getReagentOrderFormFields, defaultReagentOrderValues } from '@/lib/formConfigs'

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

export function DashboardReagentTab() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const [editingReagent, setEditingReagent] = useState<DashboardReagentOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmittingReagent, setIsSubmittingReagent] = useState(false)

  const reagentForm = useForm<ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
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
              const result = await reagentOrderAPI.confirmArrival(currItem.id)
              await refreshTables()
              toast.success(result.data.message || '确认到货成功')
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
  }, [currentUser?.id, currentUser?.role, handleReagentEdit, isAdmin, refreshTables])

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
            <BaseForm form={reagentForm} fields={getReagentOrderFormFields(true)} />
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
    </>
  )
}
