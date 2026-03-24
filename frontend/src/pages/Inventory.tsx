// Inventory.tsx
/**
 * 库存管理页面
 * 功能：库存列表展示、搜索筛选、手动入库、编辑、删除、借用、导出
 */
import React, { useState, useMemo, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/lib/toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import { BorrowDialog } from '@/components/BorrowDialog'
import { EditDialogActions } from '@/components/EditDialogActions'
import useDialogState from '@/hooks/useDialogState'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'
import { FilterTable } from '@/components/ui/FilterTable'
import { NoteDisplay } from '@/components/ui/NoteDisplay'
import type { FilterAPI } from '@/hooks/useTableState'

// 工具与API
import { inventoryAPI, chemicalAPI } from '@/api/client'
import { downloadBlobResponse, formatDate, processNotes } from '@/lib/utils'
import {
  InventoryFormSchema,
  parseSpecification,
  createValibotResolver,
  validateAndNormalizeCASInput,
  extractApiErrorDetail,
  getApiErrorMessage,
  isSpecialCasValue,
  toValidationErrors,
  normalizeApiErrorMessage,
} from '@/lib/validationSchemas'
import type { InventoryFormData, InventoryFormInputData, ValidationError } from '@/lib/validationSchemas'
import { getInventoryTableColumns } from '@/lib/tableConfigs'
import { UserRoles } from '@/lib/constants'
import { useAuthStore } from '@/store/useStore'

// 表单配置
import { defaultInventoryValues, getInventoryFormFields } from '@/lib/formConfigs'

// 图标
import {
  ArrowUpFromLine,
  Plus,
  Package,
  ScanSearch
} from 'lucide-react'

// ============================================================================
// 类型扩展与定义
// ============================================================================

export interface InventoryItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number
  remaining_quantity: number
  remaining_percent?: number | null
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
  temporary_keeper_id?: number | null
  temporary_keeper_name?: string | null
  borrower_id?: number | null
  borrower_name?: string | null
  last_borrower_id?: number | null
  last_borrower_name?: string | null
}

const columnHelper = createColumnHelper<InventoryItem>()

// ============================================================================
// 主组件
// ============================================================================

export function InventoryPage() {
  const queryClient = useQueryClient()

  // ---------------------------------------------------------------------------
  // 状态管理
  // ---------------------------------------------------------------------------
  const [dialogState, setDialogState] = useDialogState<"edit" | "add">()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCasLookupLoading, setIsCasLookupLoading] = useState(false)

  // 刷新库存数据
  const loadInventory = useCallback(async () => {
    // 使缓存失效，后端已清除服务器缓存，会获取最新数据
    await queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }, [queryClient])

  // ---------------------------------------------------------------------------
  // 表单逻辑
  // ---------------------------------------------------------------------------
  const form = useForm<InventoryFormInputData, unknown, InventoryFormData>({
    resolver: createValibotResolver(InventoryFormSchema),
    defaultValues: defaultInventoryValues,
    shouldFocusError: false,
  })

  const handleAddClick = useCallback(() => {
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(defaultInventoryValues)
    setDialogState('add')
  }, [form, setDialogState])

  const handleEditClick = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    setEditingItem(item)
    setDeleteConfirm(false)
    // 区分 null 和 0：null 显示为空让用户填写，0 显示为 "0"
    const remainingQty = item.remaining_quantity
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
      // null → undefined（显示为空），0 → 0（显示为"0"）
      remaining_quantity: remainingQty === null ? undefined : (remainingQty ?? 0),
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [setDialogState, form])

  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      // 编辑模式：remaining_quantity 额外验证（Schema 中是可选的）
      if (dialogState === 'edit' && editingItem) {
        const remaining = formData.remaining_quantity

        let initial = editingItem.initial_quantity
        if (formData.specification) {
          const specValue = parseSpecification(formData.specification)
          if (specValue !== null) {
            initial = specValue
          }
        }

        // 验证剩余量不超过初始量
        if (remaining !== undefined && remaining !== null && remaining > initial) {
          form.setError('remaining_quantity', { message: `剩余量不能超过规格 (${initial})` })
          return
        }
      }

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          // 直接传递 specification 字符串，后端使用 parse_specification 解析
          // 使用 processNotes 处理备注：如果只有标签前缀但没有内容，则返回空字符串
          await inventoryAPI.update(editingItem.id, {
            name: formData.name || '',
            cas_number: formData.cas_number || '',
            english_name: formData.english_name || '',
            alias: formData.alias || '',
            category: formData.category || '',
            storage_location: formData.storage_location || '',
            remaining_quantity: formData.remaining_quantity,
            brand: formData.brand || '',
            is_hazardous: formData.is_hazardous,
            notes: processNotes(formData.notes),
            specification: formData.specification || ''
          })
          await loadInventory()
          toast.success('库存信息已更新')
        } else if (dialogState === 'add') {
          const spec = formData.specification || ''
          const bottles = formData.quantity_bottles as number
          await inventoryAPI.manualAdd({
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
            notes: processNotes(formData.notes)
          })
        }
        await loadInventory()
        if (dialogState === 'add') {
          toast.success('手动入库成功！')
        }
        setDialogState(null)
      } catch (err) {
        const errorDetail = extractApiErrorDetail(err)
        const validationErrors = toValidationErrors(errorDetail)
        if (validationErrors.length > 0) {
          validationErrors.forEach((e: ValidationError) => {
            if (e.loc?.[1]) {
              form.setError(e.loc[1] as keyof InventoryFormData, { message: e.msg || '输入不合法' })
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
      // 编辑模式下：即使 Schema 验证失败，也手动检查 remaining_quantity 是否填写
      if (dialogState === 'edit' && editingItem) {
        const remainingValue = form.getValues('remaining_quantity')
        if (remainingValue === undefined || remainingValue === null) {
          // 只有当还没有 remaining_quantity 错误时才设置
          if (!errors.remaining_quantity) {
            form.setError('remaining_quantity', { message: '剩余数量不能为空' })
          }
        }
      }
    }
  )

  const handleDeleteClick = async () => {
    if (!editingItem) return
    if (deleteConfirm) {
      try {
        await inventoryAPI.delete(editingItem.id)
        setDialogState(null)
        await loadInventory()
        toast.success('库存已删除')
      } catch (error) {
        toast.error(getApiErrorMessage(error, '删除失败'))
      }
    } else {
      setDeleteConfirm(true)
    }
  }

  const handleExport = useCallback(async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      downloadBlobResponse(response, `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // CAS 号自动识别回调
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
      const detail = extractApiErrorDetail(error)
      if (typeof detail === 'string') {
        form.setError('cas_number', { message: normalizeApiErrorMessage(detail, 'CAS 号识别失败') })
      } else {
        toast.error('CAS 号识别失败')
      }
    } finally {
      setIsCasLookupLoading(false)
    }
  }, [form])

  // ---------------------------------------------------------------------------
  // 表格列配置
  // ---------------------------------------------------------------------------
  const columns = useMemo(() => {
    // 获取抽离的基础列配置
    const baseColumns = getInventoryTableColumns()

    // 追加页面特定的操作列
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      minSize: 120,
      maxSize: 150,
      cell: info => {
        const meta = info.table.options.meta
        return (
          <ActionButtons
            item={{ ...(info.row.original as unknown as InventoryItem) }}
            onEdit={meta?.onEdit as (item: InventoryItem) => void}
            onBorrowSuccess={meta?.onBorrowSuccess as () => void}
          />
        )
      },
    })

    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [])

  // ---------------------------------------------------------------------------
  // 渲染相关回调
  // ---------------------------------------------------------------------------

  // 🚀 性能优化：将内联函数提取为稳定的回调，防止穿透导致表格行全部重渲染
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    return (
      <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
        {/* 左侧：分子结构式 - 桌面端显示，移动端隐藏 */}
        <div className="hidden md:block shrink-0">
          <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
        </div>
        {/* 右侧：信息网格 */}
        <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
          <div>英文名称：{item.english_name || '-'}</div>
          <div>别名：{item.alias || '-'}</div>
          <div>入库时间：{formatDate(item.created_at)}</div>
          <div>入库用户：{item.created_by_name || '-'}</div>
          <div>上次借用：{item.borrower_name ? `${item.borrower_name} (未归还)` : (item.last_borrower_name ? `${item.last_borrower_name} (已归还)` : '-')}</div>
          <NoteDisplay label="备注" text={item.notes ?? undefined} />
        </div>
      </div>
    )
  }, [])

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">库存管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleAddClick} size="lg">
            <Plus className="w-4 h-4 mr-1.5" /> 手动入库
          </Button>
          <Button variant="modern" size="lg" onClick={handleExport}>
            <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
          </Button>
        </div>
      </div>

      {/* 统一复用弹窗（新增 & 编辑） */}
      <Dialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogState(null); form.reset(); setDeleteConfirm(false) }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'edit' ? '编辑库存' : '手动入库'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <BaseForm
              form={form}
              fields={useMemo(() => {
                const fields = getInventoryFormFields(dialogState === 'edit', editingItem?.initial_quantity)
                // 为 CAS 号字段添加自动识别按钮（仅在新增模式时显示）
                if (dialogState === 'add') {
                  return fields.map(field => 
                    field.name === 'cas_number' 
                      ? { ...field, prefixButton: { onClick: handleCasLookup, loading: isCasLookupLoading, title: '识别 CAS 号', icon: ScanSearch } }
                      : field
                  )
                }
                return fields
              }, [dialogState, editingItem?.initial_quantity, handleCasLookup, isCasLookupLoading])}
            />
            <EditDialogActions
              mode={dialogState ?? 'add'}
              onCancel={() => setDialogState(null)}
              onDelete={dialogState === 'edit' && editingItem ? handleDeleteClick : undefined}
              deleteConfirm={deleteConfirm}
              submitLabelEdit="保存"
              submitLabelAdd="确认入库"
              isSubmitting={isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <FilterTable
        api={inventoryAPI as FilterAPI}
        queryKey={['inventory']}
        tableId="inventory-table"
        customColumns={columns}
        onEdit={handleEditClick}
        onBorrowSuccess={loadInventory}
        title={<><Package className="w-5 h-5" /> 库存列表</>}
        searchPlaceholder="搜索名称、CAS号、位置..."
        noteField="notes"
        renderExpandedRow={renderExpandedRow}
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
  onBorrowSuccess
}: {
  item: InventoryItem;
  onEdit: (item: InventoryItem) => void;
  onBorrowSuccess: () => void | Promise<void>
}) {
  const currentUser = useAuthStore((state) => state.user)
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC
  const [borrowDialogOpen, setBorrowDialogOpen] = useState(false)
  const [pendingBorrowItem, setPendingBorrowItem] = useState<InventoryItem | null>(null)
  const [isSubmittingBorrow, setIsSubmittingBorrow] = useState(false)

  const executeBorrow = useCallback(async (inventoryId: number, actualBorrowerId?: number) => {
    setIsSubmittingBorrow(true)
    try {
      await inventoryAPI.borrow(
        inventoryId,
        actualBorrowerId ? { actual_borrower_id: actualBorrowerId } : undefined
      )
      await onBorrowSuccess()
      toast.success('借用成功')
      setBorrowDialogOpen(false)
      setPendingBorrowItem(null)
    } catch (error) {
      const maybeStatus = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined
      const message = getApiErrorMessage(error, '借用失败')
      toast[maybeStatus === 409 ? 'warning' : 'error'](message)
      throw error
    } finally {
      setIsSubmittingBorrow(false)
    }
  }, [onBorrowSuccess])

  const statusDisplay = useMemo(() => {
    const statusList = [
      {
        value: 'borrowed',
        label: item.borrower_name ? `${item.borrower_name}借用` : '借用中',
        className: 'text-blue-800 dark:text-blue-200',
        title: item.borrower_name ? `借用者: ${item.borrower_name}` : undefined
      }
    ]

    if (item.status === 'in_stock' && !item.storage_location && item.temporary_keeper_name) {
      statusList.push({
        value: 'in_stock',
        label: `${item.temporary_keeper_name}暂存`,
        className: 'text-orange-700 dark:text-orange-300',
        title: `暂存人: ${item.temporary_keeper_name}`
      })
    }

    return statusList
  }, [item.borrower_name, item.status, item.storage_location, item.temporary_keeper_name])

  const actions = useMemo(() => {
    return [
      {
        id: 'borrow',
        label: '借用',
        confirm: true,
        confirmLabel: '确认',
        showWhen: (currItem: InventoryItem) => currItem.status === 'in_stock',
        onClick: async (currItem: InventoryItem) => {
          // 借用前校验：检查规格和剩余量是否填写
          if (!currItem.specification || currItem.specification.trim() === '') {
            toast.warning('请先填写规格才能借用')
            throw new Error('规格未填写')
          }
          if (currItem.remaining_quantity === undefined || currItem.remaining_quantity === null) {
            toast.warning('请先填写剩余量才能借用')
            throw new Error('剩余量未填写')
          }

          if (isPublicUser) {
            setPendingBorrowItem(currItem)
            setBorrowDialogOpen(true)
            return
          }

          await executeBorrow(currItem.id)
        }
      }
    ]
  }, [isPublicUser, executeBorrow])

  return (
    <>
      <TableActionButtonsMemo
        item={item}
        actions={actions}
        showEdit={true}
        onEdit={onEdit}
        statusField="status"
        statusDisplay={statusDisplay}
      />
      <BorrowDialog
        open={borrowDialogOpen}
        onOpenChange={(open) => {
          setBorrowDialogOpen(open)
          if (!open) {
            setPendingBorrowItem(null)
          }
        }}
        isSubmitting={isSubmittingBorrow}
        onConfirm={async (actualBorrowerId) => {
          if (!pendingBorrowItem) return
          await executeBorrow(pendingBorrowItem.id, actualBorrowerId)
        }}
      />
    </>
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit || prevProps.onBorrowSuccess !== nextProps.onBorrowSuccess) {
    return false;
  }

  const prevItem = prevProps.item as unknown as Record<string, unknown>
  const nextItem = nextProps.item as unknown as Record<string, unknown>

  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})
