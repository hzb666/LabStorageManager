import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Tags } from 'lucide-react'
import { useForm, type UseFormReturn } from 'react-hook-form'

import {
  reagentBrandAPI,
  type ReagentBrandItem,
} from '@/api/client'
import { BaseForm } from '@/components/BaseForm'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { HighlightText } from '@/components/ui/HighlightText'
import { Input } from '@/components/ui/Input'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { TableLoadingState } from '@/components/ui/TableFilters'
import { getReagentBrandFormFields } from '@/lib/formConfigs'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  ReagentBrandSchema,
  applyValidationErrors,
  createValibotResolver,
  extractApiErrorDetail,
  normalizeApiErrorMessage,
  toValidationErrors,
} from '@/lib/validationSchemas'
import type {
  ReagentBrandFormData,
  ReagentBrandFormInputData,
} from '@/lib/validationSchemas'

interface ReagentBrandManagementDialogsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canWrite: boolean
}

interface ReagentBrandEditorDialogProps {
  open: boolean
  editingItem: ReagentBrandItem | null
  form: UseFormReturn<ReagentBrandFormInputData, unknown, ReagentBrandFormData>
  deleteConfirm: boolean
  isDeleting: boolean
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => Promise<void>
  onSubmit: () => Promise<void>
}

const DEFAULT_REAGENT_BRAND_FORM: ReagentBrandFormInputData = {
  name: '',
}

const REAGENT_BRAND_GRID_LIMIT = 500
const REAGENT_BRAND_QUERY_KEY = ['reagent-brands'] as const

function compareReagentBrands(left: ReagentBrandItem, right: ReagentBrandItem): number {
  const leftKey = left.name_pinyin_initials || left.name_pinyin || left.name
  const rightKey = right.name_pinyin_initials || right.name_pinyin || right.name
  return (
    leftKey.localeCompare(rightKey, 'zh-Hans-CN', { numeric: true })
    || left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true })
    || left.id - right.id
  )
}

function useReagentBrandList(open: boolean, searchInput: string) {
  const search = searchInput.trim()
  return useQuery({
    queryKey: [...REAGENT_BRAND_QUERY_KEY, search],
    queryFn: async () => {
      const response = await reagentBrandAPI.list({
        search: search || undefined,
        sort_by: 'name',
        sort_order: 'asc',
        limit: REAGENT_BRAND_GRID_LIMIT,
      })
      return response.data
    },
    enabled: open,
    placeholderData: keepPreviousData,
  })
}

function useReagentBrandTotal(open: boolean) {
  return useQuery({
    queryKey: [...REAGENT_BRAND_QUERY_KEY, 'total'],
    queryFn: async () => {
      const response = await reagentBrandAPI.list({
        sort_by: 'name',
        sort_order: 'asc',
        limit: 1,
      })
      return response.data.total
    },
    enabled: open,
  })
}

function getBrandCountLabel(searchInput: string, matchedTotal: number, total: number): string {
  return searchInput.trim() ? `${matchedTotal}/${total}` : String(total)
}

function buildReagentBrandForm(item: ReagentBrandItem | null): ReagentBrandFormInputData {
  return {
    name: item?.name ?? '',
  }
}

function applyBrandSubmitError(
  detail: unknown,
  form: UseFormReturn<ReagentBrandFormInputData, unknown, ReagentBrandFormData>,
): boolean {
  if (applyValidationErrors(toValidationErrors(detail), (fieldName, message) => {
    form.setError(fieldName as keyof ReagentBrandFormData, { message })
  })) {
    return true
  }

  if (typeof detail === 'string' && /Brand already exists|Brand name is required/i.test(detail)) {
    form.setError('name', { message: normalizeApiErrorMessage(detail, '品牌保存失败') })
    return true
  }

  return false
}

function handleDialogSubmit(submit: () => Promise<void>) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }
}

function ReagentBrandEditorDialog({
  open,
  editingItem,
  form,
  deleteConfirm,
  isDeleting,
  isSubmitting,
  onOpenChange,
  onDelete,
  onSubmit,
}: ReagentBrandEditorDialogProps) {
  const isEdit = Boolean(editingItem)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑品牌' : '新增品牌'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleDialogSubmit(onSubmit)}>
          <BaseForm form={form} fields={getReagentBrandFormFields()} layout="stack" />
          <div className="flex items-center justify-between gap-3 pt-4">
            {isEdit ? (
              <LoadingButton
                type="button"
                variant="destructive"
                size="lg"
                className="min-w-28"
                isLoading={isDeleting}
                disabled={isSubmitting}
                onClick={() => void onDelete()}
              >
                {deleteConfirm ? '确认删除' : '删除'}
              </LoadingButton>
            ) : <span />}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="modern"
                size="lg"
                disabled={isSubmitting || isDeleting}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <LoadingButton
                type="submit"
                size="lg"
                className="min-w-28"
                isLoading={isSubmitting}
                disabled={isDeleting}
              >
                {isEdit ? '保存' : '确认新增'}
              </LoadingButton>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReagentBrandGrid({
  brands,
  canWrite,
  isError,
  isLoading,
  onEdit,
  searchInput,
}: Readonly<{
  brands: ReagentBrandItem[]
  canWrite: boolean
  isError: boolean
  isLoading: boolean
  onEdit: (item: ReagentBrandItem) => void
  searchInput: string
}>) {
  if (isLoading) {
    return <TableLoadingState className="min-h-[18rem]" label="加载品牌" />
  }

  if (isError) {
    return <div className="py-8 text-center text-destructive">品牌加载失败</div>
  }

  const normalizedSearch = searchInput.trim()

  if (brands.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {normalizedSearch ? `未找到匹配"${normalizedSearch}"的品牌` : '暂无品牌'}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {brands.map((brand) => (
        <button
          key={brand.id}
          type="button"
          title={brand.name}
          className={cn(
            'min-h-14 min-w-0 border-b border-r border-border/60 px-4 py-3 text-left text-lg font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            canWrite
              ? 'transition-colors hover:bg-accent hover:text-primary dark:hover:bg-input'
              : 'cursor-default disabled:opacity-100',
          )}
          disabled={!canWrite}
          onClick={() => onEdit(brand)}
        >
          <span className="block truncate">
            <HighlightText text={brand.name} highlight={normalizedSearch} fuzzy />
          </span>
        </button>
      ))}
    </div>
  )
}

function ReagentBrandManagementDialog({
  open,
  canWrite,
  onOpenChange,
  onCreate,
  onEdit,
}: {
  open: boolean
  canWrite: boolean
  onOpenChange: (open: boolean) => void
  onCreate: () => void
  onEdit: (item: ReagentBrandItem) => void
}) {
  const [searchInput, setSearchInput] = useState('')
  const { data, isError, isLoading } = useReagentBrandList(
    open,
    searchInput,
  )
  const { data: brandTotal } = useReagentBrandTotal(open)
  const brands = useMemo(
    () => [...(data?.data ?? [])].sort(compareReagentBrands),
    [data?.data],
  )
  const matchedTotal = data?.total ?? brands.length
  const displayTotal = brandTotal ?? matchedTotal
  const countLabel = getBrandCountLabel(searchInput, matchedTotal, displayTotal)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[82vh] !w-[min(96vw,64rem)] !max-w-none overflow-hidden">
        <div className="flex h-full flex-col gap-4">
          <DialogHeader className="shrink-0">
            <DialogTitle className="mb-0 pr-10">品牌管理</DialogTitle>
            <DialogCloseButton
              aria-label="关闭品牌管理弹窗"
              onClick={() => onOpenChange(false)}
            />
          </DialogHeader>
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
            <Input
              className="h-10 w-full"
              placeholder="搜索品牌..."
              maxLength={100}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {canWrite && (
              <Button className="min-w-32" onClick={onCreate} size="lg">
                <Plus className="mr-1.5 h-4 w-4" />
                新增品牌
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex items-center px-1 pb-5 pt-3">
              <div className="flex items-center gap-2 text-xl font-bold">
                <Tags className="h-5 w-5" />
                品牌列表
                <span className="font-normal text-muted-foreground">
                  ({countLabel})
                </span>
              </div>
            </div>
            <div className="h-[calc(82vh-15rem)] overflow-y-auto border-t border-border/60">
              <ReagentBrandGrid
                brands={brands}
                canWrite={canWrite}
                isError={isError}
                isLoading={isLoading}
                onEdit={onEdit}
                searchInput={searchInput}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReagentBrandManagementDialogs({
  open,
  onOpenChange,
  canWrite,
}: ReagentBrandManagementDialogsProps) {
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ReagentBrandItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ReagentBrandFormInputData, unknown, ReagentBrandFormData>({
    resolver: createValibotResolver(ReagentBrandSchema),
    defaultValues: DEFAULT_REAGENT_BRAND_FORM,
  })

  const refreshBrands = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: REAGENT_BRAND_QUERY_KEY })
  }, [queryClient])

  const resetEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(DEFAULT_REAGENT_BRAND_FORM)
  }, [form])

  const openCreateDialog = useCallback(() => {
    if (!canWrite) {
      return
    }

    setEditingItem(null)
    setDeleteConfirm(false)
    form.reset(DEFAULT_REAGENT_BRAND_FORM)
    setEditorOpen(true)
  }, [canWrite, form])

  const openEditDialog = useCallback((item: ReagentBrandItem) => {
    if (!canWrite) {
      return
    }

    setEditingItem(item)
    setDeleteConfirm(false)
    form.reset(buildReagentBrandForm(item))
    setEditorOpen(true)
  }, [canWrite, form])

  const handleDeleteCurrent = useCallback(async () => {
    if (!canWrite) {
      return
    }
    if (!editingItem) {
      return
    }
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }

    setIsDeleting(true)
    try {
      await reagentBrandAPI.delete(editingItem.id)
      await refreshBrands()
      toast.success('品牌已删除')
      resetEditor()
    } catch (error) {
      toast.error(normalizeApiErrorMessage(extractApiErrorDetail(error), '删除失败'))
    } finally {
      setIsDeleting(false)
    }
  }, [canWrite, deleteConfirm, editingItem, refreshBrands, resetEditor])

  const handleSubmit = useCallback(async () => {
    if (!canWrite) {
      return
    }

    await form.handleSubmit(async (data) => {
      setIsSubmitting(true)
      try {
        if (editingItem) {
          await reagentBrandAPI.update(editingItem.id, { name: data.name })
          toast.success('品牌已更新')
        } else {
          await reagentBrandAPI.create({ name: data.name })
          toast.success('品牌已新增')
        }
        await refreshBrands()
        resetEditor()
      } catch (error) {
        const detail = extractApiErrorDetail(error)
        if (!applyBrandSubmitError(detail, form)) {
          toast.error(normalizeApiErrorMessage(detail, '保存失败'))
        }
      } finally {
        setIsSubmitting(false)
      }
    })()
  }, [canWrite, editingItem, form, refreshBrands, resetEditor])

  return (
    <>
      <ReagentBrandManagementDialog
        open={open}
        canWrite={canWrite}
        onOpenChange={onOpenChange}
        onCreate={openCreateDialog}
        onEdit={openEditDialog}
      />
      <ReagentBrandEditorDialog
        open={editorOpen}
        editingItem={editingItem}
        form={form}
        deleteConfirm={deleteConfirm}
        isDeleting={isDeleting}
        isSubmitting={isSubmitting}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            resetEditor()
          }
        }}
        onDelete={handleDeleteCurrent}
        onSubmit={handleSubmit}
      />
    </>
  )
}
