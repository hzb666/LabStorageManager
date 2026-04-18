/** 仪表盘借用记录 Tab。 */
import React, { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { UseFormReturn } from 'react-hook-form'
import * as v from 'valibot'
import { Package } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { FilterTable } from '@/components/ui/FilterTable'
import { BaseForm } from '@/components/BaseForm'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import MoleculeStructure from '@/components/ui/MoleculeStructure'
import { toast } from '@/lib/toast'
import { formatDate, formatDateTime, toText } from '@/lib/utils'

import { inventoryAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { INVENTORY_SSE_EVENTS } from '@/lib/sseEvents'
import { useSSEStore } from '@/store/sseStore'
import { useAuthStore } from '@/store/useStore'
import {
  ReturnFormSchema,
  createValibotResolver,
  getApiErrorMessage,
  createReturnQuantitySchema,
  type ReturnFormData,
  type ReturnFormInputData,
} from '@/lib/validationSchemas'
import { getReturnFormFields, defaultReturnValues } from '@/lib/formConfigs'

import {
  type MyBorrowItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  DASHBOARD_EMPTY_STATUS_OPTIONS,
  buildLocalListData,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const borrowColumnHelper = createColumnHelper<MyBorrowItem>()
type BorrowReturnMode = 'used' | 'remaining'

// 展开行会补拉 inventory 详情，并把列表行数据与详情合并后展示分子结构、入库信息和最近借用人。
const BorrowDashboardExpandedRow = React.memo(function BorrowDashboardExpandedRow({
  item,
}: Readonly<{ item: MyBorrowItem }>) {
  const [detail, setDetail] = useState<Partial<MyBorrowItem> | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const loadDetail = async () => {
      try {
        const response = await inventoryAPI.get(item.inventory_id)
        // 展开行可能在请求返回前被收起或替换，取消标记用于阻止过期结果回写。
        if (!cancelled) {
          setDetail((response.data ?? {}) as Partial<MyBorrowItem>)
        }
      } catch {
        if (!cancelled) {
          setDetail(null)
        }
      }
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [item.inventory_id])

  const merged = detail ? { ...item, ...detail } : item
  let lastBorrowText = '-'
  if (merged.borrower_name) {
    lastBorrowText = `${toText(merged.borrower_name)} (未归还)`
  } else if (merged.last_borrower_name) {
    lastBorrowText = `${toText(merged.last_borrower_name)} (已归还)`
  }

  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure casNumber={toText(merged.cas_number)} width={150} height={100} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
        <div>英文名称：{toText(merged.english_name) || '-'}</div>
        <div>别名：{toText(merged.alias) || '-'}</div>
        <div>入库时间：{merged.created_at ? formatDate(toText(merged.created_at)) : '-'}</div>
        <div>入库用户：{toText(merged.created_by_name) || '-'}</div>
        <div>上次借用：{lastBorrowText}</div>
        <NoteDisplay label="备注" text={toText(merged.notes) || '-'} />
      </div>
    </div>
  )
})

// 这里只请求一次我的借用列表，再交给 `buildLocalListData` 做前端筛选和分页适配 `FilterTable`。
function createBorrowDashboardAPI(): FilterAPI {
  return {
    list: async (params) => {
      const response = await inventoryAPI.getMyBorrows()
      const rows = (response.data?.data ?? []) as MyBorrowItem[]
      const local = buildLocalListData(
        rows as unknown as Record<string, unknown>[],
        params as DashboardParams,
        ['name', 'cas_number']
      )
      return { data: local as { data: unknown[]; total: number } }
    },
  }
}

function createBorrowColumns(
  openReturnModal: (item: MyBorrowItem) => void
): ColumnDef<Record<string, unknown>, unknown>[] {
  return [
    borrowColumnHelper.accessor('name', {
      header: '名称',
      size: 160,
      cell: (info) => <span>{info.getValue()}</span>,
    }),
    borrowColumnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
    }),
    borrowColumnHelper.accessor('remaining_quantity', {
      header: '借用时剩余量',
      size: 120,
      cell: (info) => `${info.getValue()} ${info.row.original.unit}`,
    }),
    borrowColumnHelper.accessor('borrow_time', {
      header: '借用时间',
      size: 180,
      cell: (info) => formatDateTime(info.getValue()),
    }),
    borrowColumnHelper.accessor('borrower_name', {
      header: '借用人',
      size: 120,
      cell: (info) => info.getValue() || '-',
    }),
    borrowColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      cell: (info) => (
        <Button
          size="sm"
          className="h-8 text-sm leading-4"
          onClick={(event) => {
            event.stopPropagation()
            openReturnModal(info.row.original)
          }}
        >
          归还
        </Button>
      ),
    }),
  ] as ColumnDef<Record<string, unknown>, unknown>[]
}

// 根据 `used / remaining` 两种模式，把输入解释成不同含义并统一生成归还后剩余量预览。
function getReturnPreviewText(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  returnQuantity: string
): string | null {
  if (!selectedBorrow || !returnQuantity) {
    return null
  }

  const quantity = parseFloat(returnQuantity) || 0
  const formattedQuantity =
    returnMode === 'used'
      ? Math.max(0, selectedBorrow.remaining_quantity - quantity).toFixed(2)
      : quantity.toFixed(2)

  return `归还后剩余: ${formattedQuantity} ${selectedBorrow.unit} (原借用时剩余量: ${selectedBorrow.remaining_quantity} ${selectedBorrow.unit})`
}

function DashboardBorrowReturnDialog({
  dialog,
}: Readonly<{
  dialog: {
    selectedBorrow: MyBorrowItem | null
    returnMode: BorrowReturnMode
    returnForm: ReturnForm
    isSubmittingReturn: boolean
    onReturnModeChange: (value: BorrowReturnMode) => void
    onSubmit: () => void
    onOpenChange: (open: boolean) => void
  }
}>) {
  const {
    selectedBorrow,
    returnMode,
    returnForm,
    isSubmittingReturn,
    onReturnModeChange,
    onSubmit,
    onOpenChange,
  } = dialog
  const returnPreviewText = getReturnPreviewText(
    selectedBorrow,
    returnMode,
    String(returnForm.watch('return_quantity') ?? '')
  )

  return (
    <Dialog open={selectedBorrow !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>归还试剂</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p>{selectedBorrow?.name}</p>
            <p className="text-muted-foreground">
              CAS: {selectedBorrow?.cas_number} • 当前剩余 {selectedBorrow?.remaining_quantity} {selectedBorrow?.unit}
            </p>
          </div>

          <div>
            <RadioGroup
              value={returnMode}
              onValueChange={(value) => onReturnModeChange(value as BorrowReturnMode)}
              className="flex flex-row gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="used" id="returnMode-used" />
                <Label htmlFor="returnMode-used" className="cursor-pointer text-base">填写使用量</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="remaining" id="returnMode-remaining" />
                <Label htmlFor="returnMode-remaining" className="cursor-pointer text-base">填写剩余量</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <BaseForm
              form={returnForm}
              fields={getReturnFormFields(
                returnMode,
                selectedBorrow?.remaining_quantity ?? 0,
                selectedBorrow?.unit
              )}
              layout="stack"
            />

            {returnPreviewText && (
              <p className="text-sm text-muted-foreground mt-1">{returnPreviewText}</p>
            )}
          </div>

          <div className="flex gap-3 mt-8">
            <Button
              variant="modern"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              size="lg"
            >
              取消
            </Button>
            <LoadingButton
              onClick={onSubmit}
              isLoading={isSubmittingReturn}
              loadingText="处理中..."
              className="flex-1"
              size="lg"
            >
              确认归还
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type ReturnForm = UseFormReturn<ReturnFormInputData, unknown, ReturnFormData>

export function DashboardBorrowTab() {
  const currentUser = useAuthStore((state) => state.user)
  const clearRoomStale = useSSEStore((state) => state.clearRoomStale)
  const queryClient = useQueryClient()

  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnMode, setReturnMode] = useState<BorrowReturnMode>('used')
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false)

  const returnForm = useForm<ReturnFormInputData, unknown, ReturnFormData>({
    resolver: createValibotResolver(ReturnFormSchema),
    defaultValues: defaultReturnValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'borrows'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    clearRoomStale('inventory')
    requestDashboardCountsRefresh()
  }, [clearRoomStale, queryClient])

  const borrowDashboardAPI = useMemo(() => createBorrowDashboardAPI(), [])

  // 每次打开归还弹窗都强制回到 `used` 模式并清空数量输入，避免沿用上一条记录的表单状态。
  const openReturnModal = useCallback((item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnMode('used')
    returnForm.reset({ return_mode: 'used', return_quantity: '', notes: item.notes ?? '' })
  }, [returnForm])

  // 提交时按当前模式校验并换算最终剩余量；成功后失效借用/库存查询并刷新统计卡片。
  const handleReturn = returnForm.handleSubmit(async (formData) => {
    if (!selectedBorrow) return

    const inputValue = formData.return_quantity
    const fieldName = returnMode === 'remaining' ? '剩余量' : '使用量'
    const maxValue = selectedBorrow.remaining_quantity

    const schema = createReturnQuantitySchema(fieldName, maxValue)
    const result = v.safeParse(schema, inputValue)

    if (!result.success) {
      // `used` 和 `remaining` 模式共享输入框，但校验边界不同，错误需要即时切换。
      returnForm.setError('return_quantity', { message: result.issues[0]?.message || '输入无效' })
      return
    }

    const numValue = result.output
    const finalQuantity = returnMode === 'remaining'
      ? numValue
      : maxValue - numValue

    setIsSubmittingReturn(true)
    try {
      await inventoryAPI.return(selectedBorrow.inventory_id, {
        remaining_quantity: finalQuantity,
        notes: formData.notes,
      })
      setSelectedBorrow(null)
      returnForm.reset(defaultReturnValues)
      await refreshTables()
      toast.success('归还成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '归还失败'))
    } finally {
      setIsSubmittingReturn(false)
    }
  }, (errors) => {
    console.log('Form validation errors:', errors)
  })

  // 切换填写模式时清空数量和字段错误，避免把“使用量”的输入带到“剩余量”校验里。
  const handleReturnModeChange = useCallback((value: BorrowReturnMode) => {
    setReturnMode(value)
    returnForm.setError('return_quantity', { message: '' })
    returnForm.resetField('return_quantity')
  }, [returnForm])

  // 关闭弹窗时统一清空选中记录、恢复默认模式并重置表单。
  const handleReturnDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSelectedBorrow(null)
      setReturnMode('used')
      returnForm.reset(defaultReturnValues)
    }
  }, [returnForm])

  const borrowColumns = useMemo(
    () => createBorrowColumns(openReturnModal),
    [openReturnModal]
  )
  const returnDialog = {
    selectedBorrow,
    returnMode,
    returnForm,
    isSubmittingReturn,
    onReturnModeChange: handleReturnModeChange,
    onSubmit: () => {
      void handleReturn()
    },
    onOpenChange: handleReturnDialogOpenChange,
  }

  return (
    <>
      <FilterTable
        api={borrowDashboardAPI}
        queryKey={['dashboard', 'borrows']}
        tableId="dashboard-borrows"
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

            if (!item || typeof currentUser?.id !== 'number') {
              return false
            }

            return item.borrower_id === currentUser.id || item.last_borrower_id === currentUser.id
          },
        }}
        customColumns={borrowColumns}
        statusOptions={DASHBOARD_EMPTY_STATUS_OPTIONS}
        searchFieldOptions={BORROW_SEARCH_FIELDS}
        searchPlaceholder="搜索名称、CAS号..."
        title={<><Package className="w-5 h-5" /> 我的借用记录</>}
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as MyBorrowItem
          return <BorrowDashboardExpandedRow item={item} />
        }}
      />
      <DashboardBorrowReturnDialog
        dialog={returnDialog}
      />
    </>
  )
}
