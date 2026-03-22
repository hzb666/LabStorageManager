import React, { useMemo, useCallback, useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Archive, ArrowUpFromLine, Plus, ScanSearch } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { BaseForm } from '@/components/BaseForm'
import { EditDialogActions } from '@/components/EditDialogActions'
import { FilterTable } from '@/components/ui/FilterTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { chemicalAPI, commonShelfAPI } from '@/api/client'
import { useSSE, type SSEEventHandler } from '@/hooks/useSSE'
import type { FilterAPI } from '@/hooks/useTableState'
import useDialogState from '@/hooks/useDialogState'
import { defaultInventoryValues, getInventoryFormFields } from '@/lib/formConfigs'
import { getCommonShelfTableColumns } from '@/lib/tableConfigs'
import { COMMON_SHELF_BRAND_OPTIONS, COMMON_SHELF_CATEGORY_OPTIONS } from '@/lib/options'
import { formatDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import {
  InventoryFormSchema,
  createValibotResolver,
  isSpecialCasValue,
  normalizeApiErrorMessage,
  toValidationErrors,
  validateAndNormalizeCASInput,
} from '@/lib/validationSchemas'
import type { InventoryFormData, ValidationError } from '@/lib/validationSchemas'

interface CommonShelfItem {
  id: number
  sample_inventory_id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number | null
  unit: string | null
  is_hazardous: boolean
  status: string
  created_at: string
  created_by_name?: string | null
  notes?: string | null
  available_bottles: number
  total_bottles: number
  consumed_bottles: number
  specification?: string | null
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'run_short', label: '快用完' },
  { value: 'consumed', label: '已耗尽' },
]

const SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
  { value: 'storage_location', label: '位置' },
]

const COMMON_SHELF_SSE_EVENTS = [
  'common_shelf.created',
  'common_shelf.updated',
  'common_shelf.deleted',
  'common_shelf.consumed',
] as const

const columnHelper = createColumnHelper<CommonShelfItem>()

function createCommonShelfActionColumn(): ColumnDef<CommonShelfItem, unknown> {
  return columnHelper.display({
    id: 'actions',
    header: '操作',
    size: 100,
    minSize: 100,
    maxSize: 140,
    cell: (info) => {
      const meta = info.table.options.meta
      return (
        <CommonShelfActionButtons
          item={info.row.original}
          onEdit={meta?.onEdit as (item: CommonShelfItem) => void}
          onConsumeSuccess={meta?.onBorrowSuccess as () => void}
        />
      )
    },
  })
}

export function CommonShelfPage() {
  const queryClient = useQueryClient()
  const [dialogState, setDialogState] = useDialogState<'edit' | 'add'>()
  const [editingItem, setEditingItem] = useState<CommonShelfItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)

  const form = useForm<InventoryFormData>({
    resolver: createValibotResolver(InventoryFormSchema),
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })

  const refreshCommonShelf = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['common-shelf'] })
  }, [queryClient])

  const handleCommonShelfSSEEvent = useCallback<SSEEventHandler>(() => {
    void refreshCommonShelf()
  }, [refreshCommonShelf])

  const commonShelfSSEHandlers = useMemo<Record<string, SSEEventHandler>>(() => {
    return COMMON_SHELF_SSE_EVENTS.reduce<Record<string, SSEEventHandler>>((acc, eventType) => {
      acc[eventType] = handleCommonShelfSSEEvent
      return acc
    }, {})
  }, [handleCommonShelfSSEEvent])

  useSSE({
    rooms: ['common_shelf'],
    handlers: commonShelfSSEHandlers,
  })

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultInventoryValues)
    setDialogState('add')
  }, [form, setDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as CommonShelfItem
    setEditingItem(item)
    setDeleteConfirm(false)
    form.reset({
      name: item.name || '',
      cas_number: item.cas_number || '',
      english_name: item.english_name || '',
      alias: item.alias || '',
      specification: item.specification || '',
      category: item.category || '',
      brand: item.brand || '',
      storage_location: item.storage_location || '',
      quantity_bottles: 1,
      initial_quantity: item.initial_quantity ?? undefined,
      remaining_quantity: undefined,
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || '',
      is_running_short: item.status === 'run_short',
    })
    setDialogState('edit')
  }, [form, setDialogState])

  const handleExport = useCallback(async () => {
    try {
      const response = await commonShelfAPI.exportCommonShelf()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `common_shelf_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  const handleCasLookup = useCallback(async () => {
    const casValue = form.getValues('cas_number')
    const casValidation = validateAndNormalizeCASInput(casValue || '')
    if ('error' in casValidation) {
      form.setError('cas_number', { message: casValidation.error })
      return
    }

    if (isSpecialCasValue(casValidation.normalized)) {
      form.setError('cas_number', { message: '生物试剂不支持 CAS 识别查询' })
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
      toast.success('CAS 号识别成功')
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        form.setError('cas_number', { message: normalizeApiErrorMessage(detail, 'CAS 号识别失败') })
      } else {
        toast.error('CAS 号识别失败')
      }
    } finally {
      setIsCasLookupLoading(false)
    }
  }, [form])

  const handleSubmit = form.handleSubmit(async (formData) => {
    setIsSubmitting(true)
    try {
      if (dialogState === 'edit' && editingItem) {
        await commonShelfAPI.updateGroup(editingItem.sample_inventory_id, {
          name: formData.name || '',
          cas_number: formData.cas_number || '',
          english_name: formData.english_name || '',
          alias: formData.alias || '',
          category: formData.category || '',
          storage_location: formData.storage_location || '',
          brand: formData.brand || '',
          is_hazardous: formData.is_hazardous,
          is_running_short: formData.is_running_short ?? false,
          notes: formData.notes || '',
          specification: formData.specification || '',
        })
        toast.success('常用货架分组已更新')
      } else if (dialogState === 'add') {
        const spec = formData.specification || ''
        const bottles = formData.quantity_bottles as number
        await commonShelfAPI.manualAdd({
          cas_number: formData.cas_number,
          name: formData.name,
          english_name: formData.english_name || undefined,
          alias: formData.alias || undefined,
          specification: spec,
          quantity_bottles: bottles,
          brand: formData.brand || undefined,
          category: formData.category || undefined,
          storage_location: formData.storage_location || undefined,
          is_hazardous: formData.is_hazardous,
          notes: formData.notes || undefined,
        })
        toast.success('已加入常用货架')
      }

      await refreshCommonShelf()
      setDialogState(null)
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string | ValidationError[] } } }
      const detail = err.response?.data?.detail
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e: ValidationError) => {
          if (e.loc?.[1]) {
            form.setError(e.loc[1] as keyof InventoryFormData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '操作失败'))
    } finally {
      setIsSubmitting(false)
    }
  })

  const handleDeleteClick = useCallback(async () => {
    if (!editingItem) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    try {
      await commonShelfAPI.deleteGroup(editingItem.sample_inventory_id)
      toast.success('常用货架分组已删除')
      setDialogState(null)
      await refreshCommonShelf()
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(normalizeApiErrorMessage(err.response?.data?.detail, '删除失败'))
    }
  }, [deleteConfirm, editingItem, refreshCommonShelf, setDialogState])

  const formFields = useMemo(() => {
    const fields = getInventoryFormFields(false, undefined, {
      categoryOptions: COMMON_SHELF_CATEGORY_OPTIONS,
      brandOptions: COMMON_SHELF_BRAND_OPTIONS,
      includeRunningShort: dialogState === 'edit',
    })
    return fields.map(field => {
      if (dialogState === 'edit' && field.name === 'quantity_bottles') {
        return { ...field, hidden: true }
      }
      if (dialogState === 'add' && field.name === 'cas_number') {
        return {
          ...field,
          prefixButton: {
            onClick: handleCasLookup,
            loading: isCasLookupLoading,
            title: '识别 CAS 号',
            icon: ScanSearch,
          },
        }
      }
      return field
    })
  }, [dialogState, handleCasLookup, isCasLookupLoading])

  const columns = useMemo(() => {
    const actionColumn = createCommonShelfActionColumn()

    const baseColumns = getCommonShelfTableColumns()

    return [...baseColumns, actionColumn] as unknown as ColumnDef<Record<string, unknown>, unknown>[]
  }, [])

  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as CommonShelfItem
    return (
      <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
        <div className="hidden md:block shrink-0">
          <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 flex-1">
          <div>英文名称：{item.english_name || '-'}</div>
          <div>别名：{item.alias || '-'}</div>
          <div>分类：{item.category || '-'}</div>
          <div>品牌：{item.brand || '-'}</div>
          <div>创建人：{item.created_by_name || '-'}</div>
          <div>入库时间：{formatDate(item.created_at)}</div>
          <div>可用/总计：{item.available_bottles} / {item.total_bottles} 瓶</div>
          <div>已耗尽：{item.consumed_bottles} 瓶</div>
          <NoteDisplay label="备注" text={item.notes ?? undefined} />
        </div>
      </div>
    )
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">常用货架</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动添加
          </Button>
          <Button variant="modern" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>

      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState(null)
            setDeleteConfirm(false)
            form.reset(defaultInventoryValues)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑常用货架分组' : '手动加入常用货架'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <BaseForm
              form={form}
              fields={formFields}
            />
            <EditDialogActions
              mode={dialogState ?? 'add'}
              onCancel={() => setDialogState(null)}
              onDelete={dialogState === 'edit' && editingItem ? handleDeleteClick : undefined}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存分组"
              submitLabelAdd="确认添加"
              isSubmitting={isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>

      <FilterTable
        api={commonShelfAPI as FilterAPI}
        queryKey={['common-shelf']}
        tableId="common-shelf-table"
        customColumns={columns}
        onEdit={handleEditClick}
        onBorrowSuccess={refreshCommonShelf}
        statusOptions={STATUS_OPTIONS}
        searchFieldOptions={SEARCH_FIELD_OPTIONS}
        title={<><Archive className="w-5 h-5" /> 常用/公用试剂</>}
        searchPlaceholder="搜索名称、CAS号、品牌..."
        renderExpandedRow={renderExpandedRow}
        noteField="notes"
      />
    </div>
  )
}

const CommonShelfActionButtons = React.memo(function CommonShelfActionButtons({
  item,
  onEdit,
  onConsumeSuccess,
}: {
  item: CommonShelfItem
  onEdit: (item: CommonShelfItem) => void
  onConsumeSuccess: () => void | Promise<void>
}) {
  const actions = useMemo(() => {
    return [
      {
        id: 'consume',
        label: '拿一瓶',
        confirm: true,
        confirmLabel: '确认',
        showWhen: (currentItem: CommonShelfItem) => currentItem.available_bottles > 0,
        onClick: async (currentItem: CommonShelfItem) => {
          try {
            await commonShelfAPI.consumeOne(currentItem.sample_inventory_id)
            await onConsumeSuccess()
            toast.success('已记录拿取 1 瓶')
          } catch (error) {
            const err = error as { response?: { data?: { detail?: string } } }
            toast.error(normalizeApiErrorMessage(err.response?.data?.detail, '拿取失败'))
            throw error
          }
        },
      },
    ]
  }, [onConsumeSuccess])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
      statusField="status"
    />
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit) return false
  if (prevProps.onConsumeSuccess !== nextProps.onConsumeSuccess) return false

  const prevItem = prevProps.item as unknown as Record<string, unknown>
  const nextItem = nextProps.item as unknown as Record<string, unknown>
  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
