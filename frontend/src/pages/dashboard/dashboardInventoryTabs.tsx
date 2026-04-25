import React, { useCallback, useMemo, useState } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import * as v from "valibot";
import { AlertTriangle, ArrowRightLeft, Package } from "lucide-react";

import { BaseForm } from "@/components/BaseForm";
import { EditDialogActions } from "@/components/EditDialogActions";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { FilterTable } from "@/components/ui/FilterTable";
import { Label } from "@/components/ui/Label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import MoleculeStructure from "@/components/ui/MoleculeStructure";
import { NoteDisplay } from "@/components/ui/NoteDisplay";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { inventoryAPI, reagentOrderAPI, type StockInPayload } from "@/api/client";
import type { FilterAPI } from "@/hooks/useTableState";
import { defaultReturnValues, defaultStockInValues, getReturnFormFields, getStockInFormFields } from "@/lib/formConfigs";
import { getReagentBrandOptionsQueryOptions } from "@/lib/reagentBrandOptions";
import { INVENTORY_SSE_EVENTS } from "@/lib/sseEvents";
import { toast } from "@/lib/toast";
import { formatDate, formatDateTime, processNotes, toText } from "@/lib/utils";
import {
  ReturnFormSchema,
  StockInFormSchema,
  createRemainingQuantitySchema,
  createReturnQuantitySchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  normalizeApiErrorMessage,
  resolveSpecificationQuantity,
  resolveSpecificationUnit,
  toValidationErrors,
  type ReturnFormData,
  type ReturnFormInputData,
  type StockInFormData,
  type StockInFormInputData,
} from "@/lib/validationSchemas";
import { useAuthStore } from "@/store/useStore";
import {
  ADMIN_BORROW_SEARCH_FIELDS,
  ADMIN_STOCKIN_SEARCH_FIELDS,
  BORROW_SEARCH_FIELDS,
  DASHBOARD_EMPTY_STATUS_OPTIONS,
  buildLocalListData,
  isPendingStockinOverdue,
  requestDashboardCountsRefresh,
  type DashboardParams,
  type MyBorrowItem,
  type PendingStockinItem,
} from "../../lib/dashboardUtils";

type BorrowReturnMode = "used" | "remaining";
type ReturnForm = UseFormReturn<ReturnFormInputData, unknown, ReturnFormData>;

const BorrowDashboardExpandedRow = React.memo(function BorrowDashboardExpandedRow({
  item,
}: Readonly<{ item: MyBorrowItem }>) {
  const [detail, setDetail] = useState<Partial<MyBorrowItem> | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      try {
        const response = await inventoryAPI.get(item.inventory_id);
        // 展开行可能在请求返回前被收起或替换，取消标记用于阻止过期结果回写。
        if (!cancelled) {
          setDetail((response.data ?? {}) as Partial<MyBorrowItem>);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
        }
      }
    };

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [item.inventory_id]);

  const merged = detail ? { ...item, ...detail } : item;
  let lastBorrowText = "-";
  if (merged.borrower_name) {
    lastBorrowText = `${toText(merged.borrower_name)} (未归还)`;
  } else if (merged.last_borrower_name) {
    lastBorrowText = `${toText(merged.last_borrower_name)} (已归还)`;
  }

  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure casNumber={toText(merged.cas_number)} width={150} height={100} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
        <div>英文名称：{toText(merged.english_name) || "-"}</div>
        <div>别名：{toText(merged.alias) || "-"}</div>
        <div>入库时间：{merged.created_at ? formatDate(toText(merged.created_at)) : "-"}</div>
        <div>入库用户：{toText(merged.created_by_name) || "-"}</div>
        <div>上次借用：{lastBorrowText}</div>
        <NoteDisplay label="备注" text={toText(merged.notes) || "-"} />
      </div>
    </div>
  );
});

function getReturnPreviewText(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  returnQuantity: string,
): string | null {
  if (!selectedBorrow || !returnQuantity) {
    return null;
  }

  const quantity = parseFloat(returnQuantity) || 0;
  const formattedQuantity =
    returnMode === "used"
      ? Math.max(0, selectedBorrow.remaining_quantity - quantity).toFixed(2)
      : quantity.toFixed(2);

  return `归还后剩余: ${formattedQuantity} ${selectedBorrow.unit} (原借用时剩余量: ${selectedBorrow.remaining_quantity} ${selectedBorrow.unit})`;
}

function DashboardBorrowReturnDialog({
  dialog,
}: Readonly<{
  dialog: {
    selectedBorrow: MyBorrowItem | null;
    returnMode: BorrowReturnMode;
    returnForm: ReturnForm;
    isSubmittingReturn: boolean;
    onReturnModeChange: (value: BorrowReturnMode) => void;
    onSubmit: () => void;
    onOpenChange: (open: boolean) => void;
  };
}>) {
  const {
    selectedBorrow,
    returnMode,
    returnForm,
    isSubmittingReturn,
    onReturnModeChange,
    onSubmit,
    onOpenChange,
  } = dialog;
  const returnPreviewText = getReturnPreviewText(
    selectedBorrow,
    returnMode,
    String(returnForm.watch("return_quantity") ?? ""),
  );
  const returnFormFields = useMemo(() => getReturnFormFields(
    returnMode,
    selectedBorrow?.remaining_quantity ?? 0,
    selectedBorrow?.unit,
  ), [returnMode, selectedBorrow?.remaining_quantity, selectedBorrow?.unit]);
  const returnQuantityFields = returnFormFields.slice(0, 1);
  const returnNotesFields = returnFormFields.slice(1);

  return (
    <Dialog open={selectedBorrow !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>归还试剂</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p>{selectedBorrow?.name}</p>
            <p className="text-muted-foreground">
              CAS: {selectedBorrow?.cas_number} • 当前剩余 {selectedBorrow?.remaining_quantity} {selectedBorrow?.unit}
            </p>
          </div>

          <div>
            <RadioGroup
              value={returnMode}
              onValueChange={(value) => onReturnModeChange(value as BorrowReturnMode)}
              className="flex flex-row gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="used" id="returnMode-used" />
                <Label htmlFor="returnMode-used" className="cursor-pointer text-base">填写使用量</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="remaining" id="returnMode-remaining" />
                <Label htmlFor="returnMode-remaining" className="cursor-pointer text-base">填写剩余量</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <BaseForm form={returnForm} fields={returnQuantityFields} layout="stack" />
              {returnPreviewText ? (
                <p className="text-sm text-muted-foreground">{returnPreviewText}</p>
              ) : null}
            </div>
            <BaseForm form={returnForm} fields={returnNotesFields} layout="stack" />
          </div>

          <div className="flex gap-3 mt-8">
            <Button
              variant="modern"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              size="lg"
            >
              取消
            </Button>
            <LoadingButton
              onClick={onSubmit}
              isLoading={isSubmittingReturn}
              loadingText="处理中..."
              className="flex-1"
              size="lg"
            >
              确认归还
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildPendingStockinFormValues(
  item: PendingStockinItem,
): StockInFormInputData {
  return {
    name: item.name || "",
    cas_number: item.cas_number || "",
    english_name: item.english_name || "",
    alias: item.alias || "",
    category: item.category || "",
    brand: item.brand || "",
    purity: item.purity || "",
    specification: item.specification || "",
    is_hazardous: Boolean(item.is_hazardous),
    notes: item.notes || "",
    remaining_quantity: item.remaining_quantity ?? "",
    storage_location: "",
  };
}

function buildPendingStockinPayload(
  formData: StockInFormData,
): StockInPayload {
  return {
    name: formData.name,
    english_name: formData.english_name || "",
    alias: formData.alias || "",
    category: formData.category || "",
    brand: formData.brand || "",
    purity: formData.purity || "",
    specification: formData.specification,
    is_hazardous: formData.is_hazardous,
    notes: processNotes(formData.notes),
    storage_location: formData.storage_location,
    remaining_quantity: formData.remaining_quantity,
  };
}

function DashboardStockinDialog({
  dialog,
  brandOptions,
}: Readonly<{
  dialog: {
    selectedStockin: PendingStockinItem | null;
    stockinForm: ReturnType<typeof useForm<StockInFormInputData, unknown, StockInFormData>>;
    stockinLoading: boolean;
    onClose: () => void;
    onSubmit: () => void;
  };
  brandOptions: { label: string; value: string }[];
}>) {
  const {
    selectedStockin,
    stockinForm,
    stockinLoading,
    onClose,
    onSubmit,
  } = dialog;
  const watchedSpecification = useWatch({
    control: stockinForm.control,
    name: "specification",
  });
  const stockinUnit = resolveSpecificationUnit(
    watchedSpecification,
    selectedStockin?.unit,
  );

  return (
    <Dialog
      open={selectedStockin !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !stockinLoading) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>入库</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <BaseForm
            form={stockinForm}
            fields={getStockInFormFields(stockinUnit, undefined, { brandOptions })}
          />

          <EditDialogActions
            mode="add"
            onCancel={onClose}
            submitLabelEdit="确认入库"
            submitLabelAdd="确认入库"
            isSubmitting={stockinLoading}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 仪表盘借用记录 Tab。 */

const borrowColumnHelper = createColumnHelper<MyBorrowItem>()
type BorrowDashboardResponse = {
  data?: MyBorrowItem[]
  overdue_count?: number
}

function getBorrowTableTitle(managementMode: boolean) {
  return (
    <>
      <Package className="w-5 h-5" />
      {managementMode ? '全部借用记录' : '我的借用记录'}
    </>
  )
}

// 借用列表请求一次，再交给 `buildLocalListData` 做前端筛选和分页适配 `FilterTable`。
function createBorrowDashboardAPI(managementMode: boolean): FilterAPI {
  return {
    list: async (params) => {
      const response = managementMode
        ? await inventoryAPI.getAdminBorrows()
        : await inventoryAPI.getMyBorrows()
      const payload = response.data as BorrowDashboardResponse | undefined
      const rows = payload?.data ?? []
      const local = buildLocalListData(
        rows as unknown as Record<string, unknown>[],
        params as DashboardParams,
        ['name', 'cas_number', ...(managementMode ? ['borrower_name'] : [])]
      )
      return { data: local as { data: unknown[]; total: number } }
    },
  }
}

function createBorrowColumns(openReturnModal: (item: MyBorrowItem) => void): ColumnDef<Record<string, unknown>, unknown>[] {
  return [
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
      size: 230,
      cell: (info) => {
        const item = info.row.original as MyBorrowItem
        return (
          <div className="flex items-center gap-2">
            <span>{formatDateTime(info.getValue())}</span>
            {item.is_overdue ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-normal text-destructive"
                title="已超期"
                aria-label="已超期"
              >
                <AlertTriangle className="size-3" />
                超期
              </span>
            ) : null}
          </div>
        )
      },
    }),
    borrowColumnHelper.accessor('borrower_name', {
      header: '借用人',
      size: 120,
      cell: (info) => info.getValue() || '-',
    }),
    borrowColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      cell: (info) => (
        <Button
          size="sm"
          className="h-8 text-sm leading-4"
          onClick={(event) => {
            event.stopPropagation()
            openReturnModal(info.row.original)
          }}
        >
          归还
        </Button>
      ),
    }),
  ] as ColumnDef<Record<string, unknown>, unknown>[]
}

export function DashboardBorrowTab({
  managementMode = false,
}: Readonly<{ managementMode?: boolean }>) {
  const currentUser = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()

  const [selectedBorrow, setSelectedBorrow] = useState<MyBorrowItem | null>(null)
  const [returnMode, setReturnMode] = useState<BorrowReturnMode>('used')
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false)

  const returnForm = useForm<ReturnFormInputData, unknown, ReturnFormData>({
    resolver: createValibotResolver(ReturnFormSchema),
    defaultValues: defaultReturnValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: managementMode ? ['dashboard', 'admin', 'borrows'] : ['dashboard', 'borrows'],
      }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    requestDashboardCountsRefresh()
  }, [managementMode, queryClient])

  const borrowDashboardAPI = useMemo(
    () => createBorrowDashboardAPI(managementMode),
    [managementMode]
  )

  // 每次打开归还弹窗都强制回到 `used` 模式并清空数量输入，避免沿用上一条记录的表单状态。
  const openReturnModal = useCallback((item: MyBorrowItem) => {
    setSelectedBorrow(item)
    setReturnMode('used')
    returnForm.reset({ return_mode: 'used', return_quantity: '', notes: item.notes ?? '' })
  }, [returnForm])

  // 提交时按当前模式校验并换算最终剩余量；成功后失效借用/库存查询并刷新统计卡片。
  const handleReturn = returnForm.handleSubmit(async (formData) => {
    if (!selectedBorrow) return

    const inputValue = formData.return_quantity
    const fieldName = returnMode === 'remaining' ? '剩余量' : '使用量'
    const maxValue = selectedBorrow.remaining_quantity

    const schema = createReturnQuantitySchema(fieldName, maxValue)
    const result = v.safeParse(schema, inputValue)

    if (!result.success) {
      // `used` 和 `remaining` 模式共享输入框，但校验边界不同，错误需要即时切换。
      returnForm.setError('return_quantity', { message: result.issues[0]?.message || '输入无效' })
      return
    }

    const numValue = result.output
    const finalQuantity = returnMode === 'remaining'
      ? numValue
      : maxValue - numValue

    setIsSubmittingReturn(true)
    try {
      await inventoryAPI.return(selectedBorrow.inventory_id, {
        remaining_quantity: finalQuantity,
        notes: formData.notes,
      })
      setSelectedBorrow(null)
      returnForm.reset(defaultReturnValues)
      await refreshTables()
      toast.success('归还成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '归还失败'))
    } finally {
      setIsSubmittingReturn(false)
    }
  }, (errors) => {
    console.log('Form validation errors:', errors)
  })

  // 切换填写模式时清空数量和字段错误，避免把“使用量”的输入带到“剩余量”校验里。
  const handleReturnModeChange = useCallback((value: BorrowReturnMode) => {
    setReturnMode(value)
    returnForm.setError('return_quantity', { message: '' })
    returnForm.resetField('return_quantity')
  }, [returnForm])

  // 关闭弹窗时统一清空选中记录、恢复默认模式并重置表单。
  const handleReturnDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSelectedBorrow(null)
      setReturnMode('used')
      returnForm.reset(defaultReturnValues)
    }
  }, [returnForm])

  const borrowColumns = useMemo(
    () => createBorrowColumns(openReturnModal),
    [openReturnModal]
  )
  const returnDialog = { selectedBorrow, returnMode, returnForm, isSubmittingReturn, onReturnModeChange: handleReturnModeChange, onSubmit: () => void handleReturn(), onOpenChange: handleReturnDialogOpenChange }

  return (
    <>
      <FilterTable
        api={borrowDashboardAPI}
        queryKey={managementMode ? ['dashboard', 'admin', 'borrows'] : ['dashboard', 'borrows']}
        tableId={managementMode ? 'dashboard-admin-borrows' : 'dashboard-borrows'}
        realtime={{
          room: 'inventory',
          eventTypes: INVENTORY_SSE_EVENTS,
          staleOnly: true,
          onRefresh: refreshTables,
          shouldHandleEvent: (event, context) => {
            const payload = event.data as Record<string, unknown>
            const item = payload.item as Record<string, unknown> | undefined
            let itemId: number | null = null
            if (typeof payload.id === 'number') {
              itemId = payload.id
            } else if (typeof item?.id === 'number') {
              itemId = item.id
            }

            if (itemId !== null && context.loadedIds.has(itemId)) {
              return true
            }

            if (managementMode) {
              return true
            }

            if (!item || typeof currentUser?.id !== 'number') {
              return false
            }

            return item.borrower_id === currentUser.id || item.last_borrower_id === currentUser.id
          },
        }}
        customColumns={borrowColumns}
        statusOptions={DASHBOARD_EMPTY_STATUS_OPTIONS}
        searchFieldOptions={managementMode ? ADMIN_BORROW_SEARCH_FIELDS : BORROW_SEARCH_FIELDS}
        searchPlaceholder={managementMode ? '搜索名称、CAS号、借用人...' : '搜索名称、CAS号...'}
        title={getBorrowTableTitle(managementMode)}
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as MyBorrowItem
          return <BorrowDashboardExpandedRow item={item} />
        }}
      />
      <DashboardBorrowReturnDialog dialog={returnDialog} />
    </>
  )
}

/** 仪表盘待入库 Tab。 */

const pendingStockinColumnHelper = createColumnHelper<PendingStockinItem>()

function renderPendingStockinBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-normal text-destructive"
      title="已超时"
      aria-label="已超时"
    >
      <AlertTriangle className="size-3" />
      超时
    </span>
  )
}

function getPendingStockinTableTitle(managementMode: boolean) {
  return (
    <>
      <ArrowRightLeft className="w-5 h-5" />
      {managementMode ? '全部暂存试剂' : '待入库（暂存）'}
    </>
  )
}

// 待入库列表只请求一次接口，再包装成 `FilterTable` 需要的本地搜索和分页结构。
function createPendingStockinDashboardAPI(managementMode: boolean): FilterAPI {
  return {
    list: async (params) => {
      const response = managementMode
        ? await inventoryAPI.getAdminPendingStockin()
        : await inventoryAPI.getPendingStockin()
      const rows = (response.data?.data ?? []) as PendingStockinItem[]
      const local = buildLocalListData(
        rows as unknown as Record<string, unknown>[],
        params as DashboardParams,
        ['name', 'cas_number', ...(managementMode ? ['temporary_keeper_name'] : [])]
      )
      return { data: local as { data: unknown[]; total: number } }
    },
  }
}

function createStockinColumns(
  openStockinModal: (item: PendingStockinItem) => void,
  managementMode: boolean
): ColumnDef<Record<string, unknown>, unknown>[] {
  const columns: ColumnDef<PendingStockinItem, unknown>[] = [
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
      size: 220,
      cell: (info) => {
        const item = info.row.original as PendingStockinItem
        const showOverdue = item.is_overdue ?? isPendingStockinOverdue(item.stockin_time)
        return (
          <div className="flex items-center gap-2">
            <span>{formatDateTime(info.getValue())}</span>
            {showOverdue ? renderPendingStockinBadge() : null}
          </div>
        )
      },
    }),
  ]

  if (managementMode) {
    columns.push(
      pendingStockinColumnHelper.accessor('temporary_keeper_name', {
        header: '暂存人',
        size: 120,
        cell: (info) => info.getValue() || '-',
      }),
    )
  }

  columns.push(
    pendingStockinColumnHelper.display({
      id: 'actions',
      header: '操作',
      size: 140,
      cell: (info) => (
        <Button
          size="sm"
          className="text-sm"
          onClick={() => openStockinModal(info.row.original)}
        >
          入库
        </Button>
      ),
    }),
  )

  return columns as ColumnDef<Record<string, unknown>, unknown>[]
}

// 负责待入库列表本地筛选、入库弹窗状态，以及入库成功后的库存和统计缓存刷新。
export function DashboardStockinTab({
  managementMode = false,
}: Readonly<{ managementMode?: boolean }>) {
  const currentUser = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const { data: brandOptions = [] } = useQuery(getReagentBrandOptionsQueryOptions())

  const [selectedStockin, setSelectedStockin] = useState<PendingStockinItem | null>(null)
  const [stockinLoading, setStockinLoading] = useState(false)

  const stockinForm = useForm<StockInFormInputData, unknown, StockInFormData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  })

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: managementMode ? ['dashboard', 'admin', 'stockin'] : ['dashboard', 'stockin'],
      }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ])
    requestDashboardCountsRefresh()
  }, [managementMode, queryClient])

  const pendingStockinDashboardAPI = useMemo(
    () => createPendingStockinDashboardAPI(managementMode),
    [managementMode]
  )

  // 每次打开待入库弹窗都回填当前暂存记录，避免上一条记录的输入残留到下一次。
  const openStockinModal = useCallback((item: PendingStockinItem) => {
    setSelectedStockin(item)
    stockinForm.reset(buildPendingStockinFormValues(item))
  }, [stockinForm])

  // 提交前先在前端校验 `remaining_quantity` 上限；成功后失效 `dashboard/stockin`、`inventory` 并刷新统计。
  const handleStockin = stockinForm.handleSubmit(async (formData) => {
    if (!selectedStockin) return
    const remaining = formData.remaining_quantity
    const maxValue = resolveSpecificationQuantity(
      formData.specification,
      selectedStockin.initial_quantity,
    )
    if (typeof maxValue === 'number') {
      const check = createRemainingQuantitySchema('剩余量', maxValue)
      const parsed = v.safeParse(check, remaining)
      if (!parsed.success) {
        stockinForm.setError('remaining_quantity', { message: parsed.issues[0]?.message || '输入不合法' })
        return
      }
    }

    setStockinLoading(true)
    try {
      const payload = buildPendingStockinPayload(formData)
      if (selectedStockin.order_id) {
        await reagentOrderAPI.stockIn(selectedStockin.order_id, payload)
      } else {
        await inventoryAPI.completePendingStockin(selectedStockin.inventory_id, payload)
      }
      setSelectedStockin(null)
      stockinForm.reset(defaultStockInValues)
      await refreshTables()
      toast.success('入库成功')
    } catch (error) {
      const detail = extractApiErrorDetail(error)
      const validationErrors = toValidationErrors(detail)
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            stockinForm.setError(e.loc[1] as keyof StockInFormInputData, { message: e.msg || '输入不合法' })
          }
        })
        return
      }
      toast.error(normalizeApiErrorMessage(detail, '入库失败'))
    } finally {
      setStockinLoading(false)
    }
  })

  // 关闭弹窗时清空 `selectedStockin` 并恢复 `defaultStockInValues`。
  const closeStockinModal = useCallback(() => {
    if (stockinLoading) return
    setSelectedStockin(null)
    stockinForm.reset(defaultStockInValues)
  }, [stockinForm, stockinLoading])

  const stockinColumns = useMemo(
    () => createStockinColumns(openStockinModal, managementMode),
    [managementMode, openStockinModal]
  )
  const stockinDialog = { selectedStockin, stockinForm, stockinLoading, onClose: closeStockinModal, onSubmit: handleStockin }

  return (
    <>
      <FilterTable
        api={pendingStockinDashboardAPI}
        queryKey={managementMode ? ['dashboard', 'admin', 'stockin'] : ['dashboard', 'stockin']}
        tableId={managementMode ? 'dashboard-admin-stockin' : 'dashboard-stockin'}
        realtime={{
          room: 'inventory',
          eventTypes: INVENTORY_SSE_EVENTS,
          staleOnly: true,
          onRefresh: refreshTables,
          shouldHandleEvent: (event, context) => {
            const payload = event.data as Record<string, unknown>
            const item = payload.item as Record<string, unknown> | undefined
            let itemId: number | null = null
            if (typeof payload.id === 'number') {
              itemId = payload.id
            } else if (typeof item?.id === 'number') {
              itemId = item.id
            }

            if (itemId !== null && context.loadedIds.has(itemId)) {
              return true
            }

            if (managementMode) {
              return true
            }

            if (!item || typeof currentUser?.id !== 'number') {
              return false
            }

            return item.temporary_keeper_id === currentUser.id
          },
        }}
        customColumns={stockinColumns}
        statusOptions={DASHBOARD_EMPTY_STATUS_OPTIONS}
        searchFieldOptions={managementMode ? ADMIN_STOCKIN_SEARCH_FIELDS : BORROW_SEARCH_FIELDS}
        searchPlaceholder={managementMode ? '搜索名称、CAS号、暂存人...' : '搜索名称、CAS号...'}
        title={getPendingStockinTableTitle(managementMode)}
        enableExpandAll={true}
      />
      <DashboardStockinDialog dialog={stockinDialog} brandOptions={brandOptions} />
    </>
  )
}
