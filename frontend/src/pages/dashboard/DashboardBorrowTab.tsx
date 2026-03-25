/**
 * 仪表盘 - 借用记录 Tab
 * 展示当前用户的借用列表，支持归还操作（使用量/剩余量模式）
 */
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
import {
  ReturnFormSchema,
  createValibotResolver,
  getApiErrorMessage,
  createReturnQuantitySchema,
} from '@/lib/validationSchemas'
import { getReturnFormFields, defaultReturnValues } from '@/lib/formConfigs'

import {
  type MyBorrowItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  buildLocalListData,
  requestDashboardCountsRefresh,
} from '../../lib/dashboardUtils'

const borrowColumnHelper = createColumnHelper<MyBorrowItem>()
type BorrowReturnMode = 'used' | 'remaining'

/**
 * 渲染借用记录展开行，并补充分子结构与最近借用信息。
 * 存在原因：Dashboard 的借用列表需要比通用表格行展示更多上下文详情。
 */
const BorrowDashboardExpandedRow = React.memo(function BorrowDashboardExpandedRow({
  item,
}: Readonly<{ item: MyBorrowItem }>) {
  const [detail, setDetail] = useState<Partial<MyBorrowItem> | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const loadDetail = async () => {
      try {
        const response = await inventoryAPI.get(item.inventory_id)
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

/**
 * 创建借用列表的本地筛选 API 适配器。
 * 存在原因：Dashboard 只拿一次完整列表，再在前端复用 FilterTable 的筛选与分页能力。
 */
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

/**
 * 构造借用列表列定义。
 * 存在原因：把表格列渲染从页面主体中拆开，避免主组件同时处理表格和弹窗逻辑。
 */
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

/**
 * 生成归还表单下方的剩余量预览文本。
 * 存在原因：把“使用量/剩余量”两套展示逻辑从 JSX 中拆出来，减少条件渲染复杂度。
 */
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

/**
 * 渲染借用归还弹窗。
 * 存在原因：主页面只负责状态编排，弹窗内部的表单和说明文本独立收口。
 */
function DashboardBorrowReturnDialog({
  open,
  selectedBorrow,
  returnMode,
  returnForm,
  isSubmittingReturn,
  onReturnModeChange,
  onSubmit,
  onOpenChange,
}: Readonly<{
  open: boolean
  selectedBorrow: MyBorrowItem | null
  returnMode: BorrowReturnMode
  returnForm: ReturnForm
  isSubmittingReturn: boolean
  onReturnModeChange: (value: BorrowReturnMode) => void
  onSubmit: () => void
  onOpenChange: (open: boolean) => void
}>) {
  const returnPreviewText = getReturnPreviewText(
    selectedBorrow,
    returnMode,
    String(returnForm.watch('return_quantity') ?? '')
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

type ReturnForm = UseFormReturn<typeof defaultReturnValues>

/**
 * 管理仪表盘中的借用列表与归还弹窗。
 * 存在原因：页面需要同时组合 FilterTable、本地筛选和归还流程，但主体应保持为编排层。
 */
export function DashboardBorrowTab() {
  const queryClient = useQueryClient()

  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnMode, setReturnMode] = useState<BorrowReturnMode>('used')
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false)

  const returnForm = useForm({
    resolver: createValibotResolver(ReturnFormSchema),
    defaultValues: defaultReturnValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'borrows'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    requestDashboardCountsRefresh()
  }, [queryClient])

  const borrowDashboardAPI = useMemo(() => createBorrowDashboardAPI(), [])

  /**
   * 打开归还弹窗并重置为默认输入模式。
   * 存在原因：避免上一次归还流程留下的表单态串到下一条记录。
   */
  const openReturnModal = useCallback((item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnMode('used')
    returnForm.reset({ return_mode: 'used', return_quantity: '' })
    setShowReturnModal(true)
  }, [returnForm])

  /**
   * 处理归还提交，并在成功后刷新相关列表缓存。
   * 存在原因：归还既会影响 Dashboard 借用列表，也会影响库存列表。
   */
  const handleReturn = returnForm.handleSubmit(async (formData) => {
    if (!selectedBorrow) return

    const inputValue = formData.return_quantity
    const fieldName = returnMode === 'remaining' ? '剩余量' : '使用量'
    const maxValue = selectedBorrow.remaining_quantity

    const schema = createReturnQuantitySchema(fieldName, maxValue)
    const result = v.safeParse(schema, inputValue)

    if (!result.success) {
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
        unit: selectedBorrow.unit,
      })
      setShowReturnModal(false)
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

  /**
   * 切换归还模式时清空旧的数量输入和错误信息。
   * 存在原因：使用量与剩余量的校验规则不同，保留旧值会误导用户。
   */
  const handleReturnModeChange = useCallback((value: BorrowReturnMode) => {
    setReturnMode(value)
    returnForm.setError('return_quantity', { message: '' })
    returnForm.resetField('return_quantity')
  }, [returnForm])

  /**
   * 在弹窗关闭时统一清理选中记录和表单状态。
   * 存在原因：让关闭行为只保留一个出口，避免多个回调遗漏重置步骤。
   */
  const handleReturnDialogOpenChange = useCallback((open: boolean) => {
    setShowReturnModal(open)
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

  return (
    <>
      <FilterTable
        api={borrowDashboardAPI}
        queryKey={['dashboard', 'borrows']}
        tableId="dashboard-borrows"
        customColumns={borrowColumns}
        statusOptions={[{ value: 'all', label: '全部' }]}
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
        open={showReturnModal}
        selectedBorrow={selectedBorrow}
        returnMode={returnMode}
        returnForm={returnForm}
        isSubmittingReturn={isSubmittingReturn}
        onReturnModeChange={handleReturnModeChange}
        onSubmit={handleReturn}
        onOpenChange={handleReturnDialogOpenChange}
      />
    </>
  )
}
