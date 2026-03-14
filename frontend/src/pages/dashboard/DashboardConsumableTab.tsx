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
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { BaseForm } from '@/components/BaseForm'
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
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ConsumableOrderFormData, ValidationError } from '@/lib/validationSchemas'
import { getConsumableOrderFormFields, defaultConsumableOrderValues } from '@/lib/formConfigs'

import {
  type DashboardConsumableOrder,
  type DashboardParams,
  CONSUMABLE_STATUS_OPTIONS,
  SEARCH_FIELD_OPTIONS,
  buildLocalListData,
  flattenGroupedOrders,
  removeApplicantColumn,
} from '../../lib/dashboardUtils'

const consumableColumnHelper = createColumnHelper<DashboardConsumableOrder>()

export function DashboardConsumableTab() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const [editingConsumable, setEditingConsumable] = useState<DashboardConsumableOrder | null>(null)
  const [isSubmittingConsumable, setIsSubmittingConsumable] = useState(false)

  const consumableForm = useForm<ConsumableOrderFormData>({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'consumables'] }),
    ])
  }, [queryClient])

  const consumableDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await consumableOrderAPI.getMyConsumableOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardConsumableOrder>(grouped, currentUser?.id)
      const local = buildLocalListData(rows, params as DashboardParams, ['name', 'specification'])
      return { data: local }
    },
  }), [currentUser?.id])

  const handleConsumableEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardConsumableOrder
    if (!isAdmin && item.applicant_id !== currentUser?.id) {
      toast.warning('只能编辑自己创建的订单')
      return
    }

    setEditingConsumable(item)
    consumableForm.reset({
      name: String(item.name ?? ''),
      english_name: String(item.english_name ?? ''),
      specification: String(item.specification ?? ''),
      unit: toText(item.unit),
      quantity: Number(item.quantity ?? 1),
      price: (item.price as number | undefined) ?? undefined,
      communication: String(item.communication ?? ''),
      notes: String(item.notes ?? ''),
    })
  }, [isAdmin, currentUser?.id, consumableForm])

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
      setEditingConsumable(null)
      await refreshTables()
      toast.success('耗材订单已更新')
    } catch (err) {
      const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = error.response?.data?.detail
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

  const consumableColumns = useMemo(() => {
    const baseColumns = removeApplicantColumn(getConsumableOrderTableColumns() as ColumnDef<Record<string, unknown>, unknown>[])
    const actionColumn = consumableColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: (info) => {
        const item = info.row.original
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

        const disableEdit = !isAdmin && item.applicant_id !== currentUser?.id

        return (
          <TableActionButtonsMemo
            item={item}
            actions={actions}
            showEdit={true}
            disableEdit={disableEdit}
            onEdit={(target) => handleConsumableEdit(target as Record<string, unknown>)}
            isAdmin={isAdmin}
          />
        )
      },
    })
    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [currentUser?.id, handleConsumableEdit, isAdmin, refreshTables])

  return (
    <>
      <FilterTable
        api={consumableDashboardAPI}
        queryKey={['dashboard', 'consumables']}
        tableId="dashboard-consumable-orders"
        customColumns={consumableColumns}
        statusOptions={CONSUMABLE_STATUS_OPTIONS}
        searchFieldOptions={SEARCH_FIELD_OPTIONS}
        searchPlaceholder="搜索名称、规格..."
        title={<><ShoppingCart className="w-5 h-5" /> 我的耗材订单</>}
        noteField="notes"
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as DashboardConsumableOrder
          return <ConsumableOrderExpandedRow item={item} />
        }}
      />

      <Dialog
        open={editingConsumable !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingConsumable(null)
            consumableForm.reset(defaultConsumableOrderValues)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑耗材订单</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitConsumableEdit}>
            <BaseForm form={consumableForm} fields={getConsumableOrderFormFields(true)} />
            <div className="flex justify-end gap-2 mt-8">
              <Button variant="morden" size="lg" type="button" onClick={() => setEditingConsumable(null)}>
                取消
              </Button>
              <LoadingButton type="submit" size="lg" isLoading={isSubmittingConsumable}>
                保存
              </LoadingButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
