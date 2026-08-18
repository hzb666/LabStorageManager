// 试剂订单页面 功能：订单列表展示、搜索筛选、创建订单、编辑、审批、入库 参考 Inventory 页面实现，使用 FilterTable 组件
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import type { UseFormReturn } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { toast } from '@/lib/toast'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { ReagentBrandManagementDialogs } from '@/components/ReagentBrandManagementDialogs'
import useDialogState from '@/hooks/useDialogState'
import { useExportDownload } from '@/hooks/useExportDownload'
import { useIdlePreload } from '@/hooks/useIdlePreload'
import { useIsMobile } from '@/hooks/useMobile'
import { preloadRDKitModule } from '@/lib/rdkitLoader'
import { useAuthStore } from '@/store/useStore'
import { REAGENT_STATUS_MAP, UserRoles } from '@/lib/constants'
import { canWriteNonPublicData } from '@/lib/permissions'
import type { FilterAPI } from '@/hooks/useTableState'
import type { AutocompleteOption } from '@/components/ui/AutoComplete'

// 工具与API
import {
  reagentOrderAPI,
  chemicalAPI,
  ReagentOrderReason,
  type CASOverviewResponse,
} from '@/api/client'
import { processNotes } from '@/lib/utils'
import { ReagentOrderExpandedRow } from '@/components/ReagentOrderExpandedRow'
import { ReagentCasDuplicateWarning } from '@/components/ReagentCasDuplicateWarning'
import { useReagentCasDuplicateCheck } from '@/hooks/useReagentCasDuplicateCheck'
import {
  ReagentOrderSchema,
  applyValidationErrors,
  createValibotResolver,
  validateAndNormalizeCASInput,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  normalizeCASInputValue,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { ReagentOrderFormData, ReagentOrderFormInputData } from '@/lib/validationSchemas'
import { getReagentOrderTableColumns } from '@/lib/tableConfigs'
import {
  getReagentOrderFormFields,
  defaultReagentOrderValues,
  enhanceCasLookupField,
} from '@/lib/formConfigs'
import { getDialogSubmitSuccessMessage, submitByDialogState } from '@/lib/orderSubmitHelpers'
import {
  isApprovableOrderStatus,
  isOrderDeletableStatus,
  isOrderEditableByRole,
  isOrderResubmittedOnEdit,
  isRejectableOrderStatus,
} from '@/lib/orderEditRules'
import {
  getReagentBrandOptionsQueryOptions,
} from '@/lib/reagentBrandOptions'
import { REAGENT_ORDER_SSE_EVENTS } from '@/lib/sseEvents'
import { refreshDashboardAfterMutation } from '@/lib/dashboardUtils'

// 图标
import {
  Plus,
  FlaskConical,
  Loader2,
  ArrowUpFromLine,
  ScanSearch,
  Check,
  Tags,
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
  purity: string | null
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
  approved_at?: string | null
  rejected_at?: string | null
  arrived_at?: string | null
  stocked_at?: string | null
}

type ReagentOrderDialogState = 'edit' | 'add' | null

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
  { value: 'cas_number', label: 'CAS号' },
  { value: 'name', label: '名称' },
  { value: 'brand', label: '品牌' },
  { value: 'applicant', label: '订购人' },
  { value: 'created_at', label: '订购时间' },
]

const REAGENT_SSE_SEARCH_FIELD_MAP = {
  applicant: ['applicant_name'],
} satisfies Partial<Record<string, string[]>>

// 返回试剂订单状态的展示文案。 把页面、展开行和重复弹窗中的状态映射维持在同一套规则上。
function getReagentOrderStatusLabel(status: string): string {
  return REAGENT_STATUS_MAP[status] || status
}

// ============================================================================
// 页面辅助函数
// ============================================================================

// 将试剂订单数据回填到表单中。 让编辑入口复用同一套字段归一化规则，避免表单回填逻辑散落在页面中。
function createReagentOrderFormValues(item: ReagentOrder): ReagentOrderFormInputData {
  return {
    name: item.name || '',
    cas_number: item.cas_number || '',
    english_name: item.english_name || '',
    alias: item.alias || '',
    category: item.category || '',
    brand: item.brand || '',
    purity: item.purity || '',
    specification: item.specification || '',
    quantity: item.quantity || 1,
    price: item.price ?? '',
    order_reason: (item.order_reason as ReagentOrderReason) || ('' as ReagentOrderFormData['order_reason']),
    is_hazardous: item.is_hazardous || false,
    notes: item.notes || '',
  }
}

// 生成新增试剂订单的请求体。 把表单值转换与接口契约绑定到单点，减少提交处理器内的分支噪音。
function createReagentOrderCreatePayload(formData: ReagentOrderFormData) {
  const isCommonPublic = formData.order_reason === ReagentOrderReason.COMMON_PUBLIC
  return {
    name: formData.name,
    cas_number: formData.cas_number,
    english_name: formData.english_name || undefined,
    alias: formData.alias || undefined,
    category: isCommonPublic ? undefined : formData.category || undefined,
    brand: formData.brand,
    purity: formData.purity || undefined,
    specification: formData.specification,
    quantity: formData.quantity,
    price: formData.price,
    order_reason: formData.order_reason as ReagentOrderReason,
    is_hazardous: isCommonPublic ? false : formData.is_hazardous,
    notes: processNotes(formData.notes),
  }
}

// 生成编辑试剂订单的请求体，沿用当前更新接口的空字符串语义，并抽离字段组装。
function createReagentOrderUpdatePayload(formData: ReagentOrderFormData) {
  const isCommonPublic = formData.order_reason === ReagentOrderReason.COMMON_PUBLIC
  return {
    name: formData.name,
    cas_number: formData.cas_number,
    english_name: formData.english_name || '',
    alias: formData.alias || '',
    ...(isCommonPublic ? {} : { category: formData.category || '' }),
    brand: formData.brand || '',
    purity: formData.purity || '',
    specification: formData.specification || '',
    quantity: formData.quantity,
    price: formData.price,
    order_reason: formData.order_reason,
    is_hazardous: isCommonPublic ? false : formData.is_hazardous,
    notes: processNotes(formData.notes),
  }
}

// 生成试剂订单表单字段配置。 把 CAS 自动识别按钮与 onBlur 检查逻辑收口到单点，避免 JSX 内嵌复杂映射。
function createReagentOrderFormFields(params: {
  dialogState: ReagentOrderDialogState
  brandOptions: AutocompleteOption[]
  isCommonPublic: boolean
  masterDataLocked: boolean
  handleCasLookup: () => Promise<void>
  isCasLookupLoading: boolean
  checkCASWarning: (casNumber: string, options?: { force?: boolean }) => Promise<void>
}) {
  const {
    dialogState,
    brandOptions,
    isCommonPublic,
    masterDataLocked,
    handleCasLookup,
    isCasLookupLoading,
    checkCASWarning,
  } = params
  const fields = getReagentOrderFormFields({
    brandOptions,
    isEdit: dialogState === 'edit',
    isCommonPublic,
    masterDataLocked,
  })

  if (dialogState !== 'add') {
    return fields
  }

  return enhanceCasLookupField(fields, {
    onCasBlur: checkCASWarning,
    prefixButton: {
      onClick: handleCasLookup,
      loading: isCasLookupLoading,
      title: '识别 CAS 号',
      icon: ScanSearch,
    },
  })
}

function useReagentMasterDataFormSync(
  form: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>,
  masterData: CASOverviewResponse['master_data'],
  orderReason: ReagentOrderFormInputData['order_reason'],
) {
  useEffect(() => {
    if (!masterData || orderReason !== ReagentOrderReason.COMMON_PUBLIC) return
    form.setValue('name', masterData.name, { shouldValidate: true })
    form.setValue('english_name', masterData.english_name || '', { shouldValidate: true })
    form.setValue('alias', masterData.alias || '', { shouldValidate: true })
  }, [form, masterData, orderReason])

  useEffect(() => {
    if (orderReason !== ReagentOrderReason.COMMON_PUBLIC) return
    if (form.getValues('category')) {
      form.setValue('category', '', { shouldDirty: true, shouldValidate: true })
    }
    if (form.getValues('is_hazardous')) {
      form.setValue('is_hazardous', false, { shouldDirty: true, shouldValidate: true })
    }
  }, [form, orderReason])
}

function useAutoSelectCommonPublicReason(
  casOverview: CASOverviewResponse | null,
  dialogState: ReagentOrderDialogState,
  form: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>,
) {
  useEffect(() => {
    if (
      dialogState !== 'add'
      || !casOverview?.is_common_cas
      || form.getFieldState('order_reason').isDirty
      || form.getValues('order_reason')
    ) return

    form.setValue('order_reason', ReagentOrderReason.COMMON_PUBLIC, {
      shouldDirty: false,
      shouldValidate: true,
    })
  }, [casOverview, dialogState, form])
}

function useCommonPublicCasLookup(params: {
  casNumber: string
  checkCASWarning: (casNumber: string, options?: { force?: boolean }) => Promise<void>
  dialogState: ReagentOrderDialogState
  orderReason: ReagentOrderFormInputData['order_reason']
}) {
  const { casNumber, checkCASWarning, dialogState, orderReason } = params
  useEffect(() => {
    if (dialogState !== 'add' || orderReason !== ReagentOrderReason.COMMON_PUBLIC) return
    const currentCas = normalizeCASInputValue(casNumber)
    if (currentCas) void checkCASWarning(currentCas)
  }, [casNumber, checkCASWarning, dialogState, orderReason])
}

// 管理试剂订单弹窗里的 CAS 联动与重复检查。 把 CAS 专项逻辑从弹窗控制器中拆开，避免单个 hook 继续膨胀。
function useReagentOrderCasController(params: {
  dialogState: ReagentOrderDialogState
  brandOptions: AutocompleteOption[]
  editingItemId?: number
  form: UseFormReturn<ReagentOrderFormInputData, unknown, ReagentOrderFormData>
  navigate: (path: string) => void
  setDialogState: (state: ReagentOrderDialogState) => void
}) {
  const { dialogState, brandOptions, editingItemId, form, navigate, setDialogState } = params
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)
  const orderReason = useWatch({ control: form.control, name: 'order_reason' })
  const casNumber = useWatch({ control: form.control, name: 'cas_number' })
  const {
    casWarning,
    casOverview,
    casLoading,
    checkCASWarning,
    clearCASWarning,
    handleCasValueChange,
  } = useReagentCasDuplicateCheck()
  useReagentMasterDataFormSync(form, casOverview?.master_data ?? null, orderReason)
  useAutoSelectCommonPublicReason(casOverview, dialogState, form)
  useCommonPublicCasLookup({
    casNumber: casNumber || '',
    checkCASWarning,
    dialogState,
    orderReason,
  })

  useEffect(() => {
    const subscription = form.watch((value, field) => {
      if (field.name === 'cas_number') {
        const currentValue = normalizeCASInputValue(value.cas_number || '')
        form.clearErrors('cas_number')
        if (
          dialogState === 'add'
          && !form.getFieldState('order_reason').isDirty
          && form.getValues('order_reason') === ReagentOrderReason.COMMON_PUBLIC
        ) {
          form.setValue('order_reason', '' as ReagentOrderFormInputData['order_reason'], {
            shouldDirty: false,
            shouldValidate: false,
          })
        }
        handleCasValueChange(currentValue)
      }
    })
    return () => subscription.unsubscribe()
  }, [dialogState, form, handleCasValueChange])

  useEffect(() => {
    if (!dialogState) {
      return
    }
    const currentCas = form.getValues('cas_number')
    if (currentCas) {
      checkCASWarning(currentCas)
    }
  }, [dialogState, editingItemId, form, checkCASWarning])

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

  const formFields = useMemo(() => {
    return createReagentOrderFormFields({
      dialogState,
      brandOptions,
      isCommonPublic: orderReason === ReagentOrderReason.COMMON_PUBLIC,
      masterDataLocked: orderReason === ReagentOrderReason.COMMON_PUBLIC,
      handleCasLookup,
      isCasLookupLoading,
      checkCASWarning,
    })
  }, [
    dialogState,
    brandOptions,
    orderReason,
    handleCasLookup,
    isCasLookupLoading,
    checkCASWarning,
  ])

  return {
    casWarning,
    casLoading,
    clearCASWarning,
    formFields,
    navigateToCasSearch,
  }
}

// 管理试剂订单弹窗、CAS 联动与提交删除流程。 把页面主组件收回成列表编排层，同时保持 CAS 相关交互集中在一个局部控制器里。
function useReagentOrderDialogController(
  refreshOrders: () => void | Promise<void>,
  navigate: (path: string) => void,
  brandOptions: AutocompleteOption[],
) {
  const [dialogState, setDialogState] = useDialogState<'edit' | 'add'>()
  const [editingItem, setEditingItem] = useState<ReagentOrder | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ReagentOrderFormInputData, unknown, ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })
  const casController = useReagentOrderCasController({
    dialogState,
    brandOptions,
    editingItemId: editingItem?.id,
    form,
    navigate,
    setDialogState,
  })

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    form.reset(defaultReagentOrderValues)
    casController.clearCASWarning()
    setDialogState('add')
  }, [casController, form, setDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ReagentOrder
    setEditingItem(item)
    form.reset(createReagentOrderFormValues(item))
    setDialogState('edit')
  }, [form, setDialogState])

  const handleFormSubmit = form.handleSubmit(async (formData) => {
    setIsSubmitting(true)
    try {
      await submitByDialogState({
        dialogState,
        editingItem,
        formData,
        onUpdate: (currentEditingItem, currentFormData) =>
          reagentOrderAPI.update(currentEditingItem.id, createReagentOrderUpdatePayload(currentFormData)),
        onCreate: (currentFormData) =>
          reagentOrderAPI.create(createReagentOrderCreatePayload(currentFormData)),
      })
      await Promise.resolve(refreshOrders())
      const successMessage = getDialogSubmitSuccessMessage(dialogState, {
        edit: isOrderResubmittedOnEdit(editingItem?.status)
          ? '订单已重新提交待审批'
          : '订单信息已更新',
        add: '试剂订单创建成功',
      })
      if (successMessage) {
        toast.success(successMessage)
      }
      setDialogState(null)
    } catch (err) {
      const errorDetail = extractApiErrorDetail(err)
      const validationErrors = toValidationErrors(errorDetail)
      if (applyValidationErrors(validationErrors, (fieldName, message) => {
        form.setError(fieldName as keyof ReagentOrderFormData, { message })
      })) {
        return
      }
      toast.error(normalizeApiErrorMessage(errorDetail, '操作失败'))
    } finally {
      setIsSubmitting(false)
    }
  })

  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) return

    try {
      await reagentOrderAPI.delete(editingItem.id)
      setEditingItem(null)
      setDialogState(null)
      casController.clearCASWarning()
      await Promise.resolve(refreshOrders())
      toast.success('试剂订单已删除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [casController, editingItem, refreshOrders, setDialogState])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogState(null)
      form.reset()
      casController.clearCASWarning()
    }
  }, [casController, form, setDialogState])

  return {
    dialogState,
    editingItem,
    isSubmitting,
    casWarning: casController.casWarning,
    casLoading: casController.casLoading,
    form,
    formFields: casController.formFields,
    handleAddClick,
    handleEditClick,
    handleFormSubmit,
    handleDeleteClick,
    handleDialogOpenChange,
    navigateToCasSearch: casController.navigateToCasSearch,
    setDialogState,
  }
}

// 创建试剂订单页的表格列。 把管理员操作列的拼装从页面中抽离，降低页面函数的结构噪音。
function createReagentOrderColumns(
  isAdmin: boolean,
  onRefresh: () => void | Promise<void>,
): ColumnDef<Record<string, unknown>, unknown>[] {
  const baseColumns = getReagentOrderTableColumns()
  if (!isAdmin) {
    return baseColumns as ColumnDef<Record<string, unknown>, unknown>[]
  }

  const actionColumn = columnHelper.display({
    id: 'actions',
    header: '操作',
    size: 132,
    minSize: 132,
    maxSize: 132,
    cell: (info) => {
      const meta = info.table.options.meta
      return (
        <ActionButtons
          item={info.row.original as unknown as Record<string, unknown>}
          isAdmin={isAdmin}
          onEdit={meta?.onEdit as unknown as (item: Record<string, unknown>) => void}
          onRefresh={onRefresh}
        />
      )
    },
  })

  return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
}

// ============================================================================
// 主组件
// ============================================================================

// 直接组合列表、页头和叶子组件，去掉转发参数的壳层。
export function ReagentOrdersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const currentUser = useAuthStore((state) => state.user)
  const currentUserRole = currentUser?.role
  const isAdmin = currentUserRole === UserRoles.ADMIN
  const canCreateOrder = currentUserRole !== UserRoles.PUBLIC
  const canViewBrands = Boolean(currentUser)
  const canWriteBrands = canWriteNonPublicData(currentUserRole)
  useIdlePreload(preloadRDKitModule, !isMobile)
  const [brandManagementOpen, setBrandManagementOpen] = useState(false)
  const { data: brandOptions = [] } = useQuery(getReagentBrandOptionsQueryOptions())
  const refreshOrders = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reagent-orders'] }),
      refreshDashboardAfterMutation(queryClient),
    ])
  }, [queryClient])
  const dialogController = useReagentOrderDialogController(refreshOrders, navigate, brandOptions)

  const { handleExport, isExporting } = useExportDownload({
    apiCall: reagentOrderAPI.exportOrders,
    filePrefix: 'reagent_orders',
  })

  const columns = useMemo(() => {
    return createReagentOrderColumns(isAdmin, refreshOrders)
  }, [isAdmin, refreshOrders])

  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as ReagentOrder
    return <ReagentOrderExpandedRow item={item} />
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">试剂订购</h1>
        <div className="flex flex-wrap gap-2">
          {canCreateOrder && (
            <Button onClick={dialogController.handleAddClick} size="lg">
              <Plus className="w-4 h-4 mr-1.5" /> 创建订单
            </Button>
          )}
          {canViewBrands && (
            <Button variant="modern" size="lg" onClick={() => setBrandManagementOpen(true)}>
              <Tags className="w-4 h-4 mr-1.5" /> 品牌管理
            </Button>
          )}
          {isAdmin && (
            <LoadingButton
              variant="modern"
              size="lg"
              className="px-4"
              isLoading={isExporting}
              loadingText="导出中"
              onClick={handleExport}
            >
              <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
            </LoadingButton>
          )}
        </div>
      </div>
      {canViewBrands && (
        <ReagentBrandManagementDialogs
          open={brandManagementOpen}
          onOpenChange={setBrandManagementOpen}
          canWrite={canWriteBrands}
        />
      )}
      <Dialog open={dialogController.dialogState !== null} onOpenChange={dialogController.handleDialogOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogController.dialogState === 'edit' ? '编辑订单' : '创建订单'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={dialogController.handleFormSubmit}>
            <BaseForm form={dialogController.form} fields={dialogController.formFields} />
            {dialogController.dialogState === 'add' && (
              <ReagentCasDuplicateWarning
                casWarning={dialogController.casWarning}
                className="mt-4 -mb-2 rounded-md bg-orange-50 p-3 dark:bg-orange-950"
                onOpenOrders={() => dialogController.navigateToCasSearch('/reagents', 'cas_number')}
                onOpenInventory={() => dialogController.navigateToCasSearch('/inventory', 'cas_number')}
                getOrderStatusLabel={getReagentOrderStatusLabel}
              />
            )}
            <EditDialogActions
              mode={dialogController.dialogState ?? 'add'}
              onCancel={() => dialogController.setDialogState(null)}
              onDelete={
                dialogController.dialogState === 'edit' &&
                dialogController.editingItem &&
                isOrderDeletableStatus(dialogController.editingItem.status)
                  ? dialogController.handleDeleteClick
                  : undefined
              }
              submitLabelEdit="保存"
              submitLabelAdd="提交订单"
              isSubmitting={dialogController.isSubmitting}
              leadingContent={dialogController.casLoading && dialogController.dialogState === 'add' ? (
                <div className="text-sm text-muted-foreground flex items-center">
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  检查CAS号中
                </div>
              ) : undefined}
            />
          </form>
        </DialogContent>
      </Dialog>
      <FilterTable
        api={reagentOrderAPI as FilterAPI}
        queryKey={['reagent-orders']}
        tableId="reagent-orders-table"
        realtime={{
          room: 'reagent_orders',
          eventTypes: REAGENT_ORDER_SSE_EVENTS,
          onRefresh: refreshOrders,
          searchFieldMap: REAGENT_SSE_SEARCH_FIELD_MAP,
        }}
        statusOptions={REAGENT_ORDER_STATUS_OPTIONS}
        searchFieldOptions={REAGENT_SEARCH_FIELD_OPTIONS}
        customColumns={columns}
        onEdit={dialogController.handleEditClick}
        title={<><FlaskConical className="w-5 h-5" /> 试剂订单列表</>}
        searchPlaceholder="搜索名称、CAS号、订购人、订购时间..."
        renderExpandedRow={renderExpandedRow}
        noteField="notes"
        inlineCompletionEndpoint="/reagent-orders/"
        enableInlineCompletion
      />
    </div>
  )
}

// ============================================================================
// 表格操作按钮组件
// ============================================================================

// 渲染试剂订单行级操作。 把审批与驳回逻辑封装在表格单元内，避免页面主组件直接承载行级动作细节。
const ActionButtons = React.memo(function ActionButtons({
  item,
  isAdmin,
  onEdit,
  onRefresh,
}: {
  item: Record<string, unknown>
  isAdmin: boolean
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
      disableWhen: (currItem: Record<string, unknown>) => !isApprovableOrderStatus(currItem.status),
      onClick: async (currItem: Record<string, unknown>) => {
        await reagentOrderAPI.approve(currItem.id as number)
        await onRefreshRef.current()
        toast.success('审批通过')
      },
      onError: (error: unknown) => toast.error(getApiErrorMessage(error, '审批失败')),
    },
    {
      id: 'reject',
      label: '驳回',
      icon: <X className="size-4.5" />,
      variant: 'modern' as const,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      confirm: true,
      confirmLabel: '确认驳回',
      disableWhen: (currItem: Record<string, unknown>) => !isRejectableOrderStatus(currItem.status),
      onClick: async (currItem: Record<string, unknown>) => {
        await reagentOrderAPI.reject(currItem.id as number, '管理员驳回')
        await onRefreshRef.current()
        toast.success('已驳回')
      },
      onError: (error: unknown) => toast.error(getApiErrorMessage(error, '驳回失败')),
    }
  ], [])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      disableEdit={!isOrderEditableByRole(item.status, isAdmin)}
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
