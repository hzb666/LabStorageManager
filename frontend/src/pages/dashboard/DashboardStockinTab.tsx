/**
 * 仪表盘 - 待入库 Tab
 * 展示当前用户暂存的待入库记录，支持一键入库（填写存放位置）
 */
import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { useForm } from 'react-hook-form'
import * as v from 'valibot'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FilterTable } from '@/components/ui/FilterTable'
import { BaseForm } from '@/components/BaseForm'
import { toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/utils'

import { inventoryAPI, reagentOrderAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import {
  StockInFormSchema,
  type StockInFormInputData,
  createValibotResolver,
  createRemainingQuantitySchema,
  extractApiErrorDetail,
  normalizeApiErrorMessage,
  toValidationErrors,
} from '@/lib/validationSchemas'
import { defaultStockInValues, getStockInFormFields } from '@/lib/formConfigs'

import {
  type PendingStockinItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  buildLocalListData,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const pendingStockinColumnHelper = createColumnHelper<PendingStockinItem>()

// 待入库列表只请求一次接口，再包装成 `FilterTable` 需要的本地搜索和分页结构。
function createPendingStockinDashboardAPI(): FilterAPI {
  return {
    list: async (params) => {
      const response = await inventoryAPI.getPendingStockin()
      const rows = (response.data?.data ?? []) as PendingStockinItem[]
      const local = buildLocalListData(
        rows as unknown as Record<string, unknown>[],
        params as DashboardParams,
        ['name', 'cas_number']
      )
      return { data: local as { data: unknown[]; total: number } }
    },
  }
}

function createStockinColumns(
  openStockinModal: (item: PendingStockinItem) => void
): ColumnDef<Record<string, unknown>, unknown>[] {
  return [
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
    pendingStockinColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 140,
      cell: (info) => (
        <Button size="sm" onClick={() => openStockinModal(info.row.original)}>
          入库
        </Button>
      ),
    }),
  ] as ColumnDef<Record<string, unknown>, unknown>[]
}

// 弹窗展示当前待入库记录名称、CAS、数量，并承载统一的入库表单。
function DashboardStockinDialog({
  dialog,
}: Readonly<{
  dialog: {
    selectedStockin: PendingStockinItem | null
    stockinForm: ReturnType<typeof useForm<StockInFormInputData>>
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

  return (
    <Dialog open={selectedStockin !== null} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>入库</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <p>{selectedStockin?.name}</p>
            <p className="text-sm text-muted-foreground">
              CAS: {selectedStockin?.cas_number} • {selectedStockin?.initial_quantity} {selectedStockin?.unit}
            </p>
          </div>

          <BaseForm
            form={stockinForm}
            fields={getStockInFormFields(selectedStockin?.unit)}
            layout="stack"
          />

          <div className="flex gap-3 mt-8">
            <Button
              type="button"
              variant="modern"
              onClick={onClose}
              className="flex-1"
              size="lg"
            >
              取消
            </Button>
            <LoadingButton
              type="submit"
              isLoading={stockinLoading}
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

// 负责待入库列表本地筛选、入库弹窗状态，以及入库成功后的库存和统计缓存刷新。
export function DashboardStockinTab() {
  const queryClient = useQueryClient()

  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLoading, setStockinLoading] = useState(false)

  const stockinForm = useForm<StockInFormInputData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stockin'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    requestDashboardCountsRefresh()
  }, [queryClient])

  const pendingStockinDashboardAPI = useMemo(
    () => createPendingStockinDashboardAPI(),
    []
  )

  // 每次打开待入库弹窗都恢复 `defaultStockInValues`，避免上一条记录的输入残留到下一次。
  const openStockinModal = useCallback((item: PendingStockinItem) => {
    setSelectedStockin(item)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm])

  // 提交前先在前端校验 `remaining_quantity` 上限；成功后失效 `dashboard/stockin`、`inventory` 并刷新统计。
  const handleStockin = stockinForm.handleSubmit(async (formData) => {
    if (!selectedStockin) return
    if (!selectedStockin.order_id) {
      toast.error('缺少订单关联信息，无法入库，请联系管理员')
      return
    }

    const remaining = Number(formData.remaining_quantity)
    const maxValue = selectedStockin.initial_quantity
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
      await reagentOrderAPI.stockIn(selectedStockin.order_id, {
        storage_location: formData.storage_location,
        remaining_quantity: remaining,
      })
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
    setSelectedStockin(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm])

  const stockinColumns = useMemo(
    () => createStockinColumns(openStockinModal),
    [openStockinModal]
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
        queryKey={['dashboard', 'stockin']}
        tableId="dashboard-stockin"
        customColumns={stockinColumns}
        statusOptions={[{ value: 'all', label: '全部' }]}
        searchFieldOptions={BORROW_SEARCH_FIELDS}
        searchPlaceholder="搜索名称、CAS号..."
        title={<><ArrowRightLeft className="w-5 h-5" /> 待入库（暂存）</>}
        enableExpandAll={true}
      />
      <DashboardStockinDialog
        dialog={stockinDialog}
      />
    </>
  )
}
