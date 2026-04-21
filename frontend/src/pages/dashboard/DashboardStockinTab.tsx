/** 仪表盘待入库 Tab。 */
import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import * as v from 'valibot'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FilterTable } from '@/components/ui/FilterTable'
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { toast } from '@/lib/toast'
import { formatDateTime, processNotes } from '@/lib/utils'

import { inventoryAPI, reagentOrderAPI } from '@/api/client'
import type { StockInPayload } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { INVENTORY_SSE_EVENTS } from '@/lib/sseEvents'
import { useSSEStore } from '@/store/sseStore'
import { useAuthStore } from '@/store/useStore'
import {
  StockInFormSchema,
  type StockInFormInputData,
  type StockInFormData,
  createValibotResolver,
  createRemainingQuantitySchema,
  extractApiErrorDetail,
  normalizeApiErrorMessage,
  resolveSpecificationQuantity,
  resolveSpecificationUnit,
  toValidationErrors,
} from '@/lib/validationSchemas'
import { defaultStockInValues, getStockInFormFields } from '@/lib/formConfigs'

import {
  type PendingStockinItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  ADMIN_STOCKIN_SEARCH_FIELDS,
  DASHBOARD_EMPTY_STATUS_OPTIONS,
  buildLocalListData,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const pendingStockinColumnHelper = createColumnHelper<PendingStockinItem>()

// 待入库列表只请求一次接口，再包装成 `FilterTable` 需要的本地搜索和分页结构。
function createPendingStockinDashboardAPI(managementMode: boolean): FilterAPI {
  return {
    list: async (params) => {
      const response = managementMode
        ? await inventoryAPI.getAdminPendingStockin()
        : await inventoryAPI.getPendingStockin()
      const rows = (response.data?.data ?? []) as PendingStockinItem[]
      const local = buildLocalListData(
        rows as unknown as Record<string, unknown>[],
        params as DashboardParams,
        ['name', 'cas_number', ...(managementMode ? ['temporary_keeper_name'] : [])]
      )
      return { data: local as { data: unknown[]; total: number } }
    },
  }
}

function createStockinColumns(
  openStockinModal: (item: PendingStockinItem) => void,
  managementMode: boolean
): ColumnDef<Record<string, unknown>, unknown>[] {
  const columns: ColumnDef<PendingStockinItem, unknown>[] = [
    pendingStockinColumnHelper.accessor('name', {
      header: '名称',
      size: 180,
      cell: (info) => <span>{info.getValue()}</span>,
    }),
    pendingStockinColumnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
    }),
    pendingStockinColumnHelper.accessor('initial_quantity', {
      header: '数量',
      size: 120,
      cell: (info) => `${info.getValue()} ${info.row.original.unit}`,
    }),
    pendingStockinColumnHelper.accessor('stockin_time', {
      header: '暂存时间',
      size: 180,
      cell: (info) => formatDateTime(info.getValue()),
    }),
  ]

  if (managementMode) {
    columns.push(
      pendingStockinColumnHelper.accessor('temporary_keeper_name', {
        header: '暂存人',
        size: 120,
        cell: (info) => info.getValue() || '-',
      }),
    )
  }

  columns.push(
    pendingStockinColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 140,
      cell: (info) => (
        <Button
          size="sm"
          className="text-sm"
          onClick={() => openStockinModal(info.row.original)}
        >
          入库
        </Button>
      ),
    }),
  )

  return columns as ColumnDef<Record<string, unknown>, unknown>[]
}

function buildPendingStockinFormValues(item: PendingStockinItem): StockInFormInputData {
  return {
    name: item.name || '',
    cas_number: item.cas_number || '',
    english_name: item.english_name || '',
    alias: item.alias || '',
    category: item.category || '',
    brand: item.brand || '',
    purity: item.purity || '',
    specification: item.specification || '',
    is_hazardous: Boolean(item.is_hazardous),
    notes: item.notes || '',
    remaining_quantity: item.remaining_quantity ?? '',
    storage_location: '',
  }
}

function buildPendingStockinPayload(formData: StockInFormData): StockInPayload {
  return {
    name: formData.name,
    english_name: formData.english_name || '',
    alias: formData.alias || '',
    category: formData.category || '',
    brand: formData.brand || '',
    purity: formData.purity || '',
    specification: formData.specification,
    is_hazardous: formData.is_hazardous,
    notes: processNotes(formData.notes),
    storage_location: formData.storage_location,
    remaining_quantity: formData.remaining_quantity,
  }
}

// 弹窗展示当前待入库记录名称、CAS、数量，并承载统一的入库表单。
function DashboardStockinDialog({
  dialog,
}: Readonly<{
  dialog: {
    selectedStockin: PendingStockinItem | null
    stockinForm: ReturnType<typeof useForm<StockInFormInputData, unknown, StockInFormData>>
    stockinLoading: boolean
    onClose: () => void
    onSubmit: () => void
  }
}>) {
  const {
    selectedStockin,
    stockinForm,
    stockinLoading,
    onClose,
    onSubmit,
  } = dialog
  const watchedSpecification = useWatch({
    control: stockinForm.control,
    name: 'specification',
  })
  const stockinUnit = resolveSpecificationUnit(watchedSpecification, selectedStockin?.unit)

  return (
    <Dialog
      open={selectedStockin !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !stockinLoading) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>入库</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <BaseForm
            form={stockinForm}
            fields={getStockInFormFields(stockinUnit)}
          />

          <EditDialogActions
            mode="add"
            onCancel={onClose}
            submitLabelEdit="确认入库"
            submitLabelAdd="确认入库"
            isSubmitting={stockinLoading}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 负责待入库列表本地筛选、入库弹窗状态，以及入库成功后的库存和统计缓存刷新。
export function DashboardStockinTab({
  managementMode = false,
}: Readonly<{ managementMode?: boolean }>) {
  const currentUser = useAuthStore((state) => state.user)
  const clearRoomStale = useSSEStore((state) => state.clearRoomStale)
  const queryClient = useQueryClient()

  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLoading, setStockinLoading] = useState(false)

  const stockinForm = useForm<StockInFormInputData, unknown, StockInFormData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    clearRoomStale('inventory')
    requestDashboardCountsRefresh()
  }, [clearRoomStale, queryClient])

  const pendingStockinDashboardAPI = useMemo(
    () => createPendingStockinDashboardAPI(managementMode),
    [managementMode]
  )

  // 每次打开待入库弹窗都回填当前暂存记录，避免上一条记录的输入残留到下一次。
  const openStockinModal = useCallback((item: PendingStockinItem) => {
    setSelectedStockin(item)
    stockinForm.reset(buildPendingStockinFormValues(item))
  }, [stockinForm])

  // 提交前先在前端校验 `remaining_quantity` 上限；成功后失效 `dashboard/stockin`、`inventory` 并刷新统计。
  const handleStockin = stockinForm.handleSubmit(async (formData) => {
    if (!selectedStockin) return
    if (!selectedStockin.order_id) {
      toast.error('缺少订单关联信息，无法入库，请联系管理员')
      return
    }

    const remaining = formData.remaining_quantity
    const maxValue = resolveSpecificationQuantity(
      formData.specification,
      selectedStockin.initial_quantity,
    )
    if (typeof maxValue === 'number') {
      const check = createRemainingQuantitySchema('剩余量', maxValue)
      const parsed = v.safeParse(check, remaining)
      if (!parsed.success) {
        stockinForm.setError('remaining_quantity', { message: parsed.issues[0]?.message || '输入不合法' })
        return
      }
    }

    setStockinLoading(true)
    try {
      await reagentOrderAPI.stockIn(selectedStockin.order_id, buildPendingStockinPayload(formData))
      setSelectedStockin(null)
      stockinForm.reset(defaultStockInValues)
      await refreshTables()
      toast.success('入库成功')
    } catch (error) {
      const detail = extractApiErrorDetail(error)
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
      setStockinLoading(false)
    }
  })

  // 关闭弹窗时清空 `selectedStockin` 并恢复 `defaultStockInValues`。
  const closeStockinModal = useCallback(() => {
    if (stockinLoading) return
    setSelectedStockin(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm, stockinLoading])

  const stockinColumns = useMemo(
    () => createStockinColumns(openStockinModal, managementMode),
    [managementMode, openStockinModal]
  )
  const stockinDialog = {
    selectedStockin,
    stockinForm,
    stockinLoading,
    onClose: closeStockinModal,
    onSubmit: handleStockin,
  }

  return (
    <>
      <FilterTable
        api={pendingStockinDashboardAPI}
        queryKey={managementMode ? ['dashboard', 'admin', 'stockin'] : ['dashboard', 'stockin']}
        tableId={managementMode ? 'dashboard-admin-stockin' : 'dashboard-stockin'}
        realtime={{
          room: 'inventory',
          eventTypes: INVENTORY_SSE_EVENTS,
          staleOnly: true,
          onRefresh: refreshTables,
          shouldHandleEvent: (event, context) => {
            const payload = event.data as Record<string, unknown>
            const item = payload.item as Record<string, unknown> | undefined
            let itemId: number | null = null
            if (typeof payload.id === 'number') {
              itemId = payload.id
            } else if (typeof item?.id === 'number') {
              itemId = item.id
            }

            if (itemId !== null && context.loadedIds.has(itemId)) {
              return true
            }

            if (managementMode) {
              return true
            }

            if (!item || typeof currentUser?.id !== 'number') {
              return false
            }

            return item.temporary_keeper_id === currentUser.id
          },
        }}
        customColumns={stockinColumns}
        statusOptions={DASHBOARD_EMPTY_STATUS_OPTIONS}
        searchFieldOptions={managementMode ? ADMIN_STOCKIN_SEARCH_FIELDS : BORROW_SEARCH_FIELDS}
        searchPlaceholder={managementMode ? '搜索名称、CAS号、暂存人...' : '搜索名称、CAS号...'}
        title={
          <>
            <ArrowRightLeft className="w-5 h-5" />{' '}
            {managementMode ? '全部暂存试剂' : '待入库（暂存）'}
          </>
        }
        enableExpandAll={true}
      />
      <DashboardStockinDialog
        dialog={stockinDialog}
      />
    </>
  )
}
