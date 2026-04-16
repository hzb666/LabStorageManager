import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'

import {
  chemicalNameMapAPI,
  commonShelfAPI,
  type ChemicalNameMapItem,
  type CommonShelfGroup,
  type CommonShelfGroupItem,
  type CommonShelfLocationSummary,
} from '@/api/client'
import { BaseForm } from '@/components/BaseForm'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { EditDialogActions } from '@/components/EditDialogActions'
import { FilterTable } from '@/components/ui/FilterTable'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import type { FilterAPI } from '@/hooks/useTableState'
import {
  getChemicalNameMapFormFields,
  getCommonShelfAddBottlesFormFields,
  getCommonShelfEditFormFields,
  getCommonShelfItemEditFormFields,
  getCommonShelfManualAddFormFields,
  getCommonShelfRemoveOneFormFields,
} from '@/lib/formConfigs'
import {
  COMMON_SHELF_EMPTY_LOCATION_VALUE,
} from '@/lib/tableConfigs'
import type {
  ChemicalNameMapFormData,
  ChemicalNameMapFormInputData,
  CommonShelfAddBottlesData,
  CommonShelfAddBottlesInputData,
  CommonShelfGroupEditData,
  CommonShelfGroupEditInputData,
  CommonShelfItemEditRowData,
  CommonShelfItemEditRowInputData,
  CommonShelfManualAddData,
  CommonShelfManualAddInputData,
  CommonShelfRemoveOneData,
  CommonShelfRemoveOneInputData,
} from '@/lib/validationSchemas'
import {
  CommonShelfItemEditRowSchema,
  createValibotResolver,
} from '@/lib/validationSchemas'

export type CommonShelfDialogMode = 'manual-add' | 'edit' | 'add-bottles' | 'remove-one' | null

const CHEMICAL_NAME_MAP_SEARCH_ONLY_OPTIONS = [{ value: 'all', label: '全部' }]

// 常用货架弹窗统一使用分组 controller。
// 页面层只关心 state/forms/actions/itemEdit 四类职责，避免继续平铺几十个字段来回透传。
export interface CommonShelfDialogController {
  state: {
    mode: CommonShelfDialogMode
    selectedGroup: CommonShelfGroup | null
    isSubmitting: boolean
    deleteConfirm: boolean
    editNeedsMergeConfirm: boolean
  }
  forms: {
    manualAddForm: UseFormReturn<CommonShelfManualAddInputData, unknown, CommonShelfManualAddData>
    editForm: UseFormReturn<CommonShelfGroupEditInputData, unknown, CommonShelfGroupEditData>
    addBottlesForm: UseFormReturn<CommonShelfAddBottlesInputData, unknown, CommonShelfAddBottlesData>
    removeOneForm: UseFormReturn<CommonShelfRemoveOneInputData, unknown, CommonShelfRemoveOneData>
  }
  itemEdit: {
    submittingItemId: number | null
    deleteItemConfirmId: number | null
    handleSubmitEditItem: (
      item: CommonShelfGroupItem,
      data: CommonShelfItemEditRowData,
      setFieldError: (fieldName: string, message: string) => void,
    ) => Promise<void>
    handleDeleteEditItem: (item: CommonShelfGroupItem) => Promise<void>
  }
  actions: {
    handleOpenChange: (open: boolean) => void
    handleSubmitManualAdd: () => Promise<void>
    handleSubmitEdit: () => Promise<void>
    handleSubmitAddBottles: () => Promise<void>
    handleSubmitRemoveOne: () => Promise<void>
    handleDelete?: () => Promise<void>
    openManualAddDialog: () => void
    openEditDialog: (item: CommonShelfGroup) => void
    openAddBottlesDialog: (item: CommonShelfGroup) => void
    openRemoveOneDialog: (item: CommonShelfGroup) => void
    resetDialogState: () => void
  }
}

export interface ChemicalNameMapEditorController {
  open: boolean
  editingItem: ChemicalNameMapItem | null
  form: UseFormReturn<ChemicalNameMapFormInputData, unknown, ChemicalNameMapFormData>
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => Promise<void>
}

function renderLocation(location: string | null) {
  return location?.trim() ? location : '未填写位置'
}

function buildLocationOptionValue(location: string | null) {
  return location?.trim() ? location : COMMON_SHELF_EMPTY_LOCATION_VALUE
}

function buildLocationOptions(locations: CommonShelfLocationSummary[] = []) {
  return locations.map((item) => ({
    value: buildLocationOptionValue(item.storage_location),
    label: `${renderLocation(item.storage_location)} (${item.bottle_count} 瓶)`,
  }))
}

function handleDialogSubmit(
  submit: () => Promise<void>,
) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }
}

// 统一承载弹窗里的说明/对象摘要，减少多个模式各自维护相同的卡片样式。
function DialogInfoCard({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
      {children}
    </div>
  )
}

// 通用的取消/提交按钮区。
// 各业务模式只保留自己的字段和文案，不再重复写一整段按钮布局。
function DialogSubmitActions({
  onCancel,
  submitLabel,
  isSubmitting,
}: {
  onCancel: () => void
  submitLabel: string
  isSubmitting: boolean
}) {
  return (
    <div className="flex justify-end gap-2 pt-4">
      <Button type="button" variant="modern" size="lg" className="min-w-24" onClick={onCancel}>
        取消
      </Button>
      <LoadingButton type="submit" size="lg" className="min-w-36" isLoading={isSubmitting}>
        {submitLabel}
      </LoadingButton>
    </div>
  )
}

function getCommonShelfDialogTitle(mode: CommonShelfDialogMode) {
  switch (mode) {
    case 'manual-add':
      return '手动添加常用货架'
    case 'edit':
      return '编辑常用货架分组'
    case 'add-bottles':
      return '新增瓶数'
    case 'remove-one':
      return '扣减 1 瓶'
    default:
      return ''
  }
}

function renderManualAddDialog(dialog: CommonShelfDialogController) {
  const { actions, forms, state } = dialog

  return (
    <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitManualAdd)}>
      <BaseForm
        form={forms.manualAddForm}
        fields={getCommonShelfManualAddFormFields()}
        columns={2}
      />
      <DialogSubmitActions
        onCancel={() => actions.handleOpenChange(false)}
        submitLabel="确认添加"
        isSubmitting={state.isSubmitting}
      />
    </form>
  )
}

function buildCommonShelfItemEditDefaults(item: CommonShelfGroupItem): CommonShelfItemEditRowInputData {
  return {
    id: item.id,
    purity: item.purity || '',
    storage_location: item.storage_location || '',
    notes: item.notes || '',
  }
}

function CommonShelfItemEditRow({
  item,
  index,
  dialog,
}: {
  item: CommonShelfGroupItem
  index: number
  dialog: CommonShelfDialogController
}) {
  const form = useForm<CommonShelfItemEditRowInputData, unknown, CommonShelfItemEditRowData>({
    resolver: createValibotResolver(CommonShelfItemEditRowSchema),
    defaultValues: buildCommonShelfItemEditDefaults(item),
  })
  const { itemEdit } = dialog

  useEffect(() => {
    form.reset(buildCommonShelfItemEditDefaults(item))
  }, [form, item])

  const isSubmitting = itemEdit.submittingItemId === item.id
  const isDeleteConfirm = itemEdit.deleteItemConfirmId === item.id

  return (
    <form
      className="rounded-md border border-border bg-background px-3 py-3"
      onSubmit={handleDialogSubmit(async () => {
        await form.handleSubmit(async (data) => {
          await itemEdit.handleSubmitEditItem(item, data, (fieldName, message) => {
            form.setError(fieldName as keyof CommonShelfItemEditRowData, { message })
          })
        })()
      })}
    >
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>第 {index + 1} 条 · {item.internal_code}</span>
        <span>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <BaseForm
            form={form}
            fields={getCommonShelfItemEditFormFields(true)}
            columns={3}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 lg:pt-7">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            <Save className="mr-1.5 size-4" />
            保存
          </Button>
          <Button
            type="button"
            size="icon"
            variant={isDeleteConfirm ? 'destructive' : 'secondary'}
            disabled={isSubmitting}
            onClick={() => {
              itemEdit.handleDeleteEditItem(item).catch(() => undefined)
            }}
            title={isDeleteConfirm ? '再次点击确认删除' : '删除当前条目'}
          >
            {isDeleteConfirm ? <Check className="size-4" /> : <Trash2 className="size-4" />}
          </Button>
        </div>
      </div>
    </form>
  )
}

function CommonShelfEditDialogContent({
  dialog,
  showDelete,
}: {
  dialog: CommonShelfDialogController
  showDelete: boolean
}) {
  const [editMode, setEditMode] = useState<'group' | 'items'>('group')
  const { actions, forms, state } = dialog
  const selectedGroup = state.selectedGroup

  const groupItemsQuery = useQuery({
    queryKey: ['common-shelf-group-items', selectedGroup?.group.group_key],
    enabled: editMode === 'items' && Boolean(selectedGroup),
    queryFn: async () => {
      const response = await commonShelfAPI.getGroupItems(selectedGroup!.group.group_key)
      return response.data
    },
  })

  if (!selectedGroup) {
    return null
  }

  let itemEditContent: React.ReactNode
  if (groupItemsQuery.isLoading) {
    itemEditContent = (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        正在加载组内条目...
      </div>
    )
  } else if (groupItemsQuery.data && groupItemsQuery.data.length > 0) {
    itemEditContent = groupItemsQuery.data.map((item, index) => (
      <CommonShelfItemEditRow
        key={item.id}
        item={item}
        index={index}
        dialog={dialog}
      />
    ))
  } else {
    itemEditContent = (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        当前分组没有可编辑条目
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DialogInfoCard>
        <div>CAS：{selectedGroup.group.cas_number}</div>
        <div>名称：{selectedGroup.display.name}</div>
        <div>品牌：{selectedGroup.group.brand || '无品牌'}</div>
        <div>规格：{selectedGroup.group.specification_text}</div>
      </DialogInfoCard>

      <div className="rounded-md border border-border px-3 py-3">
        <RadioGroup
          className="grid gap-3 sm:grid-cols-2"
          value={editMode}
          onValueChange={(value) => setEditMode(value as 'group' | 'items')}
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="group" />
            <div className="space-y-1">
              <div className="text-sm font-medium">分组修改</div>
              <div className="text-xs text-muted-foreground">只修改品牌和规格</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2">
            <RadioGroupItem value="items" />
            <div className="space-y-1">
              <div className="text-sm font-medium">条目修改</div>
              <div className="text-xs text-muted-foreground">逐条修改纯度、位置、备注</div>
            </div>
          </label>
        </RadioGroup>
      </div>

      {editMode === 'group' ? (
        <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitEdit)}>
          {state.editNeedsMergeConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              修改后的品牌或规格会与现有分组合并，再次点击保存即可确认合并。
            </div>
          )}
          <BaseForm
            form={forms.editForm}
            fields={getCommonShelfEditFormFields()}
            columns={2}
          />
          <EditDialogActions
            mode="edit"
            onCancel={() => actions.handleOpenChange(false)}
            onDelete={showDelete ? actions.handleDelete : undefined}
            deleteConfirm={state.deleteConfirm}
            submitLabelEdit={state.editNeedsMergeConfirm ? '确认合并并保存' : '保存分组'}
            submitLabelAdd="保存分组"
            isSubmitting={state.isSubmitting}
          />
        </form>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4 px-3 text-sm font-medium text-muted-foreground">
            <div>纯度</div>
            <div>位置</div>
            <div>备注</div>
          </div>
          {itemEditContent}
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => actions.handleOpenChange(false)}>
              关闭
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function renderAddBottlesDialog(
  dialog: CommonShelfDialogController,
  locationSuggestions: string[],
) {
  const { actions, forms, state } = dialog
  if (!state.selectedGroup) {
    return null
  }

  return (
    <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitAddBottles)}>
      <DialogInfoCard>
        <div>{state.selectedGroup.display.name}</div>
        <div className="text-muted-foreground">
          {state.selectedGroup.group.brand || '无品牌'} / {state.selectedGroup.group.specification_text}
        </div>
      </DialogInfoCard>
      <BaseForm
        form={forms.addBottlesForm}
        fields={getCommonShelfAddBottlesFormFields(locationSuggestions)}
        layout="stack"
      />
      <DialogSubmitActions
        onCancel={() => actions.handleOpenChange(false)}
        submitLabel="确认加瓶"
        isSubmitting={state.isSubmitting}
      />
    </form>
  )
}

function renderRemoveOneDialog(
  dialog: CommonShelfDialogController,
  locationOptions: Array<{ value: string; label: string }>,
) {
  const { actions, forms, state } = dialog

  return (
    <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitRemoveOne)}>
      <DialogInfoCard>
        将从所选位置删除最早入库的 1 瓶。
      </DialogInfoCard>
      <BaseForm
        form={forms.removeOneForm}
        fields={getCommonShelfRemoveOneFormFields(locationOptions)}
        layout="stack"
      />
      <DialogSubmitActions
        onCancel={() => actions.handleOpenChange(false)}
        submitLabel="确认扣减"
        isSubmitting={state.isSubmitting}
      />
    </form>
  )
}

export function CommonShelfDialogs({
  dialog,
  showDelete,
}: {
  dialog: CommonShelfDialogController
  showDelete: boolean
}) {
  const { actions, state } = dialog
  const { mode, selectedGroup } = state
  const locationSuggestionsQuery = useQuery({
    queryKey: ['common-shelf-location-suggestions', selectedGroup?.group.group_key],
    // 位置建议只服务“加瓶”，避免编辑/删除弹窗也触发同一组位置查询。
    enabled: mode === 'add-bottles' && Boolean(selectedGroup),
    queryFn: async () => {
      const response = await commonShelfAPI.getLocationSuggestions(selectedGroup!.group.group_key)
      return response.data
    },
  })
  const removeLocationsQuery = useQuery({
    queryKey: ['common-shelf-remove-locations', selectedGroup?.group.group_key],
    // “扣减1瓶”需要精确到位置和先后顺序，因此单独拉完整位置统计，而不是复用建议列表。
    enabled: mode === 'remove-one' && Boolean(selectedGroup),
    queryFn: async () => {
      const response = await commonShelfAPI.getLocations(selectedGroup!.group.group_key)
      return response.data
    },
  })

  const dialogTitle = getCommonShelfDialogTitle(mode)
  const locationSuggestions = locationSuggestionsQuery.data ?? []
  const locationOptions = buildLocationOptions(removeLocationsQuery.data)

  return (
    <Dialog open={mode !== null} onOpenChange={actions.handleOpenChange}>
      <DialogContent className="max-h-[85vh] w-[96vw] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        {mode === 'manual-add' && renderManualAddDialog(dialog)}
        {mode === 'edit' && (
          <CommonShelfEditDialogContent
            key={state.selectedGroup?.group.group_key ?? 'empty'}
            dialog={dialog}
            showDelete={showDelete}
          />
        )}
        {mode === 'add-bottles' && renderAddBottlesDialog(dialog, locationSuggestions)}
        {mode === 'remove-one' && renderRemoveOneDialog(dialog, locationOptions)}
      </DialogContent>
    </Dialog>
  )
}

export function ChemicalNameMapEditorDialog({
  dialog,
}: {
  dialog: ChemicalNameMapEditorController
}) {
  const isEdit = Boolean(dialog.editingItem)

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogContent className="w-[92vw] max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 CAS 主数据' : '新增 CAS 主数据'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleDialogSubmit(dialog.onSubmit)}>
          <BaseForm
            form={dialog.form}
            fields={getChemicalNameMapFormFields(isEdit)}
            columns={2}
          />
          <DialogSubmitActions
            onCancel={() => dialog.onOpenChange(false)}
            submitLabel={isEdit ? '保存' : '确认新增'}
            isSubmitting={dialog.isSubmitting}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ChemicalNameMapManagementDialog({
  open,
  onOpenChange,
  onCreate,
  columns,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: () => void
  columns: ColumnDef<Record<string, unknown>, unknown>[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[85vh] w-[98vw] min-w-[min(98vw,72rem)] max-w-[92rem] overflow-hidden md:w-[92vw]">
        <div className="flex h-full flex-col gap-4">
          <DialogHeader className="shrink-0">
            <DialogTitle className="mb-0">CAS 主数据管理</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FilterTable
              api={chemicalNameMapAPI as FilterAPI}
              queryKey={['chemical-name-map']}
              tableId="chemical-name-map-table"
              customColumns={columns}
              statusOptions={[]}
              searchFieldOptions={CHEMICAL_NAME_MAP_SEARCH_ONLY_OPTIONS}
              showFuzzySearch={false}
              enableExpandAll={false}
              searchPlaceholder="搜索 CAS、名称、别名..."
              scrollHeight="calc(85vh - 17rem)"
              title="CAS 主数据"
              cardClassName="mx-1"
              toolbarActions={(
                <Button onClick={onCreate} size="lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  新增 CAS
                </Button>
              )}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
