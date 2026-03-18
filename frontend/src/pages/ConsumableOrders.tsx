/**
 * 耗材订单页面
 * 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、完成
 * 参考 Inventory 页面实现，使用 FilterTable 组件
 */
import React, { useState, useMemo, useCallback } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useForm } from 'react-hook-form'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { toast } from '@/lib/toast'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'
import { UserRoles } from '@/lib/constants'
import { useTableState, type FilterAPI } from '@/hooks/useTableState'

// 工具与API
import { consumableOrderAPI } from '@/api/client'
import { processNotes } from '@/lib/utils'
import { ConsumableOrderExpandedRow } from '@/components/ConsumableOrderExpandedRow'
import {
  ConsumableOrderSchema,
  createValibotResolver,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ConsumableOrderFormData, ValidationError } from '@/lib/validationSchemas'
import { getConsumableOrderTableColumns } from '@/lib/tableConfigs'
import {
  getConsumableOrderFormFields,
  defaultConsumableOrderValues
} from '@/lib/formConfigs'

// 图标
import {
  Plus,
  ShoppingCart,
  ArrowUpFromLine,
} from 'lucide-react'

interface ConsumableOrder {
  id: number
  name: string
  english_name: string | null
  product_number: string | null
  specification: string
  unit: string | null
  quantity: number
  price: number | null
  communication: string | null
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
  status: string
  created_at: string
  updated_at: string
}

const columnHelper = createColumnHelper<ConsumableOrder>()

// 耗材订单状态筛选选项
const CONSUMABLE_ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'completed', label: '已完成' },
]

// 耗材订单搜索字段选项
const CONSUMABLE_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'specification', label: '规格' },
  { value: 'applicant', label: '订购人' },
]

// ============================================================================
// 主组件
// ============================================================================

export function ConsumableOrdersPage() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const canCreateOrder = currentUser?.role !== UserRoles.PUBLIC

  // ---------------------------------------------------------------------------
  // 状态管理
  // ---------------------------------------------------------------------------
  // 使用 useTableState 管理表格状态
  const filter = useTableState({
    api: consumableOrderAPI,
    queryKey: ['consumable-orders'],
    tableId: 'consumable-orders-table',
    statusOptions: CONSUMABLE_ORDER_STATUS_OPTIONS,
    searchFieldOptions: CONSUMABLE_SEARCH_FIELD_OPTIONS,
    defaultStatus: 'all',
    defaultSearchField: 'all',
    pageSize: 50,
    debounceMs: 300,
  })

  // Dialog 状态
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [editingItem, setEditingItem] = useState<ConsumableOrder | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ---------------------------------------------------------------------------
  // 表单逻辑
  // ---------------------------------------------------------------------------
  // 表单实例
  const form = useForm<ConsumableOrderFormData>({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  // 加载数据
  const loadOrders = useCallback(async () => {
    await filter.invalidate()
  }, [filter])

  // 点击添加按钮
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    form.reset(defaultConsumableOrderValues)
    setDialogState('add')
  }, [form, setDialogState])

  // 点击编辑按钮
  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ConsumableOrder
    setEditingItem(item)
    form.reset({
      name: item.name || '',
      english_name: item.english_name || '',
      specification: item.specification || '',
      unit: item.unit || '',
      quantity: item.quantity || 1,
      product_number: item.product_number || '',
      price: item.price || undefined,
      communication: item.communication || '',
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [form, setDialogState])

  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      console.log('✅ 耗材订单表单验证通过:', formData)

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          await consumableOrderAPI.update(editingItem.id, {
            name: formData.name,
            english_name: formData.english_name || '',
            product_number: formData.product_number || '',
            specification: formData.specification || '',
            unit: formData.unit || '',
            quantity: formData.quantity,
            price: formData.price,
            communication: formData.communication || '',
            notes: processNotes(formData.notes)
          })
        } else if (dialogState === 'add') {
          await consumableOrderAPI.create({
            name: formData.name,
            english_name: formData.english_name || undefined,
            product_number: formData.product_number || undefined,
            specification: formData.specification,
            unit: formData.unit || undefined,
            quantity: formData.quantity,
            price: formData.price,
            communication: formData.communication || undefined,
            notes: processNotes(formData.notes),
          })
        }
        // 先刷新数据，再弹出 toast，确保数据已加载完成
        await loadOrders()
        if (dialogState === 'edit') {
          toast.success('订单信息已更新')
        } else if (dialogState === 'add') {
          toast.success('耗材订单创建成功')
        }
        setDialogState(null)
      } catch (err) {
        const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
        const errorDetail = error.response?.data?.detail
        const validationErrors = toValidationErrors(errorDetail)
        if (validationErrors.length > 0) {
          validationErrors.forEach((e: ValidationError) => {
            if (e.loc?.[1]) {
              form.setError(e.loc[1] as keyof ConsumableOrderFormData, { message: e.msg || '输入不合法' })
            }
          })
          return
        }

        toast.error(normalizeApiErrorMessage(errorDetail, '操作失败'))
      } finally {
        setIsSubmitting(false)
      }
    },
    (errors) => {
      console.log('❌ 表单验证失败:', errors)
    }
  )

  const handleExport = useCallback(async () => {
    try {
      const response = await consumableOrderAPI.exportOrders()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `consumable_orders_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // ---------------------------------------------------------------------------
  // 表格列配置
  // ---------------------------------------------------------------------------
  // 表格列配置
  const columns = useMemo(() => {
    const baseColumns = getConsumableOrderTableColumns()

    if (!isAdmin) {
      return baseColumns as ColumnDef<Record<string, unknown>, unknown>[]
    }

    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 80,
      minSize: 80,
      maxSize: 80,
      cell: info => {
        const meta = info.table.options.meta
        return (
          <ActionButtons
            item={info.row.original as unknown as Record<string, unknown>}
            onEdit={meta?.onEdit as unknown as (item: Record<string, unknown>) => void}
            isAdmin={isAdmin}
            onRefresh={filter.invalidate}
          />
        )
      },
    })

    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [isAdmin, filter.invalidate])

  // ---------------------------------------------------------------------------
  // 渲染相关回调
  // ---------------------------------------------------------------------------
  // 展开行渲染
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ConsumableOrder
    return <ConsumableOrderExpandedRow item={item} showExtraFields={true} />
  }, [])

  // ============================================================================
  // 渲染
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">耗材订购</h1>
        <div className="flex flex-wrap gap-2">
          {canCreateOrder && (
            <Button onClick={handleAddClick} size="lg">
              <Plus className="w-4 h-4 mr-1.5" /> 创建订单
            </Button>
          )}
          {isAdmin && (
            <Button variant="morden" size="lg" onClick={handleExport}>
              <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
            </Button>
          )}
        </div>
      </div>


      {/* 创建/编辑对话框 */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogState(null); form.reset() }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={getConsumableOrderFormFields(dialogState === 'edit')}
            />
            <div className="flex justify-end gap-2 mt-8">
              <Button variant="morden" size="lg" type="button" onClick={() => setDialogState(null)}>
                取消
              </Button>
              <LoadingButton type="submit" size="lg" isLoading={isSubmitting}>
                {dialogState === 'edit' ? '保存' : '提交订单'}
              </LoadingButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <FilterTable
        api={consumableOrderAPI as FilterAPI}
        queryKey={['consumable-orders']}
        tableId="consumable-orders-table"
        customColumns={columns}
        onEdit={handleEditClick}
        title={<><ShoppingCart className="w-5 h-5" /> 耗材订单列表</>}
        searchPlaceholder="搜索名称、分类、品牌..."
        renderExpandedRow={renderExpandedRow}
        noteField="notes"
      />
    </div>
  )
}

// ============================================================================
// 表格操作按钮组件
// ============================================================================

const ActionButtons = React.memo(function ActionButtons({
  item,
  onEdit,
  isAdmin,
  onRefresh,
}: {
  item: Record<string, unknown>
  onEdit: (item: Record<string, unknown>) => void
  isAdmin: boolean
  onRefresh: () => void | Promise<void>
}) {
  const actions = useMemo(() => [
    {
      id: 'approve',
      label: '审批',
      showWhen: (currItem: Record<string, unknown>) => isAdmin && currItem.status === 'pending',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.approve(currItem.id as number)
        await onRefresh()
        toast.success('审批通过')
      }
    },
    {
      id: 'reject',
      label: '驳回',
      showWhen: (currItem: Record<string, unknown>) => isAdmin && currItem.status === 'pending',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.reject(currItem.id as number, '管理员驳回')
        await onRefresh()
        toast.success('已驳回')
      }
    },
    {
      id: 'complete',
      label: '确认完成',
      showWhen: (currItem: Record<string, unknown>) => currItem.status === 'approved',
      onClick: async (currItem: Record<string, unknown>) => {
        await consumableOrderAPI.complete(currItem.id as number)
        await onRefresh()
        toast.success('耗材订单已完成')
      }
    }
  ], [isAdmin, onRefresh])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
    />
  )
}, (prevProps, nextProps) => {
  if (
    prevProps.onEdit !== nextProps.onEdit
    || prevProps.isAdmin !== nextProps.isAdmin
    || prevProps.onRefresh !== nextProps.onRefresh
  ) {
    return false
  }

  const prevItem = prevProps.item
  const nextItem = nextProps.item
  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
