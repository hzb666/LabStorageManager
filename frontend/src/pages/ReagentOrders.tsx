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
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'

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
  type CASOverviewResponse,
} from '@/api/client'
import { formatDate, processNotes, getInventoryBorrowLabel } from '@/lib/utils'
import { ReagentOrderExpandedRow } from '@/components/ReagentOrderExpandedRow'
import {
  ReagentOrderSchema,
  createValibotResolver,
  validateAndNormalizeCASInput,
  isSpecialCasValue,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ReagentOrderFormData, ValidationError } from '@/lib/validationSchemas'
import { getReagentOrderTableColumns } from '@/lib/tableConfigs'
import {
  getReagentOrderFormFields,
  defaultReagentOrderValues
} from '@/lib/formConfigs'

// 图标
import {
  Plus,
  FlaskConical,
  AlertTriangle,
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

type CASWarningInfo = CASOverviewResponse

const columnHelper = createColumnHelper<ReagentOrder>()

// 试剂订单状态筛选选项
const REAGENT_ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
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

function truncateDisplayName(name: string | null | undefined, maxLength = 10): string | null {
  if (!name) return null
  return name.length > maxLength ? `${name.slice(0, maxLength)}...` : name
}

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
    defaultStatus: 'all',
    defaultSearchField: 'all',
    pageSize: 50,
    debounceMs: 300,
  })

  // Dialog 状态
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [editingItem, setEditingItem] = useState<ReagentOrder | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [casWarning, setCasWarning] = useState<CASWarningInfo | null>(null)
  const [casLoading, setCasLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)
  const casRequestIdRef = useRef(0)
  const lastCheckedCasRef = useRef<string | null>(null)

  // ---------------------------------------------------------------------------
  // 表单逻辑
  // ---------------------------------------------------------------------------
  // CAS 检查（仅在失焦或点击识别按钮后触发）
  const checkCASWarning = useCallback(async (casInput: string) => {
    const casValidation = validateAndNormalizeCASInput(casInput || '')
    if ('error' in casValidation) {
      setCasWarning(null)
      setCasLoading(false)
      return
    }

    const normalizedCas = casValidation.normalized
    if (isSpecialCasValue(normalizedCas)) {
      setCasWarning(null)
      setCasLoading(false)
      lastCheckedCasRef.current = normalizedCas
      return
    }

    if (lastCheckedCasRef.current === normalizedCas) {
      return
    }

    const requestId = ++casRequestIdRef.current
    setCasLoading(true)

    try {
      const response = await reagentOrderAPI.getCASOverview(normalizedCas)
      if (requestId !== casRequestIdRef.current) return
      const overview = response.data
      setCasWarning(overview.has_warning ? overview : null)
      lastCheckedCasRef.current = normalizedCas
    } catch (error) {
      if (requestId === casRequestIdRef.current) {
        console.error('CAS check error:', error)
      }
    } finally {
      if (requestId === casRequestIdRef.current) {
        setCasLoading(false)
      }
    }
  }, [])

  // 表单实例
  const form = useForm<ReagentOrderFormData>({
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
        if (!lastCheckedCasRef.current || currentValue !== lastCheckedCasRef.current) {
          casRequestIdRef.current += 1
          setCasWarning(null)
          setCasLoading(false)
          lastCheckedCasRef.current = null
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [form])

  // 加载数据
  const loadOrders = useCallback(async () => {
    await filter.invalidate()
  }, [filter])

  // 点击添加按钮
  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultReagentOrderValues)
    setCasWarning(null)
    setCasLoading(false)
    lastCheckedCasRef.current = null
    setDialogState('add')
  }, [form, setDialogState])

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
      console.log('✅ 订单表单验证通过:', formData)

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
        const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
        const errorDetail = error.response?.data?.detail
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
    },
    (errors) => {
      console.log('❌ 表单验证失败:', errors)
    }
  )

  // 导出订单
  const handleExport = useCallback(async () => {
    try {
      const response = await reagentOrderAPI.exportOrders()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `reagent_orders_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
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
      setCasWarning(null)
      setCasLoading(false)
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
      const err = error as { response?: { data?: { detail?: string } } }
      const detail = err.response?.data?.detail
      toast.error(normalizeApiErrorMessage(detail, 'CAS 号识别失败'))
    } finally {
      setIsCasLookupLoading(false)
    }
    await checkCASWarning(casValidation.normalized)
  }, [form, checkCASWarning])

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
      setCasWarning(null)
      setCasLoading(false)
      lastCheckedCasRef.current = null
      await loadOrders()
      toast.success('试剂订单已删除')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(normalizeApiErrorMessage(err.response?.data?.detail, '删除失败'))
    }
  }, [deleteConfirm, editingItem, loadOrders, setDialogState])

  const navigateToCasSearch = useCallback((path: string, field: string) => {
    if (!casWarning?.cas_number) {
      return
    }

    const query = new URLSearchParams({
      search: casWarning.cas_number,
      field,
    })
    setDialogState(null)
    setCasWarning(null)
    setCasLoading(false)
    lastCheckedCasRef.current = null
    navigate(`${path}?${query.toString()}`)
  }, [casWarning?.cas_number, navigate, setDialogState])

  const warningDisplayName = truncateDisplayName(casWarning?.display_name)

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
            setCasWarning(null)
            setCasLoading(false)
            lastCheckedCasRef.current = null
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
                            void checkCASWarning(value)
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
            {dialogState === 'add' && casWarning && casWarning.has_warning && (
              <div className="mt-4 p-3 -mb-2 bg-orange-50 dark:bg-orange-950 rounded-md">
                <p className="text-sm text-orange-700 dark:text-orange-300 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  <span>
                    注意：检测到同 CAS 相关记录（CAS: {casWarning.cas_number}
                    {warningDisplayName ? `，名称：${warningDisplayName}` : ''}
                    ）
                  </span>
                </p>
                <div className="mt-2 space-y-1 text-sm text-orange-800 dark:text-orange-200">
                  {casWarning.orders.total_count > 0 && casWarning.orders.latest && (
                    <p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="font-bold transition-colors hover:text-orange-950 dark:hover:text-orange-100"
                            onClick={() => navigateToCasSearch('/reagents', 'cas')}
                          >
                            现有订单（共 {casWarning.orders.total_count} 条）：
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>点击搜索订单</TooltipContent>
                      </Tooltip>
                      <span>订购人：{casWarning.orders.latest.applicant_name || '未知订购人'}，</span>
                      <span>状态：{getReagentOrderStatusLabel(casWarning.orders.latest.status)}，</span>
                      <span>规格：{casWarning.orders.latest.specification}，</span>
                      <span>{formatDate(casWarning.orders.latest.created_at)}订购</span>
                    </p>
                  )}
                  {casWarning.inventory.total_count > 0 && casWarning.inventory.latest && (
                    <p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="font-bold transition-colors hover:text-orange-950 dark:hover:text-orange-100"
                            onClick={() => navigateToCasSearch('/inventory', 'cas_number')}
                          >
                            现有库存（共 {casWarning.inventory.total_count} 条）：
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>点击搜索库存</TooltipContent>
                      </Tooltip>
                      <span>{casWarning.inventory.latest.storage_location || '位置未填写'}，</span>
                      <span>{(casWarning.inventory.latest.remaining_quantity ?? '-')}</span>
                      /{casWarning.inventory.latest.specification}，
                      <span>{formatDate(casWarning.inventory.latest.created_at)}入库，</span>
                      <span>{getInventoryBorrowLabel(
                        casWarning.inventory.latest.status,
                        casWarning.inventory.latest.borrower_name
                      )}</span>
                    </p>
                  )}
                </div>
              </div>
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
        await onRefresh()
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
        await onRefresh()
        toast.success('已驳回')
      }
    }
  ], [onRefresh])

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

  const prevItem = prevProps.item
  const nextItem = nextProps.item
  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
