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

/**
 * 创建待入库列表的本地筛选 API 适配器。
 * 存在原因：Dashboard 只拉取一次待入库数据，再交给通用表格做本地搜索和分页。
 */
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

/**
 * 构造待入库列表列定义。
 * 存在原因：把列渲染与入库按钮配置从页面主体中抽离，降低主函数长度。
 */
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

/**
 * 渲染待入库弹窗。
 * 存在原因：主页面只保留状态与提交逻辑，弹窗表单结构单独收口。
 */
function DashboardStockinDialog({
  open,
  selectedStockin,
  stockinForm,
  stockinLoading,
  onClose,
  onSubmit,
}: Readonly<{
  open: boolean
  selectedStockin: PendingStockinItem | null
  stockinForm: ReturnType<typeof useForm<StockInFormInputData>>
  stockinLoading: boolean
  onClose: () => void
  onSubmit: () => void
}>) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
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

/**
 * 管理仪表盘中的待入库列表与入库弹窗。
 * 存在原因：把“本地筛选列表 + 入库提交”组合在一个轻量容器里，避免页面函数继续膨胀。
 */
export function DashboardStockinTab() {
  const queryClient = useQueryClient()

  const [showStockinModal, setShowStockinModal] = useState(false)
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

  /**
   * 打开入库弹窗并重置默认表单值。
   * 存在原因：避免上一次提交失败后的输入残留到下一条待入库记录。
   */
  const openStockinModal = useCallback((item: PendingStockinItem) => {
    setSelectedStockin(item)
    stockinForm.reset(defaultStockInValues)
    setShowStockinModal(true)
  }, [stockinForm])

  /**
   * 提交待入库记录的入库请求。
   * 存在原因：保留前端剩余量校验，并在成功后刷新 Dashboard 与库存缓存。
   */
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
      setShowStockinModal(false)
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

  /**
   * 关闭入库弹窗并恢复默认表单状态。
   * 存在原因：统一管理弹窗关闭时的记录与表单清理动作。
   */
  const closeStockinModal = useCallback(() => {
    setShowStockinModal(false)
    setSelectedStockin(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm])

  const stockinColumns = useMemo(
    () => createStockinColumns(openStockinModal),
    [openStockinModal]
  )

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
        open={showStockinModal}
        selectedStockin={selectedStockin}
        stockinForm={stockinForm}
        stockinLoading={stockinLoading}
        onClose={closeStockinModal}
        onSubmit={handleStockin}
      />
    </>
  )
}
