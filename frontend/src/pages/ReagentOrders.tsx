/**
 * 试剂订单页面
 * 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、入库
 * 参考 Inventory 页面实现，使用 FilterTable 组件
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { toast } from '@/lib/toast'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'
import { REAGENT_STATUS_MAP, UserRoles } from '@/lib/constants'
import { useTableState, type FilterAPI } from '@/hooks/useTableState'

// 工具与API
import {
  reagentOrderAPI,
  chemicalAPI,
  ReagentOrderReason,
} from '@/api/client'
import { downloadBlobResponse, processNotes } from '@/lib/utils'
import { ReagentOrderExpandedRow } from '@/components/ReagentOrderExpandedRow'
import {
  ReagentCasDuplicateWarning,
} from '@/components/ReagentCasDuplicateWarning'
import { useReagentCasDuplicateCheck } from '@/hooks/useReagentCasDuplicateCheck'
import {
  ReagentOrderSchema,
  createValibotResolver,
  validateAndNormalizeCASInput,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ReagentOrderFormData, ReagentOrderFormInputData, ValidationError } from '@/lib/validationSchemas'
import { getReagentOrderTableColumns } from '@/lib/tableConfigs'
import {
  getReagentOrderFormFields,
  defaultReagentOrderValues
} from '@/lib/formConfigs'

// 图标
import {
  Plus,
  FlaskConical,
  Loader2,
  ArrowUpFromLine,
  ScanSearch,
  Check,
  X,
} from 'lucide-react'

interface ReagentOrder {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  specification: string
  initial_quantity: number | null
  unit: string | null
  quantity: number
  price: number | null
  order_reason: string
  is_hazardous: boolean
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
  status: string
  created_at: string
  updated_at: string
}

const columnHelper = createColumnHelper<ReagentOrder>()

// 试剂订单状态筛选选项
const REAGENT_ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'arrived', label: '已到货' },
  { value: 'stocked', label: '已入库' },
]

// 试剂订单搜索字段选项
const REAGENT_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'cas', label: 'CAS号' },
  { value: 'name', label: '名称' },
  { value: 'brand', label: '品牌' },
  { value: 'applicant', label: '订购人' },
  { value: 'created_at', label: '订购时间' },
]

function getReagentOrderStatusLabel(status: string): string {
  return REAGENT_STATUS_MAP[status] || status
}

// ============================================================================
// 主组件
// ============================================================================

export function ReagentOrdersPage() {
  const navigate = useNavigate()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const canCreateOrder = currentUser?.role !== UserRoles.PUBLIC

  // ---------------------------------------------------------------------------
  // 状态管理
  // ---------------------------------------------------------------------------
  // 使用 useTableState 管理表格状态
  const filter = useTableState({
    api: reagentOrderAPI,
    queryKey: ['reagent-orders'],
    tableId: 'reagent-orders-table',
    statusOptions: REAGENT_ORDER_STATUS_OPTIONS,
    searchFieldOptions: REAGENT_SEARCH_FIELD_OPTIONS,
  })

  // Dialog 状态
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [editingItem, setEditingItem] = useState<ReagentOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)
  const {
    casWarning,
    casLoading,
    checkCASWarning,
    clearCASWarning,
    handleCasValueChange,
  } = useReagentCasDuplicateCheck()

  // ---------------------------------------------------------------------------
  // 表单逻辑
  // ---------------------------------------------------------------------------

  // 表单实例
  const form = useForm<ReagentOrderFormInputData, unknown, ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })

  // CAS 号变化时仅清除旧结果，不触发实时搜索
  useEffect(() => {
    const subscription = form.watch((value, field) => {
      if (field.name === 'cas_number') {
        const currentValue = (value.cas_number || '').trim().toUpperCase()
        form.clearErrors('cas_number')
        handleCasValueChange(currentValue)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, handleCasValueChange])

  useEffect(() => {
    if (!dialogState) {
      return
    }
    const currentCas = form.getValues('cas_number')
    if (currentCas) {
      checkCASWarning(currentCas)
    }
  }, [dialogState, editingItem?.id, form, checkCASWarning])

  // 加载数据
  const loadOrders = useCallback(async () => {
    await Promise.resolve(filter.invalidate())
  }, [filter])

  // 点击添加按钮
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultReagentOrderValues)
    clearCASWarning()
    setDialogState('add')
  }, [clearCASWarning, form, setDialogState])

  // 点击编辑按钮
  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ReagentOrder
    setEditingItem(item)
    setDeleteConfirm(false)
    form.reset({
      name: item.name || '',
      cas_number: item.cas_number || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      category: item.category || '',
      brand: item.brand || '',
      specification: item.specification || '',
      quantity: item.quantity || 1,
      price: item.price || undefined,
      order_reason: (item.order_reason as ReagentOrderReason) || ('' as ReagentOrderFormData['order_reason']),
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [form, setDialogState])

  // 表单提交
  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          await reagentOrderAPI.update(editingItem.id, {
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
            notes: processNotes(formData.notes)
          })
        } else if (dialogState === 'add') {
          await reagentOrderAPI.create({
            name: formData.name,
            cas_number: formData.cas_number,
            english_name: formData.english_name || undefined,
            alias: formData.alias || undefined,
            category: formData.category || undefined,
            brand: formData.brand || undefined,
            specification: formData.specification,
            quantity: formData.quantity,
            price: formData.price,
            order_reason: formData.order_reason as ReagentOrderReason,
            is_hazardous: formData.is_hazardous,
            notes: processNotes(formData.notes)
          })
        }
        // 先刷新数据，再弹出 toast，确保数据已加载完成
        await loadOrders()
        if (dialogState === 'edit') {
          toast.success('订单信息已更新')
        } else if (dialogState === 'add') {
          toast.success('试剂订单创建成功')
        }
        setDeleteConfirm(false)
        setDialogState(null)
      } catch (err) {
        const errorDetail = extractApiErrorDetail(err)
        const validationErrors = toValidationErrors(errorDetail)
        if (validationErrors.length > 0) {
          validationErrors.forEach((e: ValidationError) => {
            if (e.loc?.[1]) {
              form.setError(e.loc[1] as keyof ReagentOrderFormData, { message: e.msg || '输入不合法' })
            }
          })
          return
        }

        toast.error(normalizeApiErrorMessage(errorDetail, '操作失败'))
      } finally {
        setIsSubmitting(false)
      }
    }
  )

  // 导出订单
  const handleExport = useCallback(async () => {
    try {
      const response = await reagentOrderAPI.exportOrders()
      downloadBlobResponse(response, `reagent_orders_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // CAS 号自动识别回调
  const handleCasLookup = useCallback(async () => {
    const isValidCas = await form.trigger('cas_number')
    if (!isValidCas) {
      return
    }

    const casValue = form.getValues('cas_number')
    const casValidation = validateAndNormalizeCASInput(casValue || '')
    if ('error' in casValidation) {
      return
    }

    form.clearErrors('cas_number')
    form.setValue('cas_number', casValidation.normalized, {
      shouldDirty: true,
      shouldValidate: false,
    })

    if (isSpecialCasValue(casValidation.normalized)) {
      form.setError('cas_number', { message: '生物试剂不支持 CAS 识别查询' })
      clearCASWarning()
      return
    }

    setIsCasLookupLoading(true)
    try {
      const response = await chemicalAPI.getInfo(casValidation.normalized)
      const info = response.data
      if (info.name) {
        form.setValue('name', info.name, { shouldValidate: true })
      }
      if (info.english_name) {
        form.setValue('english_name', info.english_name, { shouldValidate: true })
      }
      if (info.warning) {
        toast.warning(info.warning)
      } else if (info.name || info.english_name) {
        toast.success('CAS 号识别成功')
      } else {
        toast.warning('已完成识别，但未获取到名称信息')
      }
    } catch (error) {
      const detail = extractApiErrorDetail(error)
      toast.error(normalizeApiErrorMessage(detail, 'CAS 号识别失败'))
    } finally {
      setIsCasLookupLoading(false)
    }
    await checkCASWarning(casValidation.normalized, { force: true })
  }, [clearCASWarning, form, checkCASWarning])

  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) return

    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await reagentOrderAPI.delete(editingItem.id)
      setDeleteConfirm(false)
      setEditingItem(null)
      setDialogState(null)
      clearCASWarning()
      await loadOrders()
      toast.success('试剂订单已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [clearCASWarning, deleteConfirm, editingItem, loadOrders, setDialogState])

  const navigateToCasSearch = useCallback((path: string, field: string) => {
    if (!casWarning?.cas_number) {
      return
    }

    const query = new URLSearchParams({
      search: casWarning.cas_number,
      field,
    })
    setDialogState(null)
    clearCASWarning()
    navigate(`${path}?${query.toString()}`)
  }, [casWarning?.cas_number, clearCASWarning, navigate, setDialogState])

  // ---------------------------------------------------------------------------
  // 表格列配置
  // ---------------------------------------------------------------------------
  // 表格列配置
  const columns = useMemo(() => {
    const baseColumns = getReagentOrderTableColumns()
    if (!isAdmin) {
      return baseColumns as ColumnDef<Record<string, unknown>, unknown>[]
    }

    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      minSize: 100,
      maxSize: 100,
      cell: info => {
        const meta = info.table.options.meta
        return (
          <ActionButtons
            item={info.row.original as unknown as Record<string, unknown>}
            onEdit={meta?.onEdit as unknown as (item: Record<string, unknown>) => void}
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
    const item = itemRaw as unknown as ReagentOrder
    return <ReagentOrderExpandedRow item={item} />
  }, [])

  // ============================================================================
  // 渲染
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">试剂订购</h1>
        <div className="flex flex-wrap gap-2">
          {canCreateOrder && (
            <Button onClick={handleAddClick} size="lg">
              <Plus className="w-4 h-4 mr-1.5" /> 创建订单
            </Button>
          )}
          {isAdmin && (
            <Button variant="modern" size="lg" onClick={handleExport}>
              <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
            </Button>
          )}
        </div>
      </div>

      {/* 创建/编辑对话框 */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState(null)
            setDeleteConfirm(false)
            form.reset()
            clearCASWarning()
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={useMemo(() => {
                const fields = getReagentOrderFormFields()
                // 为 CAS 号字段添加自动识别按钮（仅在新增模式时显示）
                if (dialogState === 'add') {
                  return fields.map(field =>
                    field.name === 'cas_number'
                      ? {
                        ...field,
                        onBlur: (value) => {
                          if (typeof value === 'string') {
                            checkCASWarning(value)
                          }
                        },
                        prefixButton: {
                          onClick: handleCasLookup,
                          loading: isCasLookupLoading,
                          title: '识别 CAS 号',
                          icon: ScanSearch
                        }
                      }
                      : field
                  )
                }
                return fields
              }, [dialogState, handleCasLookup, isCasLookupLoading, checkCASWarning])}
            />
            {/* CAS 警告显示 */}
            {dialogState === 'add' && (
              <ReagentCasDuplicateWarning
                casWarning={casWarning}
                className="mt-4 -mb-2 rounded-md bg-orange-50 p-3 dark:bg-orange-950"
                onOpenOrders={() => navigateToCasSearch('/reagents', 'cas')}
                onOpenInventory={() => navigateToCasSearch('/inventory', 'cas_number')}
                getOrderStatusLabel={getReagentOrderStatusLabel}
              />
            )}

            <EditDialogActions
              mode={dialogState ?? 'add'}
              onCancel={() => setDialogState(null)}
              onDelete={dialogState === 'edit' && editingItem ? handleDeleteClick : undefined}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存"
              submitLabelAdd="提交订单"
              isSubmitting={isSubmitting}
              leadingContent={casLoading && dialogState === 'add' ? (
                <div className="text-sm text-muted-foreground flex items-center">
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  检查CAS号中
                </div>
              ) : undefined}
            />
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <FilterTable
        api={reagentOrderAPI as FilterAPI}
        queryKey={['reagent-orders']}
        tableId="reagent-orders-table"
        statusOptions={REAGENT_ORDER_STATUS_OPTIONS}
        searchFieldOptions={REAGENT_SEARCH_FIELD_OPTIONS}
        customColumns={columns}
        onEdit={handleEditClick}
        title={<><FlaskConical className="w-5 h-5" /> 试剂订单列表</>}
        searchPlaceholder="搜索名称、CAS号、订购人、订购时间..."
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
  onRefresh,
}: {
  item: Record<string, unknown>
  onEdit: (item: Record<string, unknown>) => void
  onRefresh: () => void | Promise<void>
}) {
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const actions = useMemo(() => [
    {
      id: 'approve',
      label: '审批',
      icon: <Check className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
      confirm: true,
      confirmLabel: '确认审批',
      disableWhen: (currItem: Record<string, unknown>) => currItem.status !== 'pending' && currItem.status !== 'rejected',
      onClick: async (currItem: Record<string, unknown>) => {
        await reagentOrderAPI.approve(currItem.id as number)
        await onRefreshRef.current()
        toast.success('审批通过')
      }
    },
    {
      id: 'reject',
      label: '驳回',
      icon: <X className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      confirm: true,
      confirmLabel: '确认驳回',
      disableWhen: (currItem: Record<string, unknown>) => currItem.status !== 'pending' && currItem.status !== 'approved',
      onClick: async (currItem: Record<string, unknown>) => {
        await reagentOrderAPI.reject(currItem.id as number, '管理员驳回')
        await onRefreshRef.current()
        toast.success('已驳回')
      }
    }
  ], [])

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
    || prevProps.onRefresh !== nextProps.onRefresh
  ) {
    return false
  }

  const prevItem = prevProps.item as Record<string, unknown>
  const nextItem = nextProps.item as Record<string, unknown>
  return (
    prevItem.id === nextItem.id
    && prevItem.status === nextItem.status
    && prevItem.updated_at === nextItem.updated_at
  )
})
