import { useCallback, useMemo, useState } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { safeParse } from "valibot";
import { AlertTriangle, Check, FlaskConical, PackageCheck, Warehouse, X } from "lucide-react";

import { BaseForm } from "@/components/BaseForm";
import { EditDialogActions } from "@/components/EditDialogActions";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { ReagentOrderExpandedRow } from "@/components/ReagentOrderExpandedRow";
import { TableActionButtonsMemo } from "@/components/TableActionButtons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { FilterTable } from "@/components/ui/FilterTable";
import {
  commonShelfAPI,
  reagentOrderAPI,
  ReagentOrderStatus,
  type ConfirmArrivalPayload,
  type ReagentWorkflowEditPayload,
  type StockInPayload,
} from "@/api/client";
import type { FilterAPI } from "@/hooks/useTableState";
import { UserRoles } from "@/lib/constants";
import { defaultConfirmArrivalValues, defaultCommonPublicArrivalValues, defaultReagentOrderValues, defaultStockInValues, getCommonPublicArrivalFormFields, getConfirmArrivalFormFields, getReagentOrderFormFields, getStockInFormFields } from "@/lib/formConfigs";
import {
  isApprovableOrderStatus,
  isOrderEditableByRole,
  isRejectableOrderStatus,
} from "@/lib/orderEditRules";
import { getReagentBrandOptionsQueryOptions } from "@/lib/reagentBrandOptions";
import { REAGENT_ORDER_SSE_EVENTS } from "@/lib/sseEvents";
import { getReagentOrderTableColumns } from "@/lib/tableConfigs";
import { toast } from "@/lib/toast";
import { formatDate, processNotes } from "@/lib/utils";
import {
  CommonPublicArrivalFormSchema,
  ConfirmArrivalFormSchema,
  ReagentOrderSchema,
  StockInFormSchema,
  applyValidationErrors,
  createRemainingQuantitySchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  normalizeApiErrorMessage,
  resolveSpecificationQuantity,
  resolveSpecificationUnit,
  toValidationErrors,
  type CommonPublicArrivalFormData,
  type CommonPublicArrivalFormInputData,
  type ConfirmArrivalFormData,
  type ConfirmArrivalFormInputData,
  type ReagentOrderFormData,
  type ReagentOrderFormInputData,
  type StockInFormData,
  type StockInFormInputData,
} from "@/lib/validationSchemas";
import { useAuthStore } from "@/store/useStore";
import {
  DASHBOARD_REAGENT_ADMIN_SEARCH_FIELDS,
  DASHBOARD_REAGENT_SEARCH_FIELDS,
  REAGENT_STATUS_OPTIONS,
  buildLocalListData,
  findDashboardColumnIndex,
  flattenGroupedOrders,
  getDashboardAlertBadgeClassName,
  isApprovedOrderOverdue,
  isPendingApprovalOverdue,
  refreshDashboardAfterMutation,
  removeApplicantColumn,
  requestDashboardCountsRefresh,
  type DashboardAlertTone,
  type DashboardParams,
  type DashboardReagentOrder,
} from "../../lib/dashboardUtils";

type StockinMode = "arrival" | "quick" | "common-public-arrival";

function getReagentEditBlockMessage(
  item: DashboardReagentOrder,
  currentUserRole: string | undefined,
  currentUserId: number | undefined,
  isAdmin: boolean,
): string | null {
  if (currentUserRole === UserRoles.PUBLIC) {
    return "公用账户不能编辑订单";
  }
  if (!isAdmin && item.applicant_id !== currentUserId) {
    return "只能编辑自己创建的订单";
  }
  if (!isOrderEditableByRole(item.status, isAdmin)) {
    return "仅待审批、已驳回或管理员已批准订单可编辑";
  }
  return null;
}

function buildReagentFormValues(
  item: DashboardReagentOrder,
): ReagentOrderFormInputData {
  return {
    name: String(item.name ?? ""),
    cas_number: String(item.cas_number ?? ""),
    english_name: String(item.english_name ?? ""),
    alias: String(item.alias ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    purity: String(item.purity ?? ""),
    specification: String(item.specification ?? ""),
    quantity: Number(item.quantity ?? 1),
    price: item.price ?? "",
    order_reason: String(
      item.order_reason ?? "",
    ) as ReagentOrderFormData["order_reason"],
    is_hazardous: Boolean(item.is_hazardous),
    notes: String(item.notes ?? ""),
  };
}

function applyFormValidationErrors<T extends Record<string, unknown>>(
  detail: unknown,
  setError: (
    field: keyof T,
    error: {
      message: string;
    },
  ) => void,
): boolean {
  return applyValidationErrors(
    toValidationErrors(detail),
    (fieldName, message) => {
      setError(fieldName as keyof T, { message });
    },
  );
}

function useReagentEditDialog({
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
}: Readonly<{
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
  isAdmin: boolean;
  refreshTables: () => Promise<void>;
}>) {
  const [editingReagent, setEditingReagent] =
    useState<DashboardReagentOrder | null>(null);
  const [isSubmittingReagent, setIsSubmittingReagent] = useState(false);

  const reagentForm = useForm<
    ReagentOrderFormInputData,
    unknown,
    ReagentOrderFormData
  >({
    resolver: createValibotResolver(ReagentOrderSchema),
    defaultValues: defaultReagentOrderValues,
    shouldFocusError: false,
  });

  const handleReagentEdit = useCallback(
    (itemRaw: Record<string, unknown>) => {
      const item = itemRaw as unknown as DashboardReagentOrder;
      const blockMessage = getReagentEditBlockMessage(
        item,
        currentUserRole,
        currentUserId,
        isAdmin,
      );
      if (blockMessage) {
        toast.warning(blockMessage);
        return;
      }

      setEditingReagent(item);
      reagentForm.reset(buildReagentFormValues(item));
    },
    [currentUserId, currentUserRole, isAdmin, reagentForm],
  );

  const submitReagentEdit = reagentForm.handleSubmit(async (formData) => {
    if (!editingReagent) return;
    setIsSubmittingReagent(true);
    try {
      await reagentOrderAPI.update(editingReagent.id, {
        name: formData.name,
        english_name: formData.english_name || "",
        alias: formData.alias || "",
        category: formData.category || "",
        brand: formData.brand || "",
        purity: formData.purity || "",
        specification: formData.specification || "",
        quantity: formData.quantity,
        price: formData.price,
        order_reason: formData.order_reason,
        is_hazardous: formData.is_hazardous,
        notes: processNotes(formData.notes),
      });
      setEditingReagent(null);
      await refreshTables();
      toast.success(
        editingReagent.status === ReagentOrderStatus.REJECTED ||
          editingReagent.status === ReagentOrderStatus.APPROVED
          ? "试剂订单已重新提交待审批"
          : "试剂订单已更新",
      );
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      if (applyFormValidationErrors<ReagentOrderFormData>(detail, reagentForm.setError)) {
        return;
      }
      toast.error(normalizeApiErrorMessage(detail, "更新失败"));
    } finally {
      setIsSubmittingReagent(false);
    }
  });

  const handleDeleteReagent = useCallback(async () => {
    if (!editingReagent) return;

    try {
      await reagentOrderAPI.delete(editingReagent.id);
      setEditingReagent(null);
      reagentForm.reset(defaultReagentOrderValues);
      await refreshTables();
      toast.success("试剂订单已删除");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除失败"));
    }
  }, [editingReagent, reagentForm, refreshTables]);

  const closeReagentDialog = useCallback(() => {
    setEditingReagent(null);
    reagentForm.reset(defaultReagentOrderValues);
  }, [reagentForm]);

  return {
    editingReagent,
    isSubmittingReagent,
    reagentForm,
    handleReagentEdit,
    submitReagentEdit,
    handleDeleteReagent,
    closeReagentDialog,
  };
}

function buildWorkflowBaseValues(item: DashboardReagentOrder) {
  return {
    name: String(item.name ?? ""),
    cas_number: String(item.cas_number ?? ""),
    english_name: String(item.english_name ?? ""),
    alias: String(item.alias ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    purity: String(item.purity ?? ""),
    specification: String(item.specification ?? ""),
    is_hazardous: Boolean(item.is_hazardous),
    notes: String(item.notes ?? ""),
  };
}

function buildWorkflowPayload(
  formData: StockInFormData | ConfirmArrivalFormData | CommonPublicArrivalFormData,
): ReagentWorkflowEditPayload {
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
  };
}

function buildConfirmArrivalPayload(
  formData: ConfirmArrivalFormData,
): ConfirmArrivalPayload {
  return {
    ...buildWorkflowPayload(formData),
    storage_location: formData.storage_location || "",
    remaining_quantity: formData.remaining_quantity,
  };
}

function buildCommonPublicArrivalPayload(
  formData: CommonPublicArrivalFormData,
): ConfirmArrivalPayload {
  return {
    ...buildWorkflowPayload(formData),
    storage_location: formData.storage_location || "",
  };
}

function buildStockInPayload(formData: StockInFormData): StockInPayload {
  return {
    ...buildWorkflowPayload(formData),
    storage_location: formData.storage_location,
    remaining_quantity: formData.remaining_quantity,
  };
}

type WorkflowRemainingFields = Pick<
  StockInFormData,
  "specification" | "remaining_quantity"
>;

function validateWorkflowRemainingQuantity(
  fields: WorkflowRemainingFields,
  fallbackInitialQuantity: number | null | undefined,
  setError: (message: string) => void,
): boolean {
  const maxValue = resolveSpecificationQuantity(
    fields.specification,
    fallbackInitialQuantity,
  );
  if (typeof maxValue !== "number") return true;

  const check = createRemainingQuantitySchema("剩余量", maxValue);
  const parsed = safeParse(check, fields.remaining_quantity);
  if (parsed.success) return true;

  setError(parsed.issues[0]?.message || "输入不合法");
  return false;
}

function buildConfirmArrivalFormValues(
  item: DashboardReagentOrder,
): ConfirmArrivalFormInputData {
  return {
    ...buildWorkflowBaseValues(item),
    remaining_quantity: item.initial_quantity ?? "",
    storage_location: "",
  };
}

function buildCommonPublicArrivalFormValues(
  item: DashboardReagentOrder,
): CommonPublicArrivalFormInputData {
  return {
    ...buildWorkflowBaseValues(item),
    storage_location: "",
  };
}

function buildStockinFormValues(
  item: DashboardReagentOrder,
  mode: StockinMode,
): StockInFormInputData {
  const remainingQuantity =
    mode === "quick" ? (item.initial_quantity ?? "") : (item.remaining_quantity ?? "");

  return {
    ...buildWorkflowBaseValues(item),
    remaining_quantity: remainingQuantity,
    storage_location: "",
  };
}

function getStockinDialogTitle(mode: StockinMode): string {
  if (mode === "arrival") {
    return "确认到货";
  }
  if (mode === "quick") {
    return "一键入库";
  }
  if (mode === "common-public-arrival") {
    return "到货并加入常用货架";
  }
  return "入库";
}

function getStockinSubmitLabel(mode: StockinMode): string {
  if (mode === "arrival" || mode === "common-public-arrival") {
    return "确认到货";
  }
  return "确认入库";
}

function getActiveStockinSpecification(params: {
  mode: StockinMode;
  arrivalSpecification: string;
  stockinSpecification: string;
  commonPublicArrivalSpecification: string;
}): string {
  if (params.mode === "arrival") return params.arrivalSpecification;
  if (params.mode === "common-public-arrival") {
    return params.commonPublicArrivalSpecification;
  }
  return params.stockinSpecification;
}

async function finishWorkflowSubmit(
  resetStockinDialog: () => void,
  refreshTables: () => Promise<void>,
  successMessage: string,
) {
  resetStockinDialog();
  await refreshTables();
  toast.success(successMessage);
}

function useReagentWorkflowSubmitHandlers({
  stockinTarget,
  arrivalForm,
  stockinForm,
  commonPublicArrivalForm,
  setIsSubmittingStockin,
  resetStockinDialog,
  refreshTables,
}: Readonly<{
  stockinTarget: DashboardReagentOrder | null;
  arrivalForm: ReturnType<typeof useForm<ConfirmArrivalFormInputData, unknown, ConfirmArrivalFormData>>;
  stockinForm: ReturnType<typeof useForm<StockInFormInputData, unknown, StockInFormData>>;
  commonPublicArrivalForm: ReturnType<typeof useForm<CommonPublicArrivalFormInputData, unknown, CommonPublicArrivalFormData>>;
  setIsSubmittingStockin: (value: boolean) => void;
  resetStockinDialog: () => void;
  refreshTables: () => Promise<void>;
}>) {
  const submitStockin = stockinForm.handleSubmit(async (formData) => {
    if (!stockinTarget) return;
    const isRemainingValid = validateWorkflowRemainingQuantity(
      formData,
      stockinTarget.initial_quantity,
      (message) => stockinForm.setError("remaining_quantity", { message }),
    );
    if (!isRemainingValid) return;

    setIsSubmittingStockin(true);
    try {
      await reagentOrderAPI.stockIn(stockinTarget.id, buildStockInPayload(formData));
      await finishWorkflowSubmit(resetStockinDialog, refreshTables, "入库成功");
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      if (applyFormValidationErrors<StockInFormInputData>(detail, stockinForm.setError)) {
        return;
      }
      toast.error(normalizeApiErrorMessage(detail, "入库失败"));
    } finally {
      setIsSubmittingStockin(false);
    }
  });

  const submitArrival = arrivalForm.handleSubmit(async (formData) => {
    if (!stockinTarget) return;
    const isRemainingValid = validateWorkflowRemainingQuantity(
      formData,
      stockinTarget.initial_quantity,
      (message) => arrivalForm.setError("remaining_quantity", { message }),
    );
    if (!isRemainingValid) return;

    setIsSubmittingStockin(true);
    try {
      await reagentOrderAPI.confirmArrival(
        stockinTarget.id,
        buildConfirmArrivalPayload(formData),
      );
      await finishWorkflowSubmit(resetStockinDialog, refreshTables, "确认到货成功");
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      if (applyFormValidationErrors<ConfirmArrivalFormData>(detail, arrivalForm.setError)) {
        return;
      }
      toast.error(normalizeApiErrorMessage(detail, "确认到货失败"));
    } finally {
      setIsSubmittingStockin(false);
    }
  });

  const submitCommonPublicArrival = commonPublicArrivalForm.handleSubmit(
    async (formData) => {
      if (!stockinTarget) return;

      setIsSubmittingStockin(true);
      try {
        await reagentOrderAPI.confirmArrival(
          stockinTarget.id,
          buildCommonPublicArrivalPayload(formData),
        );
        await finishWorkflowSubmit(resetStockinDialog, refreshTables, "确认到货成功");
      } catch (err) {
        const detail = extractApiErrorDetail(err);
        if (
          applyFormValidationErrors<CommonPublicArrivalFormData>(
            detail,
            commonPublicArrivalForm.setError,
          )
        ) {
          return;
        }
        toast.error(normalizeApiErrorMessage(detail, "确认到货失败"));
      } finally {
        setIsSubmittingStockin(false);
      }
    },
  );

  return { submitArrival, submitCommonPublicArrival, submitStockin };
}

function useReagentStockinDialog(refreshTables: () => Promise<void>) {
  const [stockinTarget, setStockinTarget] =
    useState<DashboardReagentOrder | null>(null);
  const [stockinMode, setStockinMode] = useState<StockinMode>("quick");
  const [isSubmittingStockin, setIsSubmittingStockin] = useState(false);

  const arrivalForm = useForm<ConfirmArrivalFormInputData, unknown, ConfirmArrivalFormData>({
    resolver: createValibotResolver(ConfirmArrivalFormSchema),
    defaultValues: defaultConfirmArrivalValues,
    shouldFocusError: false,
  });
  const stockinForm = useForm<StockInFormInputData, unknown, StockInFormData>({
    resolver: createValibotResolver(StockInFormSchema),
    defaultValues: defaultStockInValues,
    shouldFocusError: false,
  });
  const commonPublicArrivalForm = useForm<
    CommonPublicArrivalFormInputData,
    unknown,
    CommonPublicArrivalFormData
  >({
    resolver: createValibotResolver(CommonPublicArrivalFormSchema),
    defaultValues: defaultCommonPublicArrivalValues,
    shouldFocusError: false,
  });

  const resetStockinDialog = useCallback(() => {
    setStockinTarget(null);
    setStockinMode("quick");
    arrivalForm.reset(defaultConfirmArrivalValues);
    stockinForm.reset(defaultStockInValues);
    commonPublicArrivalForm.reset(defaultCommonPublicArrivalValues);
  }, [arrivalForm, commonPublicArrivalForm, stockinForm]);

  const openStockinDialog = useCallback(
    (item: DashboardReagentOrder, mode: StockinMode) => {
      setStockinTarget(item);
      setStockinMode(mode);
      if (mode === "arrival") {
        arrivalForm.reset(buildConfirmArrivalFormValues(item));
        return;
      }
      if (mode === "common-public-arrival") {
        commonPublicArrivalForm.reset(buildCommonPublicArrivalFormValues(item));
        return;
      }
      stockinForm.reset(buildStockinFormValues(item, mode));
    },
    [arrivalForm, commonPublicArrivalForm, stockinForm],
  );

  const closeStockinDialog = useCallback(() => {
    if (isSubmittingStockin) return;
    resetStockinDialog();
  }, [isSubmittingStockin, resetStockinDialog]);

  const { submitArrival, submitCommonPublicArrival, submitStockin } =
    useReagentWorkflowSubmitHandlers({
      stockinTarget,
      arrivalForm,
      stockinForm,
      commonPublicArrivalForm,
      setIsSubmittingStockin,
      resetStockinDialog,
      refreshTables,
    });

  let activeSubmit = submitStockin;
  if (stockinMode === "arrival") {
    activeSubmit = submitArrival;
  } else if (stockinMode === "common-public-arrival") {
    activeSubmit = submitCommonPublicArrival;
  }

  return {
    stockinTarget,
    stockinMode,
    arrivalForm,
    stockinForm,
    commonPublicArrivalForm,
    isSubmittingStockin,
    openStockinDialog,
    closeStockinDialog,
    submitStockin: activeSubmit,
  };
}

function DashboardReagentEditDialog({
  dialog,
  isAdmin,
  brandOptions,
}: Readonly<{
  dialog: ReturnType<typeof useReagentEditDialog>;
  isAdmin: boolean;
  brandOptions: { label: string; value: string }[];
}>) {
  const {
    editingReagent,
    reagentForm,
    isSubmittingReagent,
    handleDeleteReagent,
    closeReagentDialog,
    submitReagentEdit,
  } = dialog;
  const isReagentEditLocked =
    editingReagent !== null && !isOrderEditableByRole(editingReagent.status, isAdmin);

  return (
    <Dialog
      open={editingReagent !== null}
      onOpenChange={(open) => {
        if (!open) closeReagentDialog();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>编辑试剂订单</span>
            {isReagentEditLocked ? (
              <span className="text-base text-muted-foreground">
                当前状态不可编辑
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submitReagentEdit}>
          <BaseForm
            form={reagentForm}
            fields={getReagentOrderFormFields({ brandOptions })}
            disabled={isReagentEditLocked}
          />
          <EditDialogActions
            mode="edit"
            onCancel={closeReagentDialog}
            onDelete={handleDeleteReagent}
            submitLabelEdit="保存"
            submitLabelAdd="保存"
            isSubmitting={isSubmittingReagent}
            disableSubmit={isReagentEditLocked}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReagentWorkflowFormContent({
  mode,
  unit,
  brandOptions,
  arrivalForm,
  stockinForm,
  commonPublicArrivalForm,
  commonPublicArrivalFields,
}: Readonly<{
  mode: StockinMode;
  unit?: string | null;
  brandOptions: { label: string; value: string }[];
  arrivalForm: ReturnType<typeof useReagentStockinDialog>["arrivalForm"];
  stockinForm: ReturnType<typeof useReagentStockinDialog>["stockinForm"];
  commonPublicArrivalForm: ReturnType<typeof useReagentStockinDialog>["commonPublicArrivalForm"];
  commonPublicArrivalFields: ReturnType<typeof getCommonPublicArrivalFormFields>;
}>) {
  if (mode === "arrival") {
    return (
      <BaseForm
        form={arrivalForm}
        fields={getConfirmArrivalFormFields(unit ?? undefined, { brandOptions })}
      />
    );
  }
  if (mode === "common-public-arrival") {
    return (
      <BaseForm form={commonPublicArrivalForm} fields={commonPublicArrivalFields} />
    );
  }
  return (
    <BaseForm
      form={stockinForm}
      fields={getStockInFormFields(unit ?? undefined, undefined, { brandOptions })}
    />
  );
}

function DashboardReagentStockinDialog({
  dialog,
  brandOptions,
}: Readonly<{
  dialog: ReturnType<typeof useReagentStockinDialog>;
  brandOptions: { label: string; value: string }[];
}>) {
  const {
    stockinTarget,
    stockinMode,
    arrivalForm,
    stockinForm,
    commonPublicArrivalForm,
    isSubmittingStockin,
    closeStockinDialog,
    submitStockin,
  } = dialog;
  const arrivalSpecification = useWatch({
    control: arrivalForm.control,
    name: "specification",
  });
  const stockinSpecification = useWatch({
    control: stockinForm.control,
    name: "specification",
  });
  const commonPublicArrivalSpecification = useWatch({
    control: commonPublicArrivalForm.control,
    name: "specification",
  });
  const commonPublicArrivalBrand = useWatch({
    control: commonPublicArrivalForm.control,
    name: "brand",
  });
  const activeSpecification = getActiveStockinSpecification({
    mode: stockinMode,
    arrivalSpecification,
    stockinSpecification,
    commonPublicArrivalSpecification,
  });
  const activeUnit = resolveSpecificationUnit(activeSpecification, stockinTarget?.unit);
  const commonPublicArrivalSuggestionSpec =
    commonPublicArrivalSpecification?.trim() ?? "";
  const commonPublicArrivalSuggestionUnit = resolveSpecificationUnit(
    commonPublicArrivalSuggestionSpec,
    undefined,
  );
  const commonPublicArrivalSuggestionBrand =
    commonPublicArrivalBrand?.trim() ?? "";
  const commonShelfLocationSuggestionsQuery = useQuery({
    queryKey: [
      "common-shelf-order-location-suggestions",
      stockinTarget?.cas_number,
      commonPublicArrivalSuggestionBrand,
      commonPublicArrivalSuggestionSpec,
    ],
    enabled:
      stockinMode === "common-public-arrival"
      && Boolean(stockinTarget)
      && Boolean(commonPublicArrivalSuggestionUnit),
    queryFn: async () => {
      const response = await commonShelfAPI.getLocationSuggestionsByFields({
        cas_number: stockinTarget!.cas_number,
        brand: commonPublicArrivalSuggestionBrand || undefined,
        specification: commonPublicArrivalSuggestionSpec,
      });
      return response.data;
    },
  });
  const commonPublicArrivalFields = getCommonPublicArrivalFormFields(
    commonShelfLocationSuggestionsQuery.data ?? [],
    { brandOptions },
  );
  const dialogTitle = getStockinDialogTitle(stockinMode);

  return (
    <Dialog
      open={stockinTarget !== null}
      onOpenChange={(open) => {
        if (!open) closeStockinDialog();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submitStockin}>
          <ReagentWorkflowFormContent
            mode={stockinMode}
            unit={activeUnit}
            brandOptions={brandOptions}
            arrivalForm={arrivalForm}
            stockinForm={stockinForm}
            commonPublicArrivalForm={commonPublicArrivalForm}
            commonPublicArrivalFields={commonPublicArrivalFields}
          />

          <EditDialogActions
            mode="add"
            onCancel={closeStockinDialog}
            submitLabelEdit={getStockinSubmitLabel(stockinMode)}
            submitLabelAdd={getStockinSubmitLabel(stockinMode)}
            isSubmitting={isSubmittingStockin}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const reagentColumnHelper = createColumnHelper<DashboardReagentOrder>();

function renderAlertBadge(
  label: string,
  title: string,
  tone: DashboardAlertTone = "destructive",
) {
  return (
    <span
      className={getDashboardAlertBadgeClassName(tone)}
      title={title}
      aria-label={title}
    >
      <AlertTriangle className="size-3" />
      {label}
    </span>
  );
}

function renderReagentTimeAlertBadges(
  item: DashboardReagentOrder,
  managementMode: boolean,
) {
  return (
    <>
      {managementMode && isPendingApprovalOverdue(item.status, item.updated_at)
        ? renderAlertBadge("超时", "审批超时")
        : null}
      {isApprovedOrderOverdue(item.status, item.updated_at)
        ? renderAlertBadge("超时", "到货超时", "warning")
        : null}
    </>
  );
}

function createReagentDashboardAPI(
  currentUserId: number | undefined,
  managementMode: boolean,
): FilterAPI {
  return {
    list: async (params) => {
      const response = managementMode
        ? await reagentOrderAPI.getAdminReagentOrders()
        : await reagentOrderAPI.getMyReagentOrders();
      const grouped = (response.data?.data ?? {}) as Record<
        string,
        { orders: Record<string, unknown>[] }
      >;
      const rows = flattenGroupedOrders<DashboardReagentOrder>(
        grouped,
        managementMode ? undefined : currentUserId,
      );
      const local = buildLocalListData(rows, params as DashboardParams, [
        "name",
        "cas_number",
        "brand",
        "specification",
        "created_at",
        ...(managementMode ? ["applicant_name"] : []),
      ]);
      return { data: local };
    },
  };
}

function createReagentActions(
  openStockinDialog: (item: DashboardReagentOrder, mode: StockinMode) => void,
) {
  return [
    {
      id: "confirm-arrival",
      label: "到货",
      icon: <PackageCheck className="size-4" />,
      variant: "modern" as const,
      className:
        "text-blue-600/90 hover:text-blue-700 dark:text-blue-400/70 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30",
      showWhen: (currItem: DashboardReagentOrder) =>
        currItem.status === "approved",
      onClick: (currItem: DashboardReagentOrder) => {
        openStockinDialog(
          currItem,
          currItem.order_reason === "common_public"
            ? "common-public-arrival"
            : "arrival",
        );
      },
    },
    {
      id: "quick-stock-in",
      label: "一键入库",
      icon: <Warehouse className="size-4" />,
      variant: "modern" as const,
      className:
        "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950",
      showWhen: (currItem: DashboardReagentOrder) =>
        currItem.status === "approved" &&
        currItem.order_reason !== "common_public",
      onClick: (currItem: DashboardReagentOrder) => {
        openStockinDialog(currItem, "quick");
      },
    },
  ];
}

function createReagentApprovalActions(refreshTables: () => Promise<void>) {
  return [
    {
      id: "approve",
      label: "审批",
      icon: <Check className="size-4.5" />,
      variant: "modern" as const,
      className:
        "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950",
      confirm: true,
      confirmLabel: "确认审批",
      disableWhen: (currItem: DashboardReagentOrder) =>
        !isApprovableOrderStatus(currItem.status),
      onClick: async (currItem: DashboardReagentOrder) => {
        await reagentOrderAPI.approve(currItem.id);
        await refreshTables();
        toast.success("审批通过");
      },
    },
    {
      id: "reject",
      label: "驳回",
      icon: <X className="size-4.5" />,
      variant: "modern" as const,
      className:
        "text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20",
      confirm: true,
      confirmLabel: "确认驳回",
      disableWhen: (currItem: DashboardReagentOrder) =>
        !isRejectableOrderStatus(currItem.status),
      onClick: async (currItem: DashboardReagentOrder) => {
        await reagentOrderAPI.reject(currItem.id, "管理员驳回");
        await refreshTables();
        toast.success("已驳回");
      },
    },
  ];
}

function createReagentColumns({
  currentUserId,
  currentUserRole,
  isAdmin,
  managementMode,
  onEdit,
  openStockinDialog,
  refreshTables,
}: Readonly<{
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
  isAdmin: boolean;
  managementMode: boolean;
  onEdit: (item: DashboardReagentOrder) => void;
  openStockinDialog: (item: DashboardReagentOrder, mode: StockinMode) => void;
  refreshTables: () => Promise<void>;
}>): ColumnDef<Record<string, unknown>, unknown>[] {
  const orderColumns = getReagentOrderTableColumns() as ColumnDef<
    Record<string, unknown>,
    unknown
  >[];
  const baseColumns = managementMode
    ? orderColumns
    : removeApplicantColumn(orderColumns);
  const columns = [...baseColumns];
  const createdAtColumnIndex = findDashboardColumnIndex(columns, "created_at");
  if (createdAtColumnIndex >= 0) {
    columns[createdAtColumnIndex] = reagentColumnHelper.accessor("created_at", {
      header: "时间",
      size: 160,
      minSize: 140,
      maxSize: 220,
      cell: (info) => {
        const item = info.row.original as DashboardReagentOrder;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span>{formatDate(info.getValue() as string)}</span>
            {renderReagentTimeAlertBadges(item, managementMode)}
          </div>
        );
      },
    }) as ColumnDef<Record<string, unknown>, unknown>;
  }
  const statusColumnIndex = findDashboardColumnIndex(columns, "status");
  if (!managementMode && statusColumnIndex >= 0) {
    columns[statusColumnIndex] = reagentColumnHelper.accessor("status", {
      header: "状态",
      size: 150,
      minSize: 120,
      maxSize: 180,
      cell: (info) => {
        const item = info.row.original as DashboardReagentOrder;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge
              status={String(info.getValue() ?? "")}
              order={item}
              kind="reagent"
            />
          </div>
        );
      },
    }) as ColumnDef<Record<string, unknown>, unknown>;
  }
  const actions = managementMode
    ? createReagentApprovalActions(refreshTables)
    : createReagentActions(openStockinDialog);
  const actionColumn = reagentColumnHelper.display({
    id: "actions",
    header: "操作",
    size: 132,
    minSize: 132,
    cell: (info) => {
      const item = info.row.original;
      const disableEdit =
        currentUserRole === UserRoles.PUBLIC ||
        (!isAdmin && item.applicant_id !== currentUserId) ||
        !isOrderEditableByRole(item.status, isAdmin);

      return (
        <TableActionButtonsMemo
          item={item}
          actions={actions}
          showEdit={true}
          disableEdit={disableEdit}
          onEdit={(target) => onEdit(target as DashboardReagentOrder)}
          isAdmin={isAdmin}
        />
      );
    },
  });

  return [...columns, actionColumn] as ColumnDef<
    Record<string, unknown>,
    unknown
  >[];
}

// 仪表盘中的试剂订单页签，承载本地筛选、编辑、到货确认和入库流程。

export function DashboardReagentTab({
  managementMode = false,
}: Readonly<{ managementMode?: boolean }>) {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === UserRoles.ADMIN;
  const queryClient = useQueryClient();

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: managementMode
          ? ["dashboard", "admin", "reagents"]
          : ["dashboard", "reagents"],
      }),
      queryClient.invalidateQueries({ queryKey: ["reagent-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      refreshDashboardAfterMutation(queryClient),
    ]);
  }, [managementMode, queryClient]);

  const reagentDashboardAPI = useMemo(
    () => createReagentDashboardAPI(currentUser?.id, managementMode),
    [currentUser?.id, managementMode],
  );

  const reagentEditDialog = useReagentEditDialog({
    currentUserId: currentUser?.id,
    currentUserRole: currentUser?.role,
    isAdmin,
    refreshTables,
  });

  const stockinDialog = useReagentStockinDialog(refreshTables);
  const shouldLoadBrandOptions =
    reagentEditDialog.editingReagent !== null || stockinDialog.stockinTarget !== null;
  const { data: brandOptions = [] } = useQuery({
    ...getReagentBrandOptionsQueryOptions(),
    enabled: shouldLoadBrandOptions,
  });
  const handleReagentEdit = reagentEditDialog.handleReagentEdit;
  const openStockinDialog = stockinDialog.openStockinDialog;

  const reagentColumns = useMemo(
    () =>
      createReagentColumns({
        currentUserId: currentUser?.id,
        currentUserRole: currentUser?.role,
        isAdmin,
        managementMode,
        onEdit: (item) =>
          handleReagentEdit(item as unknown as Record<string, unknown>),
        openStockinDialog,
        refreshTables,
      }),
    [
      currentUser?.id,
      currentUser?.role,
      isAdmin,
      managementMode,
      handleReagentEdit,
      openStockinDialog,
      refreshTables,
    ],
  );

  return (
    <>
      <FilterTable
        api={reagentDashboardAPI}
        queryKey={managementMode ? ["dashboard", "admin", "reagents"] : ["dashboard", "reagents"]}
        tableId={managementMode ? "dashboard-admin-reagent-orders" : "dashboard-reagent-orders"}
        realtime={{
          room: "reagent_orders",
          eventTypes: REAGENT_ORDER_SSE_EVENTS,
          onRefresh: refreshTables,
          onSafePatch: () => {
            requestDashboardCountsRefresh();
          },
          shouldHandleEvent: (event, context) => {
            const payload = event.data as Record<string, unknown>;
            const item = payload.item as Record<string, unknown> | undefined;
            let itemId: number | null = null;
            if (typeof payload.id === "number") {
              itemId = payload.id;
            } else if (typeof item?.id === "number") {
              itemId = item.id;
            }

            if (itemId !== null && context.loadedIds.has(itemId)) {
              return true;
            }

            if (managementMode) {
              return true;
            }

            if (!item || typeof currentUser?.id !== "number") {
              return false;
            }

            return item.applicant_id === currentUser.id;
          },
        }}
        customColumns={reagentColumns}
        statusOptions={REAGENT_STATUS_OPTIONS}
        searchFieldOptions={
          managementMode
            ? DASHBOARD_REAGENT_ADMIN_SEARCH_FIELDS
            : DASHBOARD_REAGENT_SEARCH_FIELDS
        }
        searchPlaceholder={
          managementMode
            ? "搜索名称、CAS号、品牌、订购人、订购时间..."
            : "搜索名称、CAS号、品牌、订购时间..."
        }
        title={
          <>
            <FlaskConical className="w-5 h-5" />
            {managementMode ? "活跃试剂订单" : "我的试剂订单"}
          </>
        }
        noteField="notes"
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as DashboardReagentOrder;
          return <ReagentOrderExpandedRow item={item} />;
        }}
      />
      <DashboardReagentEditDialog dialog={reagentEditDialog} isAdmin={isAdmin} brandOptions={brandOptions} />
      <DashboardReagentStockinDialog dialog={stockinDialog} brandOptions={brandOptions} />
    </>
  );
}
