import React, { useCallback, useMemo, useState } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { safeParse } from "valibot";
import { AlertTriangle, ArrowRightLeft, Package, Trash2 } from "lucide-react";

import { BaseForm } from "@/components/BaseForm";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { EditDialogActions } from "@/components/EditDialogActions";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { FilterTable, type FilterTableProps } from "@/components/ui/FilterTable";
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
  SpecificationSchema,
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
  getDashboardAlertBadgeClassName,
  isPendingStockinOverdue,
  refreshDashboardAfterMutation,
  type DashboardParams,
  type MyBorrowItem,
  type PendingStockinItem,
} from "../../lib/dashboardUtils";

type BorrowReturnMode = "used" | "remaining";
type ReturnForm = UseFormReturn<ReturnFormInputData, unknown, ReturnFormData>;
const RETURN_ZERO_EPSILON = 0.000_001;

type ReturnSubmissionValues = {
  return_quantity: string | number;
  specification?: string;
  notes?: string;
};

type ReturnSubmissionResult =
  | {
      ok: true;
      finalQuantity: number;
      notes?: string;
      specification?: string;
    }
  | {
      ok: false;
      field: "return_quantity" | "specification";
      message: string;
    };

type ReturnSpecificationResult =
  | {
      ok: true;
      value: string;
      payloadSpecification?: string;
    }
  | {
      ok: false;
      field: "specification";
      message: string;
    };

type ReturnQuantityResult =
  | {
      ok: true;
      finalQuantity: number;
    }
  | {
      ok: false;
      field: "return_quantity";
      message: string;
    };

type BorrowReturnDialogModel = {
  selectedBorrow: MyBorrowItem | null;
  returnMode: BorrowReturnMode;
  returnForm: ReturnForm;
  isSubmittingReturn: boolean;
  isDeletingReturn: boolean;
  onReturnModeChange: (value: BorrowReturnMode) => void;
  onSubmit: () => void;
  onDeleteZeroRemaining: () => void;
  onOpenChange: (open: boolean) => void;
};

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

function normalizeReturnFinalQuantity(quantity: number): number {
  return Math.abs(quantity) < RETURN_ZERO_EPSILON ? 0 : quantity;
}

function parseReturnQuantity(returnQuantity: string | number): number | null {
  if (typeof returnQuantity === "number") {
    return Number.isFinite(returnQuantity) ? returnQuantity : null;
  }
  const trimmedQuantity = returnQuantity.trim();
  if (!trimmedQuantity) {
    return null;
  }
  const quantity = Number(trimmedQuantity);
  return Number.isFinite(quantity) ? quantity : null;
}

function getReturnFinalQuantity(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  returnQuantity: string | number,
): number | null {
  if (!selectedBorrow || !returnQuantity) {
    return null;
  }

  const quantity = parseReturnQuantity(returnQuantity);
  if (quantity === null) {
    return null;
  }
  if (returnMode === "used") {
    if (typeof selectedBorrow.remaining_quantity !== "number") {
      return null;
    }
    return normalizeReturnFinalQuantity(selectedBorrow.remaining_quantity - quantity);
  }

  return normalizeReturnFinalQuantity(quantity);
}

function getReturnPreviewText(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  returnQuantity: string | number,
  specification: string,
): string | null {
  const finalQuantity = getReturnFinalQuantity(selectedBorrow, returnMode, returnQuantity);
  if (!selectedBorrow || finalQuantity === null) {
    return null;
  }

  const unit = resolveSpecificationUnit(specification, selectedBorrow.unit);
  const remaining = Math.max(0, finalQuantity).toFixed(2);
  return `归还后剩余: ${remaining} ${unit ?? ""}`.trim();
}

function canDeleteZeroRemainingBorrow(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  values: ReturnSubmissionValues,
): boolean {
  return resolveReturnSubmission(selectedBorrow, returnMode, values, true).ok;
}

function needsReturnSpecification(item: MyBorrowItem | null): boolean {
  if (!item) {
    return false;
  }
  return !item.specification?.trim() || item.initial_quantity === null
    || item.initial_quantity === undefined || !item.unit?.trim();
}

function getInitialReturnMode(item: MyBorrowItem): BorrowReturnMode {
  if (needsReturnSpecification(item)) {
    return "remaining";
  }
  return typeof item.remaining_quantity === "number" ? "used" : "remaining";
}

function getBorrowQuantityText(item: MyBorrowItem | null): string {
  if (!item || typeof item.remaining_quantity !== "number") {
    return "待补充";
  }
  return `${item.remaining_quantity} ${item.unit ?? ""}`.trim();
}

function getReturnMaxQuantity(
  item: MyBorrowItem,
  returnMode: BorrowReturnMode,
  specification: string,
): number | null {
  if (returnMode === "used") {
    return typeof item.remaining_quantity === "number" ? item.remaining_quantity : null;
  }
  const specificationQuantity = resolveSpecificationQuantity(
    specification,
    item.initial_quantity,
  );
  if (typeof specificationQuantity === "number") {
    return specificationQuantity;
  }
  return typeof item.remaining_quantity === "number" ? item.remaining_quantity : null;
}

function getReturnValidationMessage(
  issues: ReadonlyArray<{ message?: string }>,
  fallback: string,
): string {
  return issues[0]?.message || fallback;
}

function resolveReturnSpecification(
  selectedBorrow: MyBorrowItem,
  specification: string | undefined,
): ReturnSpecificationResult {
  if (!needsReturnSpecification(selectedBorrow)) {
    return { ok: true, value: specification ?? "" };
  }

  const result = safeParse(SpecificationSchema, specification);
  if (!result.success) {
    return {
      ok: false,
      field: "specification",
      message: getReturnValidationMessage(result.issues, "规格格式无效"),
    };
  }

  return {
    ok: true,
    value: result.output,
    payloadSpecification: result.output,
  };
}

function getSubmittedReturnFinalQuantity(
  returnMode: BorrowReturnMode,
  quantity: number,
  maxValue: number | null,
): number {
  const finalQuantity = returnMode === "remaining" ? quantity : (maxValue ?? 0) - quantity;
  return normalizeReturnFinalQuantity(finalQuantity);
}

function resolveReturnQuantity(
  returnMode: BorrowReturnMode,
  returnQuantity: string | number,
  maxValue: number | null,
): ReturnQuantityResult {
  if (returnMode === "used" && maxValue === null) {
    return { ok: false, field: "return_quantity", message: "请填写剩余量" };
  }

  const fieldName = returnMode === "remaining" ? "剩余量" : "使用量";
  const result = safeParse(
    createReturnQuantitySchema(fieldName, maxValue ?? Number.MAX_SAFE_INTEGER),
    returnQuantity,
  );
  if (!result.success) {
    return {
      ok: false,
      field: "return_quantity",
      message: getReturnValidationMessage(result.issues, "输入无效"),
    };
  }

  return {
    ok: true,
    finalQuantity: getSubmittedReturnFinalQuantity(returnMode, result.output, maxValue),
  };
}

function resolveReturnSubmission(
  selectedBorrow: MyBorrowItem | null,
  returnMode: BorrowReturnMode,
  values: ReturnSubmissionValues,
  requireZeroRemaining = false,
): ReturnSubmissionResult {
  if (!selectedBorrow) {
    return { ok: false, field: "return_quantity", message: "请选择借用记录" };
  }

  const specification = resolveReturnSpecification(selectedBorrow, values.specification);
  if (!specification.ok) {
    return specification;
  }

  const maxValue = getReturnMaxQuantity(selectedBorrow, returnMode, specification.value);
  const quantity = resolveReturnQuantity(
    returnMode,
    values.return_quantity,
    maxValue,
  );
  if (!quantity.ok) {
    return quantity;
  }

  if (requireZeroRemaining && quantity.finalQuantity !== 0) {
    return { ok: false, field: "return_quantity", message: "最终剩余量为 0 时才能直接删除" };
  }

  return {
    ok: true,
    finalQuantity: quantity.finalQuantity,
    notes: values.notes,
    specification: specification.payloadSpecification,
  };
}

function useBorrowReturnDialogState(dialog: BorrowReturnDialogModel) {
  const {
    selectedBorrow,
    returnMode,
    returnForm,
    onDeleteZeroRemaining,
  } = dialog;
  const returnQuantityValue = String(useWatch({
    control: returnForm.control,
    name: "return_quantity",
  }) ?? "");
  const watchedSpecification = useWatch({
    control: returnForm.control,
    name: "specification",
  });
  const watchedSpecificationText = String(watchedSpecification ?? "");
  const requireSpecification = needsReturnSpecification(selectedBorrow);
  const canUseUsedMode = typeof selectedBorrow?.remaining_quantity === "number";
  const returnMaxQuantity = selectedBorrow
    ? getReturnMaxQuantity(selectedBorrow, returnMode, watchedSpecificationText)
    : null;
  const returnUnit = resolveSpecificationUnit(
    watchedSpecificationText,
    selectedBorrow?.unit,
  );
  const returnPreviewText = getReturnPreviewText(
    selectedBorrow,
    returnMode,
    returnQuantityValue,
    watchedSpecificationText,
  );
  const showDeleteButton = canDeleteZeroRemainingBorrow(
    selectedBorrow,
    returnMode,
    {
      return_quantity: returnQuantityValue,
      specification: watchedSpecificationText,
    },
  );
  const returnFormFields = useMemo(() => getReturnFormFields(
    returnMode,
    returnMaxQuantity ?? 0,
    returnUnit,
    requireSpecification,
  ), [requireSpecification, returnMaxQuantity, returnMode, returnUnit]);
  const returnDetailFields = useMemo(
    () => returnFormFields.filter((field) => field.name !== "notes"),
    [returnFormFields],
  );
  const returnNotesFields = useMemo(
    () => returnFormFields.filter((field) => field.name === "notes"),
    [returnFormFields],
  );

  const handleDeleteClick = useCallback(() => {
    if (!showDeleteButton) return;
    onDeleteZeroRemaining();
  }, [onDeleteZeroRemaining, showDeleteButton]);

  return {
    canUseUsedMode,
    deleteResetKey: `${selectedBorrow?.inventory_id ?? "none"}:${returnMode}:${returnQuantityValue}:${showDeleteButton}`,
    handleDeleteClick,
    requireSpecification,
    returnDetailFields,
    returnNotesFields,
    returnPreviewText,
    showDeleteButton,
  };
}

function DashboardBorrowReturnDialog({
  dialog,
}: Readonly<{ dialog: BorrowReturnDialogModel }>) {
  const {
    selectedBorrow,
    returnMode,
    returnForm,
    isSubmittingReturn,
    isDeletingReturn,
    onReturnModeChange,
    onSubmit,
    onOpenChange,
  } = dialog;
  const dialogState = useBorrowReturnDialogState(dialog);

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
              CAS: {selectedBorrow?.cas_number} • 当前剩余 {getBorrowQuantityText(selectedBorrow)}
            </p>
          </div>

          {!dialogState.requireSpecification ? (
            <div>
              <RadioGroup
                value={returnMode}
                onValueChange={(value) => onReturnModeChange(value as BorrowReturnMode)}
                className="flex flex-row gap-4"
              >
                {dialogState.canUseUsedMode ? (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="used" id="returnMode-used" />
                    <Label htmlFor="returnMode-used" className="cursor-pointer text-base">填写使用量</Label>
                  </div>
                ) : null}
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="remaining" id="returnMode-remaining" />
                  <Label htmlFor="returnMode-remaining" className="cursor-pointer text-base">填写剩余量</Label>
                </div>
              </RadioGroup>
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="space-y-1">
              <BaseForm form={returnForm} fields={dialogState.returnDetailFields} layout="stack" />
              {dialogState.returnPreviewText ? (
                <p className="text-sm text-muted-foreground">{dialogState.returnPreviewText}</p>
              ) : null}
            </div>
            <BaseForm form={returnForm} fields={dialogState.returnNotesFields} layout="stack" />
          </div>

          <div className="grid grid-cols-3 gap-2 mt-8">
            <div>
              {dialogState.showDeleteButton ? (
                <ConfirmDeleteButton
                  variant="destructive"
                  onConfirm={dialogState.handleDeleteClick}
                  isLoading={isDeletingReturn}
                  disabled={isSubmittingReturn}
                  loadingText="删除中..."
                  className="w-full px-3"
                  size="lg"
                  icon={<Trash2 className="size-4 mr-1.5" />}
                  resetKey={dialogState.deleteResetKey}
                />
              ) : (
                <span aria-hidden="true" className="block h-10" />
              )}
            </div>
            <Button
              variant="modern"
              onClick={() => onOpenChange(false)}
              className="w-full px-3"
              size="lg"
              disabled={isSubmittingReturn || isDeletingReturn}
            >
              取消
            </Button>
            <LoadingButton
              onClick={onSubmit}
              isLoading={isSubmittingReturn}
              disabled={isDeletingReturn}
              loadingText="处理中..."
              className="w-full px-3"
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
    onDelete: () => void;
  };
  brandOptions: { label: string; value: string }[];
}>) {
  const {
    selectedStockin,
    stockinForm,
    stockinLoading,
    onClose,
    onSubmit,
    onDelete,
  } = dialog;
  const watchedSpecification = useWatch({
    control: stockinForm.control,
    name: "specification",
  });
  const watchedRemainingQuantity = useWatch({
    control: stockinForm.control,
    name: "remaining_quantity",
  });
  const stockinUnit = resolveSpecificationUnit(
    watchedSpecification,
    selectedStockin?.unit,
  );
  const canDiscard = watchedRemainingQuantity !== '' && watchedRemainingQuantity !== undefined && Number(watchedRemainingQuantity) === 0;

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
            mode="edit"
            onCancel={onClose}
            onDelete={canDiscard ? onDelete : undefined}
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

function getBorrowEventItemId(payload: Record<string, unknown>, item?: Record<string, unknown>) {
  if (typeof payload.id === 'number') return payload.id
  return typeof item?.id === 'number' ? item.id : null
}

function createBorrowRealtimeConfig(
  refreshTables: () => Promise<void>,
  managementMode: boolean,
  currentUserId: number | undefined,
): NonNullable<FilterTableProps["realtime"]> {
  return {
    room: 'inventory',
    eventTypes: INVENTORY_SSE_EVENTS,
    staleOnly: true,
    onRefresh: refreshTables,
    shouldHandleEvent: (event, context) => {
      const payload = event.data as Record<string, unknown>
      const item = payload.item as Record<string, unknown> | undefined
      const itemId = getBorrowEventItemId(payload, item)
      if (itemId !== null && context.loadedIds.has(itemId)) return true
      if (managementMode) return true
      if (!item || typeof currentUserId !== 'number') return false
      return item.borrower_id === currentUserId || item.last_borrower_id === currentUserId
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
    borrowColumnHelper.accessor('storage_location', {
      header: '位置',
      size: 120,
      cell: (info) => info.getValue() || '-',
    }),
    borrowColumnHelper.accessor('remaining_quantity', {
      header: '借用时剩余量',
      size: 120,
      cell: (info) => getBorrowQuantityText(info.row.original as MyBorrowItem),
    }),
    borrowColumnHelper.accessor('borrow_time', {
      header: '借用时间',
      size: 230,
      cell: (info) => {
        const item = info.row.original as MyBorrowItem
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span>{formatDateTime(info.getValue())}</span>
            {item.is_overdue ? (
              <span
                className={getDashboardAlertBadgeClassName()}
                title="借用超时"
                aria-label="借用超时"
              >
                <AlertTriangle className="size-3" />
                超时
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
  const [isDeletingReturn, setIsDeletingReturn] = useState(false)

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
      refreshDashboardAfterMutation(queryClient),
    ])
  }, [managementMode, queryClient])

  const borrowDashboardAPI = useMemo(
    () => createBorrowDashboardAPI(managementMode),
    [managementMode]
  )

  // 每次打开归还弹窗都强制回到 `used` 模式并清空数量输入，避免沿用上一条记录的表单状态。
  const openReturnModal = useCallback((item: MyBorrowItem) => {
    const initialReturnMode = getInitialReturnMode(item);
    setSelectedBorrow(item)
    setReturnMode(initialReturnMode)
    returnForm.reset({
      return_mode: initialReturnMode,
      specification: item.specification ?? "",
      return_quantity: "",
      notes: item.notes ?? "",
    })
  }, [returnForm])

  // 提交时按当前模式校验并换算最终剩余量；成功后失效借用/库存查询并刷新统计卡片。
  const handleReturn = returnForm.handleSubmit(async (formData) => {
    if (!selectedBorrow) return

    const result = resolveReturnSubmission(selectedBorrow, returnMode, formData)
    if (!result.ok) {
      returnForm.setError(result.field, { message: result.message })
      return
    }

    setIsSubmittingReturn(true)
    try {
      await inventoryAPI.return(selectedBorrow.inventory_id, {
        remaining_quantity: result.finalQuantity,
        specification: result.specification,
        notes: result.notes,
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

  const handleDeleteZeroRemaining = useCallback(async () => {
    if (!selectedBorrow) return

    const result = resolveReturnSubmission(
      selectedBorrow,
      returnMode,
      returnForm.getValues(),
      true,
    )
    if (!result.ok) {
      returnForm.setError(result.field, { message: result.message })
      return
    }

    setIsDeletingReturn(true)
    try {
      await inventoryAPI.returnDelete(selectedBorrow.inventory_id, {
        remaining_quantity: 0,
        specification: result.specification,
        notes: result.notes,
      })
      setSelectedBorrow(null)
      returnForm.reset(defaultReturnValues)
      await refreshTables()
      toast.success('删除成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    } finally {
      setIsDeletingReturn(false)
    }
  }, [refreshTables, returnForm, returnMode, selectedBorrow])

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
  const borrowRealtime = useMemo(
    () => createBorrowRealtimeConfig(refreshTables, managementMode, currentUser?.id),
    [currentUser?.id, managementMode, refreshTables],
  )
  const returnDialog = {
    selectedBorrow,
    returnMode,
    returnForm,
    isSubmittingReturn,
    isDeletingReturn,
    onReturnModeChange: handleReturnModeChange,
    onSubmit: () => void handleReturn(),
    onDeleteZeroRemaining: () => void handleDeleteZeroRemaining(),
    onOpenChange: handleReturnDialogOpenChange,
  }

  return (
    <>
      <FilterTable
        api={borrowDashboardAPI}
        queryKey={managementMode ? ['dashboard', 'admin', 'borrows'] : ['dashboard', 'borrows']}
        tableId={managementMode ? 'dashboard-admin-borrows' : 'dashboard-borrows'}
        mobileMinTableWidth={760}
        realtime={borrowRealtime}
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
      title="暂存超时"
      aria-label="暂存超时"
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
      header: '规格',
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
          <div className="flex flex-wrap items-center gap-2">
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
      refreshDashboardAfterMutation(queryClient),
    ])
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
      const parsed = safeParse(check, remaining)
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
            stockinForm.setError(e.loc[1] as keyof StockInFormInputData, {
              message: normalizeApiErrorMessage(e.msg, '输入不合法'),
            })
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

  const handleDeleteStockin = useCallback(async () => {
    if (!selectedStockin) return
    try {
      await inventoryAPI.discardPendingStockin(selectedStockin.inventory_id, { remaining_quantity: 0 })
      setSelectedStockin(null)
      stockinForm.reset(defaultStockInValues)
      await refreshTables()
      toast.success('已删除暂存记录')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    }
  }, [selectedStockin, stockinForm, refreshTables])

  const stockinColumns = useMemo(
    () => createStockinColumns(openStockinModal, managementMode),
    [managementMode, openStockinModal]
  )
  const stockinDialog = { selectedStockin, stockinForm, stockinLoading, onClose: closeStockinModal, onSubmit: handleStockin, onDelete: handleDeleteStockin }

  return (
    <>
      <FilterTable
        api={pendingStockinDashboardAPI}
        queryKey={managementMode ? ['dashboard', 'admin', 'stockin'] : ['dashboard', 'stockin']}
        tableId={managementMode ? 'dashboard-admin-stockin' : 'dashboard-stockin'}
        mobileMinTableWidth={760}
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
