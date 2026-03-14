/**
 * 仪表盘 - 待入库 Tab
 * 展示当前用户暂存的待入库记录，支持一键入库（填写存放位置）
 */
import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ArrowRightLeft } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FilterTable } from '@/components/ui/FilterTable'
import { toast } from '@/lib/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'

import { inventoryAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { normalizeApiErrorMessage } from '@/lib/validationSchemas'

import {
  type PendingStockinItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  buildLocalListData,
} from '../../lib/dashboardUtils'

const pendingStockinColumnHelper = createColumnHelper<PendingStockinItem>()

export function DashboardStockinTab() {
  const queryClient = useQueryClient()

  const [showStockinModal, setShowStockinModal] = useState(false)
  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLocation, setStockinLocation] = useState('')
  const [stockinLoading, setStockinLoading] = useState(false)

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stockin'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
  }, [queryClient])

  const pendingStockinDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await inventoryAPI.getPendingStockin()
      const rows = (response.data?.data ?? []) as PendingStockinItem[]
      const local = buildLocalListData(rows as unknown as Record<string, unknown>[], params as DashboardParams, ['name', 'cas_number'])
      return { data: local as { data: unknown[]; total: number } }
    },
  }), [])

  const openStockinModal = useCallback((item: PendingStockinItem) => {
    setSelectedStockin(item)
    setStockinLocation('')
    setShowStockinModal(true)
  }, [])

  const handleStockin = useCallback(async () => {
    if (!selectedStockin) return
    if (!stockinLocation.trim()) {
      toast.warning('请输入存放位置')
      return
    }

    setStockinLoading(true)
    try {
      await inventoryAPI.update(selectedStockin.inventory_id, { storage_location: stockinLocation })
      setShowStockinModal(false)
      setSelectedStockin(null)
      setStockinLocation('')
      await refreshTables()
      toast.success('入库成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '入库失败'))
    } finally {
      setStockinLoading(false)
    }
  }, [selectedStockin, stockinLocation, refreshTables])

  const stockinColumns = useMemo(() => [
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
          一键入库
        </Button>
      ),
    }),
  ] as ColumnDef<Record<string, unknown>, unknown>[], [openStockinModal])

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

      <Dialog open={showStockinModal} onOpenChange={setShowStockinModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>一键入库</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p>{selectedStockin?.name}</p>
              <p className="text-sm text-muted-foreground">
                CAS: {selectedStockin?.cas_number} • {selectedStockin?.initial_quantity} {selectedStockin?.unit}
              </p>
            </div>

            <div>
              <label htmlFor="dashboard-stockin-location" className={LABEL_STYLES.base}>
                存放位置 <span className="text-destructive">*</span>
              </label>
              <Input
                id="dashboard-stockin-location"
                value={stockinLocation}
                onChange={(e) => setStockinLocation(e.target.value)}
                placeholder="如: A-1-1 柜"
                className={cn(INPUT_STYLES.base)}
              />
            </div>

            <div className="flex gap-3 mt-8">
              <Button
                variant="morden"
                onClick={() => setShowStockinModal(false)}
                className="flex-1"
                size="lg"
              >
                取消
              </Button>
              <LoadingButton
                onClick={handleStockin}
                isLoading={stockinLoading}
                loadingText="处理中..."
                className="flex-1"
                size="lg"
              >
                确认入库
              </LoadingButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
