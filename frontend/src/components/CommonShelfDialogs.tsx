import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Loader2, Plus, Save, Trash2 } from 'lucide-react'
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
import type { AutocompleteOption } from '@/components/ui/AutoComplete'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { EditDialogActions } from '@/components/EditDialogActions'
import { FilterTable } from '@/components/ui/FilterTable'
import { Label } from '@/components/ui/Label'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'
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
import { cn, formatDateTime } from '@/lib/utils'

export type CommonShelfDialogMode = 'manual-add' | 'edit' | 'add-bottles' | 'remove-one' | null
type CommonShelfEditMode = 'group' | 'items'

interface CommonShelfEditModeState {
  groupKey: string | null
  selectedMode: CommonShelfEditMode
}

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
    handleCancelDeleteEditItemConfirm: (item: CommonShelfGroupItem) => void
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

// 统一承载弹窗对象摘要，沿用归还弹窗的轻量信息区样式。
function DialogEntitySummary({
  title,
  details,
  detailsClassName,
}: {
  title: ReactNode
  details: ReactNode
  detailsClassName?: string
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      <p className={cn("text-sm text-muted-foreground", detailsClassName)}>{details}</p>
    </div>
  )
}

function DialogHint({ children }: { children: ReactNode }) {
  return <p className="text-base text-muted-foreground">{children}</p>
}

function renderCommonShelfGroupBrandSpec(group: CommonShelfGroup) {
  return `${group.group.brand || '无品牌'} / ${group.group.specification_text}`
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

function getCommonShelfDialogContentClassName(mode: CommonShelfDialogMode) {
  if (mode === 'edit') {
    return 'max-h-[85vh] w-[96vw] max-w-5xl overflow-y-auto'
  }
  if (mode === 'manual-add') {
    return 'max-h-[85vh] w-[92vw] max-w-3xl overflow-y-auto'
  }

  return 'max-h-[85vh] w-[92vw] max-w-lg overflow-y-auto'
}

function renderManualAddDialog(
  dialog: CommonShelfDialogController,
  brandOptions: AutocompleteOption[],
) {
  const { actions, forms, state } = dialog

  return (
    <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitManualAdd)}>
      <BaseForm
        form={forms.manualAddForm}
        fields={getCommonShelfManualAddFormFields({ brandOptions })}
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
      className="px-3 pb-3"
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
        <span>{formatDateTime(item.created_at)}</span>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <BaseForm
            form={form}
            fields={getCommonShelfItemEditFormFields(true)}
            columns={3}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 lg:h-10 lg:w-[4.5rem]">
          <Tooltip>
            <TooltipTrigger asChild>
              <LoadingButton
                type="submit"
                size="sm"
                variant="modern"
                className="h-8 w-8 p-0 text-green-600 hover:bg-green-100 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-950 dark:hover:text-green-300"
                disabled={isSubmitting}
                isLoading={isSubmitting}
                aria-label="保存当前条目"
              >
                <Save className="size-4" />
              </LoadingButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>保存当前条目</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="modern"
                className={cn(
                  'h-8 w-8 p-0',
                  isDeleteConfirm
                    ? 'bg-destructive text-white hover:bg-destructive/70 [&_svg]:text-white dark:bg-destructive dark:hover:bg-destructive/70'
                    : 'text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20',
                )}
                disabled={isSubmitting}
                onClick={() => {
                  itemEdit.handleDeleteEditItem(item).catch(() => undefined)
                }}
                onBlur={() => itemEdit.handleCancelDeleteEditItemConfirm(item)}
                aria-label={isDeleteConfirm ? '确认删除当前条目' : '删除当前条目'}
              >
                {isDeleteConfirm ? <Check className="size-4" /> : <Trash2 className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{isDeleteConfirm ? '确认删除' : '删除当前条目'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </form>
  )
}

function resolveSelectedEditMode(
  editModeState: CommonShelfEditModeState,
  selectedGroupKey: string | null,
): CommonShelfEditMode {
  return editModeState.groupKey === selectedGroupKey ? editModeState.selectedMode : 'group'
}

function resolveRenderedEditMode(
  selectedEditMode: CommonShelfEditMode,
  hasItemsResult: boolean,
): CommonShelfEditMode {
  return selectedEditMode === 'items' && hasItemsResult ? 'items' : 'group'
}

function buildItemEditContent({
  dialog,
  isError,
  items,
}: {
  dialog: CommonShelfDialogController
  isError: boolean
  items?: CommonShelfGroupItem[]
}) {
  if (isError) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        组内条目加载失败
      </div>
    )
  }

  if (items && items.length > 0) {
    return items.map((item, index) => (
      <CommonShelfItemEditRow
        key={item.id}
        item={item}
        index={index}
        dialog={dialog}
      />
    ))
  }

  return (
    <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
      当前分组没有可编辑条目
    </div>
  )
}

function CommonShelfEditDialogContent({
  dialog,
  showDelete,
  brandOptions,
}: {
  dialog: CommonShelfDialogController
  showDelete: boolean
  brandOptions: AutocompleteOption[]
}) {
  const [editModeState, setEditModeState] = useState<CommonShelfEditModeState>({
    groupKey: null,
    selectedMode: 'group',
  })
  const { actions, forms, state } = dialog
  const selectedGroup = state.selectedGroup
  const selectedGroupKey = selectedGroup?.group.group_key ?? null
  const selectedEditMode = resolveSelectedEditMode(editModeState, selectedGroupKey)

  const groupItemsQuery = useQuery({
    queryKey: ['common-shelf-group-items', selectedGroupKey],
    enabled: selectedEditMode === 'items' && Boolean(selectedGroup),
    queryFn: async () => {
      const response = await commonShelfAPI.getGroupItems(selectedGroup!.group.group_key)
      return response.data
    },
  })

  if (!selectedGroup) {
    return null
  }

  const hasItemsResult = groupItemsQuery.data !== undefined || groupItemsQuery.isError
  const renderedEditMode = resolveRenderedEditMode(selectedEditMode, hasItemsResult)
  const itemEditContent = buildItemEditContent({
    dialog,
    isError: groupItemsQuery.isError,
    items: groupItemsQuery.data,
  })
  const isItemModeLoading = selectedEditMode === 'items' && renderedEditMode !== 'items'

  return (
    <div className="space-y-4">
      <DialogEntitySummary
        title={selectedGroup.display.name}
        detailsClassName="text-base"
        details={(
          <>
            CAS: {selectedGroup.group.cas_number} • 品牌: {selectedGroup.group.brand || '无品牌'} • 规格: {selectedGroup.group.specification_text}
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-4">
        <RadioGroup
          className="flex flex-row gap-4"
          value={selectedEditMode}
          onValueChange={(value) => {
            setEditModeState({
              groupKey: selectedGroupKey,
              selectedMode: value as 'group' | 'items',
            })
          }}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="group" id="commonShelfEditMode-group" />
            <Label htmlFor="commonShelfEditMode-group" className="cursor-pointer text-base">
              分组修改
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="items" id="commonShelfEditMode-items" />
            <Label htmlFor="commonShelfEditMode-items" className="cursor-pointer text-base">
              单条修改
            </Label>
          </div>
        </RadioGroup>
        {isItemModeLoading && (
          <span className="inline-flex items-center gap-1.5 text-base text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载中...
          </span>
        )}
      </div>

      {renderedEditMode === 'group' ? (
        <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitEdit)}>
          {state.editNeedsMergeConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              修改后的品牌或规格会与现有分组合并，再次点击保存即可确认合并。
            </div>
          )}
          <BaseForm
            form={forms.editForm}
            fields={getCommonShelfEditFormFields({ brandOptions })}
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
          <div className="hidden gap-3 px-3 text-center text-base font-semibold text-foreground sm:flex">
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-4">
              <div>纯度</div>
              <div>位置</div>
              <div>备注</div>
            </div>
            <div className="hidden shrink-0 lg:block lg:w-[4.5rem]" aria-hidden="true" />
          </div>
          {itemEditContent}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="modern"
              size="lg"
              className="min-w-24"
              onClick={() => actions.handleOpenChange(false)}
            >
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
      <DialogEntitySummary
        title={state.selectedGroup.display.name}
        detailsClassName="text-base"
        details={renderCommonShelfGroupBrandSpec(state.selectedGroup)}
      />
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
  if (!state.selectedGroup) {
    return null
  }

  return (
    <form className="space-y-4" onSubmit={handleDialogSubmit(actions.handleSubmitRemoveOne)}>
      <DialogEntitySummary
        title={state.selectedGroup.display.name}
        detailsClassName="text-base"
        details={renderCommonShelfGroupBrandSpec(state.selectedGroup)}
      />
      <DialogHint>
        将从所选位置删除最早入库的 1 瓶。
      </DialogHint>
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
  brandOptions,
}: {
  dialog: CommonShelfDialogController
  showDelete: boolean
  brandOptions: AutocompleteOption[]
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
      <DialogContent className={getCommonShelfDialogContentClassName(mode)}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        {mode === 'manual-add' && renderManualAddDialog(dialog, brandOptions)}
        {mode === 'edit' && (
          <CommonShelfEditDialogContent
            key={state.selectedGroup?.group.group_key ?? 'empty'}
            dialog={dialog}
            showDelete={showDelete}
            brandOptions={brandOptions}
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
  canWrite,
  onOpenChange,
  onCreate,
  columns,
}: {
  open: boolean
  canWrite: boolean
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
              filterClassName="px-1"
              cardClassName="mx-1"
              toolbarActions={canWrite
                ? (
                  <Button onClick={onCreate} size="lg">
                    <Plus className="mr-1.5 h-4 w-4" />
                    新增 CAS
                  </Button>
                )
                : undefined}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
