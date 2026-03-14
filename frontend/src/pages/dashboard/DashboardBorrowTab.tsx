/**
 * 仪表盘 - 借用记录 Tab
 * 展示当前用户的借用列表，支持归还操作（使用量/剩余量模式）
 */
import React, { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { AxiosError } from 'axios'
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
  normalizeApiErrorMessage,
  createReturnQuantitySchema,
} from '@/lib/validationSchemas'
import { getReturnFormFields, defaultReturnValues } from '@/lib/formConfigs'

import {
  type MyBorrowItem,
  type DashboardParams,
  BORROW_SEARCH_FIELDS,
  buildLocalListData,
} from '../../lib/dashboardUtils'

const borrowColumnHelper = createColumnHelper<MyBorrowItem>()

// 借用记录展开行 - Dashboard 独有（展示借用详情 + 分子结构）
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

export function DashboardBorrowTab() {
  const queryClient = useQueryClient()

  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnMode, setReturnMode] = useState<'used' | 'remaining'>('used')
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
  }, [queryClient])

  const borrowDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await inventoryAPI.getMyBorrows()
      const rows = (response.data?.data ?? []) as MyBorrowItem[]
      const local = buildLocalListData(rows as unknown as Record<string, unknown>[], params as DashboardParams, ['name', 'cas_number'])
      return { data: local as { data: unknown[]; total: number } }
    },
  }), [])

  const openReturnModal = useCallback((item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnMode('used')
    returnForm.reset({ return_mode: 'used', return_quantity: '' })
    setShowReturnModal(true)
  }, [returnForm])

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
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '归还失败'))
    } finally {
      setIsSubmittingReturn(false)
    }
  }, (errors) => {
    console.log('Form validation errors:', errors)
  })

  const borrowColumns = useMemo(() => [
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
    borrowColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      cell: (info) => (
        <Button
          size="sm"
          className="h-8 text-sm leading-4"
          onClick={(e) => {
            e.stopPropagation()
            openReturnModal(info.row.original)
          }}
        >
          归还
        </Button>
      ),
    }),
  ] as ColumnDef<Record<string, unknown>, unknown>[], [openReturnModal])

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

      <Dialog
        open={showReturnModal}
        onOpenChange={(open) => {
          setShowReturnModal(open)
          if (!open) {
            setSelectedBorrow(null)
            setReturnMode('used')
            returnForm.reset(defaultReturnValues)
          }
        }}
      >
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
                onValueChange={(value) => {
                  setReturnMode(value as 'used' | 'remaining')
                  returnForm.setError('return_quantity', { message: '' })
                  returnForm.resetField('return_quantity')
                }}
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

            <BaseForm
              form={returnForm}
              fields={getReturnFormFields(returnMode, selectedBorrow?.remaining_quantity ?? 0)}
              layout="stack"
            />

            {returnMode === 'used' && returnForm.watch('return_quantity') && selectedBorrow && (
              <p className="text-sm text-muted-foreground mt-1">
                归还后剩余: {Math.max(0, selectedBorrow.remaining_quantity - (parseFloat(returnForm.watch('return_quantity') as string) || 0)).toFixed(2)} {selectedBorrow.unit} (原借用时剩余量: {selectedBorrow.remaining_quantity} {selectedBorrow.unit})
              </p>
            )}
            {returnMode === 'remaining' && returnForm.watch('return_quantity') && selectedBorrow && (
              <p className="text-sm text-muted-foreground mt-1">
                归还后剩余: {(parseFloat(returnForm.watch('return_quantity') as string) || 0).toFixed(2)} {selectedBorrow.unit} (原借用时剩余量: {selectedBorrow.remaining_quantity} {selectedBorrow.unit})
              </p>
            )}

            <div className="flex gap-3 mt-8">
              <Button
                variant="morden"
                onClick={() => setShowReturnModal(false)}
                className="flex-1"
                size="lg"
              >
                取消
              </Button>
              <LoadingButton
                onClick={handleReturn}
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
    </>
  )
}
