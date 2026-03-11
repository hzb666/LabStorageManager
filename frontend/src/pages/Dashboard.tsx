import React, { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { AxiosError } from 'axios'
import { Package, ShoppingCart, ArrowRightLeft, FlaskConical } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FilterTable } from '@/components/ui/FilterTable'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { BaseForm } from '@/components/BaseForm'
import { toast } from '@/lib/toast'
import { cn, formatDateTime, processNotes } from '@/lib/utils'
import { LABEL_STYLES, INPUT_STYLES, UserRoles } from '@/lib/constants'
import { useAuthStore } from '@/store/useStore'

import { reagentOrderAPI, consumableOrderAPI, inventoryAPI } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { getReagentOrderTableColumns, getConsumableOrderTableColumns } from '@/lib/tableConfigs'
import {
  ReagentOrderSchema,
  ConsumableOrderSchema,
  createValibotResolver,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type {
  ReagentOrderFormData,
  ConsumableOrderFormData,
  ValidationError,
} from '@/lib/validationSchemas'
import {
  getReagentOrderFormFields,
  getConsumableOrderFormFields,
  defaultReagentOrderValues,
  defaultConsumableOrderValues,
} from '@/lib/formConfigs'

interface MyBorrowItem {
  inventory_id: number
  name: string
  cas_number: string
  remaining_quantity: number
  unit: string
  borrow_time: string
}

interface PendingStockinItem {
  inventory_id: number
  name: string
  cas_number: string
  initial_quantity: number
  unit: string
  stockin_time: string
}

interface DashboardOrderBase {
  id: number
  name: string
  status: string
  created_at: string
  applicant_id?: number | null
  applicant_name?: string | null
  [key: string]: unknown
}

interface DashboardReagentOrder extends DashboardOrderBase {
  cas_number: string
  english_name?: string | null
  alias?: string | null
  category?: string | null
  brand?: string | null
  specification?: string
  quantity: number
  price?: number | null
  order_reason?: string
  is_hazardous?: boolean
  notes?: string | null
}

interface DashboardConsumableOrder extends DashboardOrderBase {
  english_name?: string | null
  specification?: string
  quantity: number
  price?: number | null
  communication?: string | null
  notes?: string | null
}

type DashboardParams = {
  skip?: number
  limit?: number
  status_filter?: string
  search?: string
  search_field?: string
  sort_by?: string
  sort_order?: string
  fuzzy?: boolean
}

const reagentColumnHelper = createColumnHelper<DashboardReagentOrder>()
const consumableColumnHelper = createColumnHelper<DashboardConsumableOrder>()
const borrowColumnHelper = createColumnHelper<MyBorrowItem>()
const pendingStockinColumnHelper = createColumnHelper<PendingStockinItem>()

type DashboardTab = 'reagents' | 'consumables' | 'borrows' | 'stockin'

const REAGENT_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'arrived', label: '已到货' },
]

const CONSUMABLE_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
]

const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
]

const BORROW_SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
]

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase()
  }
  return ''
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function sortLocally<T extends Record<string, unknown>>(rows: T[], sortBy?: string, sortOrder?: string): T[] {
  if (!sortBy) return rows
  const factor = sortOrder === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const aVal = a[sortBy]
    const bVal = b[sortBy]

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * factor
    }

    if (Date.parse(String(aVal)) && Date.parse(String(bVal))) {
      return (Date.parse(String(aVal)) - Date.parse(String(bVal))) * factor
    }

    return toText(aVal).localeCompare(toText(bVal)) * factor
  })
}

function buildLocalListData<T extends Record<string, unknown>>(
  rows: T[],
  params: DashboardParams,
  defaultSearchFields: string[]
): { data: T[]; total: number } {
  const {
    skip = 0,
    limit = 50,
    status_filter,
    search,
    search_field,
    sort_by,
    sort_order,
  } = params

  let filtered = rows

  if (status_filter && status_filter !== 'all') {
    filtered = filtered.filter((row) => String(row.status) === status_filter)
  }

  if (search) {
    const keyword = search.toLowerCase()
    filtered = filtered.filter((row) => {
      const fields = search_field && search_field !== 'all' ? [search_field] : defaultSearchFields
      return fields.some((field) => normalizeValue(row[field]).includes(keyword))
    })
  }

  filtered = sortLocally(filtered, sort_by, sort_order)

  const paged = filtered.slice(skip, skip + limit)
  return { data: paged, total: filtered.length }
}

function flattenGroupedOrders<T extends DashboardOrderBase>(
  grouped: Record<string, { orders: Record<string, unknown>[] }>,
  currentUserId?: number
): T[] {
  return Object.entries(grouped).flatMap(([status, payload]) => {
    const orders = payload?.orders ?? []
    return orders.map((raw) => ({
      ...raw,
      id: Number(raw.order_id ?? raw.id ?? 0),
      status,
      applicant_id: currentUserId ?? null,
    })) as T[]
  })
}

function StatCard({
  title,
  icon: Icon,
  value,
  onClick,
  isActive,
}: Readonly<{
  title: string
  icon: React.ElementType
  value: number
  onClick: () => void
  isActive: boolean
}>) {
  return (
    <Card
      className={cn('transition-all cursor-pointer hover:bg-accent', isActive && 'border bg-accent/50 dark:border-primary')}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', isActive && 'text-primary')}>{value}</div>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === UserRoles.ADMIN
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<DashboardTab>('reagents')

  const [editingReagent, setEditingReagent] = useState<DashboardReagentOrder | null>(null)
  const [editingConsumable, setEditingConsumable] = useState<DashboardConsumableOrder | null>(null)
  const [isSubmittingReagent, setIsSubmittingReagent] = useState(false)
  const [isSubmittingConsumable, setIsSubmittingConsumable] = useState(false)

  const [showStockinModal, setShowStockinModal] = useState(false)
  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLocation, setStockinLocation] = useState('')
  const [stockinLoading, setStockinLoading] = useState(false)

  const reagentForm = useForm<ReagentOrderFormData>({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  })

  const consumableForm = useForm<ConsumableOrderFormData>({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  })

  const refreshDashboardTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'reagents'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'consumables'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'borrows'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stockin'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
  }, [queryClient])

  const reagentDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await reagentOrderAPI.getMyOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardReagentOrder>(grouped, currentUser?.id)
      const local = buildLocalListData(rows, params as DashboardParams, ['name', 'cas_number', 'brand', 'specification'])
      return { data: local }
    },
  }), [currentUser?.id])

  const consumableDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await consumableOrderAPI.getMyOrders()
      const grouped = (response.data?.data ?? {}) as Record<string, { orders: Record<string, unknown>[] }>
      const rows = flattenGroupedOrders<DashboardConsumableOrder>(grouped, currentUser?.id)
      const local = buildLocalListData(rows, params as DashboardParams, ['name', 'specification'])
      return { data: local }
    },
  }), [currentUser?.id])

  const borrowDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await inventoryAPI.getMyBorrows()
      const rows = (response.data?.data ?? []) as MyBorrowItem[]
      const local = buildLocalListData(rows as unknown as Record<string, unknown>[], params as DashboardParams, ['name', 'cas_number'])
      return { data: local as { data: unknown[]; total: number } }
    },
  }), [])

  const pendingStockinDashboardAPI: FilterAPI = useMemo(() => ({
    list: async (params) => {
      const response = await inventoryAPI.getPendingStockin()
      const rows = (response.data?.data ?? []) as PendingStockinItem[]
      const local = buildLocalListData(rows as unknown as Record<string, unknown>[], params as DashboardParams, ['name', 'cas_number'])
      return { data: local as { data: unknown[]; total: number } }
    },
  }), [])

  const countAPI = useMemo(() => ({
    list: async () => {
      const [reagentRes, consumableRes, borrowRes, stockinRes] = await Promise.all([
        reagentOrderAPI.getMyOrders(),
        consumableOrderAPI.getMyOrders(),
        inventoryAPI.getMyBorrows(),
        inventoryAPI.getPendingStockin(),
      ])

      const reagentGrouped = (reagentRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>
      const consumableGrouped = (consumableRes.data?.data ?? {}) as Record<string, { orders: unknown[] }>

      const reagentCount = Object.values(reagentGrouped).reduce((sum, item) => sum + (item.orders?.length ?? 0), 0)
      const consumableCount = Object.values(consumableGrouped).reduce((sum, item) => sum + (item.orders?.length ?? 0), 0)
      const borrowCount = (borrowRes.data?.data ?? []).length
      const stockinCount = (stockinRes.data?.data ?? []).length

      return {
        data: {
          data: [{ reagentCount, consumableCount, borrowCount, stockinCount }],
          total: 1,
        },
      }
    },
  }), [])

  const [counts, setCounts] = useState({ reagentCount: 0, consumableCount: 0, borrowCount: 0, stockinCount: 0 })

  React.useEffect(() => {
    countAPI.list().then((res) => {
      const payload = res.data.data[0] as { reagentCount: number; consumableCount: number; borrowCount: number; stockinCount: number }
      setCounts(payload)
    }).catch(() => {
      setCounts({ reagentCount: 0, consumableCount: 0, borrowCount: 0, stockinCount: 0 })
    })
  }, [countAPI, activeTab])

  const handleReagentEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardReagentOrder
    if (!isAdmin && item.applicant_id !== currentUser?.id) {
      toast.warning('只能编辑自己创建的订单')
      return
    }

    setEditingReagent(item)
    reagentForm.reset({
      name: String(item.name ?? ''),
      cas_number: String(item.cas_number ?? ''),
      english_name: String(item.english_name ?? ''),
      alias: String(item.alias ?? ''),
      category: String(item.category ?? ''),
      brand: String(item.brand ?? ''),
      specification: String(item.specification ?? ''),
      quantity: Number(item.quantity ?? 1),
      price: (item.price as number | undefined) ?? undefined,
      order_reason: String(item.order_reason ?? 'none') as ReagentOrderFormData['order_reason'],
      is_hazardous: Boolean(item.is_hazardous),
      notes: String(item.notes ?? ''),
    })
  }, [isAdmin, currentUser?.id, reagentForm])

  const handleConsumableEdit = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as DashboardConsumableOrder
    if (!isAdmin && item.applicant_id !== currentUser?.id) {
      toast.warning('只能编辑自己创建的订单')
      return
    }

    setEditingConsumable(item)
    consumableForm.reset({
      name: String(item.name ?? ''),
      english_name: String(item.english_name ?? ''),
      specification: String(item.specification ?? ''),
      unit: toText(item.unit),
      quantity: Number(item.quantity ?? 1),
      price: (item.price as number | undefined) ?? undefined,
      communication: String(item.communication ?? ''),
      notes: String(item.notes ?? ''),
    })
  }, [isAdmin, currentUser?.id, consumableForm])

  const submitReagentEdit = reagentForm.handleSubmit(async (formData) => {
    if (!editingReagent) return
    setIsSubmittingReagent(true)
    try {
      await reagentOrderAPI.update(editingReagent.id, {
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
        notes: processNotes(formData.notes),
      })
      setEditingReagent(null)
      await refreshDashboardTables()
      toast.success('试剂订单已更新')
    } catch (err) {
      const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = error.response?.data?.detail
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            reagentForm.setError(e.loc[1] as keyof ReagentOrderFormData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '更新失败'))
    } finally {
      setIsSubmittingReagent(false)
    }
  })

  const submitConsumableEdit = consumableForm.handleSubmit(async (formData) => {
    if (!editingConsumable) return
    setIsSubmittingConsumable(true)
    try {
      await consumableOrderAPI.update(editingConsumable.id, {
        name: formData.name,
        english_name: formData.english_name || '',
        specification: formData.specification || '',
        unit: formData.unit || '',
        quantity: formData.quantity,
        price: formData.price,
        communication: formData.communication || '',
        notes: processNotes(formData.notes),
      })
      setEditingConsumable(null)
      await refreshDashboardTables()
      toast.success('耗材订单已更新')
    } catch (err) {
      const error = err as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = error.response?.data?.detail
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            consumableForm.setError(e.loc[1] as keyof ConsumableOrderFormData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '更新失败'))
    } finally {
      setIsSubmittingConsumable(false)
    }
  })

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
      await refreshDashboardTables()
      toast.success('入库成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '入库失败'))
    } finally {
      setStockinLoading(false)
    }
  }, [selectedStockin, stockinLocation, refreshDashboardTables])

  const reagentColumns = useMemo(() => {
    const baseColumns = getReagentOrderTableColumns()
    const actionColumn = reagentColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: (info) => {
        const item = info.row.original
        const actions = [
          {
            id: 'confirm-arrival',
            label: '确认到货',
            confirm: true,
            confirmLabel: '确认',
            showWhen: (currItem: DashboardReagentOrder) => currItem.status === 'approved',
            onClick: async (currItem: DashboardReagentOrder) => {
              const result = await reagentOrderAPI.confirmArrival(currItem.id)
              await refreshDashboardTables()
              toast.success(result.data.message || '确认到货成功')
            },
          },
        ]

        const disableEdit = !isAdmin && item.applicant_id !== currentUser?.id

        return (
          <TableActionButtonsMemo
            item={item}
            actions={actions}
            showEdit={true}
            disableEdit={disableEdit}
            onEdit={(target) => handleReagentEdit(target as Record<string, unknown>)}
            isAdmin={isAdmin}
          />
        )
      },
    })
    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [currentUser?.id, handleReagentEdit, isAdmin, refreshDashboardTables])

  const consumableColumns = useMemo(() => {
    const baseColumns = getConsumableOrderTableColumns()
    const actionColumn = consumableColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: (info) => {
        const item = info.row.original
        const actions = [
          {
            id: 'confirm-complete',
            label: '确认收货',
            confirm: true,
            confirmLabel: '确认',
            showWhen: (currItem: DashboardConsumableOrder) => currItem.status === 'approved',
            onClick: async (currItem: DashboardConsumableOrder) => {
              await consumableOrderAPI.complete(currItem.id)
              await refreshDashboardTables()
              toast.success('已确认收货')
            },
          },
        ]

        const disableEdit = !isAdmin && item.applicant_id !== currentUser?.id

        return (
          <TableActionButtonsMemo
            item={item}
            actions={actions}
            showEdit={true}
            disableEdit={disableEdit}
            onEdit={(target) => handleConsumableEdit(target as Record<string, unknown>)}
            isAdmin={isAdmin}
          />
        )
      },
    })
    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [currentUser?.id, handleConsumableEdit, isAdmin, refreshDashboardTables])

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
  ] as ColumnDef<Record<string, unknown>, unknown>[], [])

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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">仪表盘</h1>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="试剂订单"
          icon={ShoppingCart}
          value={counts.reagentCount}
          onClick={() => setActiveTab('reagents')}
          isActive={activeTab === 'reagents'}
        />
        <StatCard
          title="耗材订单"
          icon={ShoppingCart}
          value={counts.consumableCount}
          onClick={() => setActiveTab('consumables')}
          isActive={activeTab === 'consumables'}
        />
        <StatCard
          title="当前借用"
          icon={Package}
          value={counts.borrowCount}
          onClick={() => setActiveTab('borrows')}
          isActive={activeTab === 'borrows'}
        />
        <StatCard
          title="待入库"
          icon={ArrowRightLeft}
          value={counts.stockinCount}
          onClick={() => setActiveTab('stockin')}
          isActive={activeTab === 'stockin'}
        />
      </div>

      {activeTab === 'reagents' && (
        <FilterTable
          api={reagentDashboardAPI}
          queryKey={['dashboard', 'reagents']}
          tableId="dashboard-reagent-orders"
          customColumns={reagentColumns}
          statusOptions={REAGENT_STATUS_OPTIONS}
          searchFieldOptions={SEARCH_FIELD_OPTIONS}
          searchPlaceholder="搜索名称、CAS号、品牌..."
          title={<><FlaskConical className="w-5 h-5" /> 我的试剂订单</>}
          noteField="notes"
          enableExpandAll={false}
          renderExpandedRow={(itemRaw) => {
            const item = itemRaw as unknown as DashboardReagentOrder
            return (
              <div className="p-3 border-b border-border text-sm text-muted-foreground">
                备注：{item.notes || '-'}
              </div>
            )
          }}
        />
      )}

      {activeTab === 'consumables' && (
        <FilterTable
          api={consumableDashboardAPI}
          queryKey={['dashboard', 'consumables']}
          tableId="dashboard-consumable-orders"
          customColumns={consumableColumns}
          statusOptions={CONSUMABLE_STATUS_OPTIONS}
          searchFieldOptions={SEARCH_FIELD_OPTIONS}
          searchPlaceholder="搜索名称、规格..."
          title={<><ShoppingCart className="w-5 h-5" /> 我的耗材订单</>}
          noteField="notes"
          enableExpandAll={false}
          renderExpandedRow={(itemRaw) => {
            const item = itemRaw as unknown as DashboardConsumableOrder
            return (
              <div className="p-3 border-b border-border text-sm text-muted-foreground">
                备注：{item.notes || '-'}
              </div>
            )
          }}
        />
      )}

      {activeTab === 'borrows' && (
        <FilterTable
          api={borrowDashboardAPI}
          queryKey={['dashboard', 'borrows']}
          tableId="dashboard-borrows"
          customColumns={borrowColumns}
          statusOptions={[{ value: 'all', label: '全部' }]}
          searchFieldOptions={BORROW_SEARCH_FIELDS}
          searchPlaceholder="搜索名称、CAS号..."
          title={<><Package className="w-5 h-5" /> 我的借用记录</>}
          enableExpandAll={false}
        />
      )}

      {activeTab === 'stockin' && (
        <FilterTable
          api={pendingStockinDashboardAPI}
          queryKey={['dashboard', 'stockin']}
          tableId="dashboard-stockin"
          customColumns={stockinColumns}
          statusOptions={[{ value: 'all', label: '全部' }]}
          searchFieldOptions={BORROW_SEARCH_FIELDS}
          searchPlaceholder="搜索名称、CAS号..."
          title={<><ArrowRightLeft className="w-5 h-5" /> 待入库（暂存）</>}
          enableExpandAll={false}
        />
      )}

      <Dialog
        open={editingReagent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingReagent(null)
            reagentForm.reset(defaultReagentOrderValues)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑试剂订单</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReagentEdit}>
            <BaseForm form={reagentForm} fields={getReagentOrderFormFields(true)} />
            <div className="flex justify-end gap-2 mt-8">
              <Button variant="morden" size="lg" type="button" onClick={() => setEditingReagent(null)}>
                取消
              </Button>
              <LoadingButton type="submit" size="lg" isLoading={isSubmittingReagent}>
                保存
              </LoadingButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingConsumable !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingConsumable(null)
            consumableForm.reset(defaultConsumableOrderValues)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑耗材订单</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitConsumableEdit}>
            <BaseForm form={consumableForm} fields={getConsumableOrderFormFields(true)} />
            <div className="flex justify-end gap-2 mt-8">
              <Button variant="morden" size="lg" type="button" onClick={() => setEditingConsumable(null)}>
                取消
              </Button>
              <LoadingButton type="submit" size="lg" isLoading={isSubmittingConsumable}>
                保存
              </LoadingButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
    </div>
  )
}
