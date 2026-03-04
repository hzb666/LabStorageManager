// Inventory.tsx
/**
 * 库存管理页面
 * 功能：库存列表展示、搜索筛选、手动入库、编辑、删除、借用、导出
 */
import React, { useState, useMemo, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/components/ui/Toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'
import { TableActionButtonsMemo } from '@/components/ui/TableActionButtons'
import { FilterTable } from '@/components/ui/FilterTable'
import { NoteDisplay } from '@/components/ui/NoteDisplay'

// 工具与API
import { inventoryAPI } from '@/api/client'
import { formatDate } from '@/lib/utils'
import { InventoryFormSchema, parseSpecification } from '@/lib/validationSchemas'
import type { InventoryFormData } from '@/lib/validationSchemas'
import { getInventoryTableColumns } from '@/lib/tableConfigs'

// 表单配置
import { defaultInventoryValues, getInventoryFormFields } from '@/lib/formConfigs'

// 图标
import {
  ArrowUpFromLine,
  Plus,
  Trash2,
  Package
} from 'lucide-react'

// ============================================================================
// 类型扩展与定义
// ============================================================================

interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

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
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
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

  // 刷新库存数据
  const loadInventory = useCallback(async () => {
    // 使缓存失效，后端已清除服务器缓存，会获取最新数据
    console.log('🔄 开始刷新数据')
    await queryClient.invalidateQueries({ queryKey: ['inventory'] })
    console.log('✅ 刷新完成')
  }, [queryClient])

  // ---------------------------------------------------------------------------
  // 表单逻辑
  // ---------------------------------------------------------------------------
  const form = useForm<InventoryFormData>({
    resolver: valibotResolver(InventoryFormSchema),
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
      initial_quantity: item.initial_quantity,
      remaining_quantity: item.remaining_quantity,
      is_hazardous: item.is_hazardous || false,
      notes: item.notes || ''
    })
    setDialogState('edit')
  }, [setDialogState, form])

  const handleFormSubmit = form.handleSubmit(
    async (formData) => {
      console.log('✅ 表单验证通过，提交数据:', formData)

      if (dialogState === 'edit' && editingItem) {
        const remainingVal = formData.remaining_quantity
        const remaining = typeof remainingVal === 'number' ? remainingVal : (remainingVal === '' ? 0 : parseFloat(String(remainingVal)) || 0)

        let initial = editingItem.initial_quantity
        if (formData.specification) {
          const specValue = parseSpecification(formData.specification)
          if (specValue !== null) {
            initial = specValue
          }
        }

        if (isNaN(remaining)) {
          form.setError('remaining_quantity', { message: '剩余量必须是有效数字' })
          return
        }
        if (remaining > initial) {
          form.setError('remaining_quantity', { message: `剩余量不能超过规格 (${initial})` })
          return
        }
      }

      setIsSubmitting(true)
      try {
        if (dialogState === 'edit' && editingItem) {
          const status = formData.remaining_quantity === 0 ? 'consumed' : 'in_stock'
          await inventoryAPI.update(editingItem.id, {
            name: formData.name || '',
            english_name: formData.english_name || '',
            category: formData.category || '',
            storage_location: formData.storage_location || '',
            remaining_quantity: formData.remaining_quantity,
            brand: formData.brand || '',
            status: status,
            is_hazardous: formData.is_hazardous,
            notes: formData.notes || ''
          })
          await loadInventory()
          toast.success('库存信息已更新')
        } else if (dialogState === 'add') {
          const spec = formData.specification as string
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
            notes: formData.notes || ''
          })
        }
        await loadInventory()
        if (dialogState === 'add') {
          toast.success('手动入库成功！')
        }
        setDialogState(null)
      } catch (err) {
        const error = err as { response?: { data?: { detail?: string | ValidationError[] | unknown } } }
        const errorDetail = error.response?.data?.detail
        if (dialogState === 'add' && Array.isArray(errorDetail)) {
          errorDetail.forEach((e: ValidationError) => {
            if (e.loc && e.loc[1]) form.setError(e.loc[1] as keyof InventoryFormData, { message: e.msg || '验证错误' })
          })
        } else {
          toast.error(typeof errorDetail === 'string' ? errorDetail : '操作失败')
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    (errors) => {
      console.log('❌ 表单验证失败:', errors)
    }
  )

  const handleDeleteClick = async () => {
    if (!editingItem) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
    } else {
      try {
        await inventoryAPI.delete(editingItem.id)
        setDialogState(null)
        await loadInventory()
        toast.success('库存已删除')
      } catch (error) {
        const err = error as { response?: { data?: { detail?: string } } }
        toast.error(err.response?.data?.detail || '删除失败')
      }
    }
  }

  const handleExport = useCallback(async () => {
    try {
      const response = await inventoryAPI.exportInventory()
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }, [])

  // ---------------------------------------------------------------------------
  // 表格列配置
  // ---------------------------------------------------------------------------
  const columns = useMemo(() => {
    // 获取抽离的基础列配置
    const baseColumns = getInventoryTableColumns() as any[]

    // 追加页面特定的操作列
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      minSize: 120,
      maxSize: 150,
      cell: info => {
        const meta = info.table.options.meta as any
        return (
          <ActionButtons
            item={{ ...(info.row.original as unknown as InventoryItem) }}
            onEdit={meta?.onEdit}
            onBorrowSuccess={meta?.onBorrowSuccess}
          />
        )
      },
    })

    return [...baseColumns, actionColumn]
  }, [])

  // ---------------------------------------------------------------------------
  // 渲染相关回调
  // ---------------------------------------------------------------------------

  // 🚀 性能优化：将内联函数提取为稳定的回调，防止穿透导致表格行全部重渲染
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as InventoryItem
    return (
      <div className="p-3 flex flex-col md:flex-row gap-4 border-b-1 border-border">
        {/* 左侧：分子结构式 - 桌面端显示，移动端隐藏 */}
        <div className="hidden md:block flex-shrink-0">
          <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
        </div>
        {/* 右侧：信息网格 */}
        <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
          <div>英文名称：{item.english_name || '-'}</div>
          <div>别名：{item.alias || '-'}</div>
          <div>入库时间：{formatDate(item.created_at)}</div>
          <div>入库用户：{item.created_by_name || '-'}</div>
          <div>上次借用：{item.borrower_name ? `${item.borrower_name} (未归还)` : (item.last_borrower_name ? `${item.last_borrower_name} (已归还)` : '-')}</div>
          <NoteDisplay label="备注" text={item.notes} />
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
          <Button variant="morden" size="lg" onClick={handleExport}>
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
              fields={getInventoryFormFields(dialogState === 'edit', editingItem?.initial_quantity)}
            />
            <div className="flex flex-wrap justify-between items-center gap-3 mt-8">
              {dialogState === 'edit' && editingItem && (
                <div className="flex items-center gap-2 order-1">
                  <Button variant="destructive" size="lg" type="button" onClick={handleDeleteClick}>
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    {deleteConfirm ? '确认删除' : '删除'}
                  </Button>
                  {deleteConfirm && <span className="text-sm text-destructive">再次点击确认删除</span>}
                </div>
              )}
              <div className="flex gap-2 order-2 ml-auto">
                <Button variant="morden" size="lg" type="button" onClick={() => setDialogState(null)}>
                  取消
                </Button>
                <LoadingButton type="submit" size="lg" isLoading={isSubmitting}>
                  {dialogState === 'edit' ? '保存' : '确认入库'}
                </LoadingButton>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 数据表格区域 */}
      <FilterTable
        api={inventoryAPI as any}
        queryKey={['inventory']}
        tableId="inventory-table"
        customColumns={columns as any}
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
  onEdit: (item: Record<string, unknown>) => void;
  onBorrowSuccess: () => void | Promise<void>;
}) {

  const statusDisplay = useMemo(() => {
    return [
      {
        value: 'borrowed',
        label: item.borrower_name ? `${item.borrower_name}借用` : '借用中',
        className: 'text-blue-800 dark:text-blue-200',
        title: item.borrower_name ? `借用者: ${item.borrower_name}` : undefined
      }
    ]
  }, [item.borrower_name])

  const actions = useMemo(() => {
    return [
      {
        id: 'borrow',
        label: '借用',
        confirm: true,
        confirmLabel: '确认',
        showWhen: (currItem: InventoryItem) => currItem.status === 'in_stock',
        onClick: async (currItem: InventoryItem) => {
          try {
            await inventoryAPI.borrow(currItem.id)
            await onBorrowSuccess()
            toast.success('借用成功')
          } catch (error) {
            const err = error as { response?: { status?: number; data?: { detail?: string } } }
            toast[err.response?.status === 409 ? 'warning' : 'error'](
              err.response?.data?.detail || '借用失败'
            )
            throw error
          }
        }
      }
    ]
  }, [onBorrowSuccess])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
      statusField="status"
      statusDisplay={statusDisplay}
    />
  )
}, (prevProps, nextProps) => {
  if (prevProps.onEdit !== nextProps.onEdit || prevProps.onBorrowSuccess !== nextProps.onBorrowSuccess) {
    return false;
  }

  const prevItem = prevProps.item as Record<string, unknown>
  const nextItem = nextProps.item as Record<string, unknown>

  if (prevItem === nextItem) return true

  const prevKeys = Object.keys(prevItem)
  const nextKeys = Object.keys(nextItem)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevItem[key] === nextItem[key])
})