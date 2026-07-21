import { useCallback, useMemo, useState } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AlertTriangle, Check, ShoppingCart, X } from "lucide-react";

import { BaseForm } from "@/components/BaseForm";
import { ConsumableOrderExpandedRow } from "@/components/ConsumableOrderExpandedRow";
import { EditDialogActions } from "@/components/EditDialogActions";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { TableActionButtonsMemo } from "@/components/TableActionButtons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { FilterTable } from "@/components/ui/FilterTable";
import { consumableOrderAPI, ConsumableOrderStatus } from "@/api/client";
import type { FilterAPI } from "@/hooks/useTableState";
import { UserRoles } from "@/lib/constants";
import { defaultConsumableOrderValues, getConsumableOrderFormFields } from "@/lib/formConfigs";
import {
  isApprovableOrderStatus,
  isOrderEditableByRole,
  isRejectableOrderStatus,
} from "@/lib/orderEditRules";
import { CONSUMABLE_ORDER_SSE_EVENTS } from "@/lib/sseEvents";
import { getConsumableOrderTableColumns } from "@/lib/tableConfigs";
import { toast } from "@/lib/toast";
import { formatDate, processNotes, toText } from "@/lib/utils";
import {
  ConsumableOrderSchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  normalizeApiErrorMessage,
  toValidationErrors,
  type ConsumableOrderFormData,
  type ConsumableOrderFormInputData,
} from "@/lib/validationSchemas";
import { useAuthStore } from "@/store/useStore";
import {
  CONSUMABLE_STATUS_OPTIONS,
  DASHBOARD_CONSUMABLE_ADMIN_SEARCH_FIELDS,
  DASHBOARD_CONSUMABLE_SEARCH_FIELDS,
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
  type DashboardConsumableOrder,
  type DashboardParams,
} from "../../lib/dashboardUtils";

type ConsumableForm = ReturnType<
  typeof useForm<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >
>;

function getConsumableEditBlockMessage(
  item: DashboardConsumableOrder,
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

function buildConsumableFormValues(
  item: DashboardConsumableOrder,
): ConsumableOrderFormInputData {
  return {
    name: String(item.name ?? ""),
    english_name: String(item.english_name ?? ""),
    product_number: "",
    specification: String(item.specification ?? ""),
    unit: toText(item.unit),
    quantity: Number(item.quantity ?? 1),
    price: (item.price as number | undefined) ?? undefined,
    communication: String(item.communication ?? ""),
    notes: String(item.notes ?? ""),
  };
}

function useDashboardConsumableDialogController({
  consumableForm,
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
}: Readonly<{
  consumableForm: ConsumableForm;
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
  isAdmin: boolean;
  refreshTables: () => Promise<void>;
}>) {
  const [editingConsumable, setEditingConsumable] =
    useState<DashboardConsumableOrder | null>(null);
  const [isSubmittingConsumable, setIsSubmittingConsumable] = useState(false);

  const handleConsumableEdit = useCallback(
    (itemRaw: Record<string, unknown>) => {
      const item = itemRaw as unknown as DashboardConsumableOrder;
      const blockMessage = getConsumableEditBlockMessage(
        item,
        currentUserRole,
        currentUserId,
        isAdmin,
      );
      if (blockMessage) {
        toast.warning(blockMessage);
        return;
      }

      setEditingConsumable(item);
      consumableForm.reset(buildConsumableFormValues(item));
    },
    [consumableForm, currentUserId, currentUserRole, isAdmin],
  );

  const submitConsumableEdit = consumableForm.handleSubmit(async (formData) => {
    if (!editingConsumable) return;
    setIsSubmittingConsumable(true);
    try {
      await consumableOrderAPI.update(editingConsumable.id, {
        name: formData.name,
        english_name: formData.english_name || "",
        specification: formData.specification || "",
        unit: formData.unit || "",
        quantity: formData.quantity,
        price: formData.price,
        communication: formData.communication || "",
        notes: processNotes(formData.notes),
      });
      setEditingConsumable(null);
      await refreshTables();
      toast.success(
        editingConsumable.status === ConsumableOrderStatus.REJECTED ||
          editingConsumable.status === ConsumableOrderStatus.APPROVED
          ? "耗材订单已重新提交待审批"
          : "耗材订单已更新",
      );
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      const validationErrors = toValidationErrors(detail);
      if (validationErrors.length > 0) {
        validationErrors.forEach((e) => {
          if (e.loc?.[1]) {
            consumableForm.setError(e.loc[1] as keyof ConsumableOrderFormData, {
              message: normalizeApiErrorMessage(e.msg, "输入不合法"),
            });
          }
        });
        return;
      }
      toast.error(normalizeApiErrorMessage(detail, "更新失败"));
    } finally {
      setIsSubmittingConsumable(false);
    }
  });

  const handleDeleteConsumable = useCallback(async () => {
    if (!editingConsumable) return;

    try {
      await consumableOrderAPI.delete(editingConsumable.id);
      setEditingConsumable(null);
      consumableForm.reset(defaultConsumableOrderValues);
      await refreshTables();
      toast.success("耗材订单已删除");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除失败"));
    }
  }, [consumableForm, editingConsumable, refreshTables]);

  const closeConsumableDialog = useCallback(() => {
    setEditingConsumable(null);
    consumableForm.reset(defaultConsumableOrderValues);
  }, [consumableForm]);

  return {
    handleConsumableEdit,
    consumableEditDialog: {
      editingConsumable,
      consumableForm,
      isSubmittingConsumable,
      onDelete: handleDeleteConsumable,
      onClose: closeConsumableDialog,
      onSubmit: submitConsumableEdit,
    },
  };
}

function DashboardConsumableEditDialog({
  dialog,
  isAdmin,
}: Readonly<{
  dialog: {
    editingConsumable: DashboardConsumableOrder | null;
    consumableForm: ReturnType<
      typeof useForm<
        ConsumableOrderFormInputData,
        unknown,
        ConsumableOrderFormData
      >
    >;
    isSubmittingConsumable: boolean;
    onDelete: () => void;
    onClose: () => void;
    onSubmit: () => void;
  };
  isAdmin: boolean;
}>) {
  const {
    editingConsumable,
    consumableForm,
    isSubmittingConsumable,
    onDelete,
    onClose,
    onSubmit,
  } = dialog;
  const isConsumableEditLocked =
    editingConsumable !== null &&
    !isOrderEditableByRole(editingConsumable.status, isAdmin);

  return (
    <Dialog
      open={editingConsumable !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>编辑耗材订单</span>
            {isConsumableEditLocked ? (
              <span className="text-base text-muted-foreground">
                当前状态不可编辑
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <BaseForm
            form={consumableForm}
            fields={getConsumableOrderFormFields()}
            disabled={isConsumableEditLocked}
          />
          <EditDialogActions
            mode="edit"
            onCancel={onClose}
            onDelete={onDelete}
            submitLabelEdit="保存"
            submitLabelAdd="保存"
            isSubmitting={isSubmittingConsumable}
            disableSubmit={isConsumableEditLocked}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const consumableColumnHelper = createColumnHelper<DashboardConsumableOrder>();

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

function renderConsumableTimeAlertBadges(
  item: DashboardConsumableOrder,
  managementMode: boolean,
) {
  return (
    <>
      {managementMode && isPendingApprovalOverdue(item.status, item.updated_at)
        ? renderAlertBadge("超时", "审批超时")
        : null}
      {isApprovedOrderOverdue(item.status, item.updated_at)
        ? renderAlertBadge("超时", "收货超时", "warning")
        : null}
    </>
  );
}

function createConsumableDashboardAPI(
  currentUserId: number | undefined,
  managementMode: boolean,
): FilterAPI {
  return {
    list: async (params) => {
      const response = managementMode
        ? await consumableOrderAPI.getAdminConsumableOrders()
        : await consumableOrderAPI.getMyConsumableOrders();
      const grouped = (response.data?.data ?? {}) as Record<
        string,
        { orders: Record<string, unknown>[] }
      >;
      const rows = flattenGroupedOrders<DashboardConsumableOrder>(
        grouped,
        managementMode ? undefined : currentUserId,
      );
      const local = buildLocalListData(rows, params as DashboardParams, [
        "name",
        "specification",
        "created_at",
        ...(managementMode ? ["applicant_name"] : []),
      ]);
      return { data: local };
    },
  };
}

function createConsumableColumns({
  currentUserId,
  currentUserRole,
  isAdmin,
  managementMode,
  refreshTables,
  onEdit,
}: Readonly<{
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
  isAdmin: boolean;
  managementMode: boolean;
  refreshTables: () => Promise<void>;
  onEdit: (item: DashboardConsumableOrder) => void;
}>): ColumnDef<Record<string, unknown>, unknown>[] {
  const orderColumns = getConsumableOrderTableColumns() as ColumnDef<
    Record<string, unknown>,
    unknown
  >[];
  const baseColumns = managementMode
    ? orderColumns
    : removeApplicantColumn(orderColumns);
  const columns = [...baseColumns];
  const createdAtColumnIndex = findDashboardColumnIndex(columns, "created_at");
  if (createdAtColumnIndex >= 0) {
    columns[createdAtColumnIndex] = consumableColumnHelper.accessor("created_at", {
      header: "申购时间",
      size: 190,
      minSize: 160,
      maxSize: 240,
      cell: (info) => {
        const item = info.row.original as DashboardConsumableOrder;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span>{formatDate(info.getValue() as string)}</span>
            {renderConsumableTimeAlertBadges(item, managementMode)}
          </div>
        );
      },
    }) as ColumnDef<Record<string, unknown>, unknown>;
  }
  const statusColumnIndex = findDashboardColumnIndex(columns, "status");
  if (!managementMode && statusColumnIndex >= 0) {
    columns[statusColumnIndex] = consumableColumnHelper.accessor("status", {
      header: "状态",
      size: 150,
      minSize: 120,
      maxSize: 180,
      cell: (info) => {
        const item = info.row.original as DashboardConsumableOrder;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge
              status={String(info.getValue() ?? "")}
              order={item}
              kind="consumable"
            />
          </div>
        );
      },
    }) as ColumnDef<Record<string, unknown>, unknown>;
  }
  const personalActions = [
    {
      id: "confirm-complete",
      label: "确认收货",
      confirm: true,
      confirmLabel: "确认",
      showWhen: (currItem: DashboardConsumableOrder) =>
        currItem.status === ConsumableOrderStatus.APPROVED,
      onClick: async (currItem: DashboardConsumableOrder) => {
        await consumableOrderAPI.complete(currItem.id);
        await refreshTables();
        toast.success("已确认收货");
      },
    },
  ];
  const managementActions = [
    {
      id: "approve",
      label: "审批",
      icon: <Check className="size-4.5" />,
      variant: "modern" as const,
      className:
        "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950",
      confirm: true,
      confirmLabel: "确认审批",
      disableWhen: (currItem: DashboardConsumableOrder) =>
        !isApprovableOrderStatus(currItem.status),
      onClick: async (currItem: DashboardConsumableOrder) => {
        await consumableOrderAPI.approve(currItem.id);
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
      disableWhen: (currItem: DashboardConsumableOrder) =>
        !isRejectableOrderStatus(currItem.status),
      onClick: async (currItem: DashboardConsumableOrder) => {
        await consumableOrderAPI.reject(currItem.id, "管理员驳回");
        await refreshTables();
        toast.success("已驳回");
      },
    },
  ];
  const actions = managementMode ? managementActions : personalActions;
  const actionColumn = consumableColumnHelper.display({
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
          onEdit={(target) => onEdit(target as DashboardConsumableOrder)}
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

// 仪表盘中的耗材订单页签，承载本地筛选、编辑和确认收货流程。

export function DashboardConsumableTab({
  managementMode = false,
}: Readonly<{ managementMode?: boolean }>) {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === UserRoles.ADMIN;
  const queryClient = useQueryClient();

  const consumableForm = useForm<
    ConsumableOrderFormInputData,
    unknown,
    ConsumableOrderFormData
  >({
    resolver: createValibotResolver(ConsumableOrderSchema),
    defaultValues: defaultConsumableOrderValues,
    shouldFocusError: false,
  });

  const refreshTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: managementMode
          ? ["dashboard", "admin", "consumables"]
          : ["dashboard", "consumables"],
      }),
      queryClient.invalidateQueries({ queryKey: ["consumable-orders"] }),
      refreshDashboardAfterMutation(queryClient),
    ]);
  }, [managementMode, queryClient]);

  const consumableDashboardAPI = useMemo(
    () => createConsumableDashboardAPI(currentUser?.id, managementMode),
    [currentUser?.id, managementMode],
  );
  const { handleConsumableEdit, consumableEditDialog } =
    useDashboardConsumableDialogController({
      consumableForm,
      currentUserId: currentUser?.id,
      currentUserRole: currentUser?.role,
      isAdmin,
      refreshTables,
    });

  const consumableColumns = useMemo(
    () =>
      createConsumableColumns({
        currentUserId: currentUser?.id,
        currentUserRole: currentUser?.role,
        isAdmin,
        managementMode,
        refreshTables,
        onEdit: (item) =>
          handleConsumableEdit(item as unknown as Record<string, unknown>),
      }),
    [
      currentUser?.id,
      currentUser?.role,
      handleConsumableEdit,
      isAdmin,
      managementMode,
      refreshTables,
    ],
  );

  return (
    <>
      <FilterTable
        api={consumableDashboardAPI}
        queryKey={managementMode ? ["dashboard", "admin", "consumables"] : ["dashboard", "consumables"]}
        tableId={managementMode ? "dashboard-admin-consumable-orders" : "dashboard-consumable-orders"}
        realtime={{
          room: "consumable_orders",
          eventTypes: CONSUMABLE_ORDER_SSE_EVENTS,
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
        customColumns={consumableColumns}
        statusOptions={CONSUMABLE_STATUS_OPTIONS}
        searchFieldOptions={
          managementMode
            ? DASHBOARD_CONSUMABLE_ADMIN_SEARCH_FIELDS
            : DASHBOARD_CONSUMABLE_SEARCH_FIELDS
        }
        searchPlaceholder={
          managementMode
            ? "搜索名称、规格、订购人、订购时间..."
            : "搜索名称、规格、订购时间..."
        }
        title={
          <>
            <ShoppingCart className="w-5 h-5" />
            {managementMode ? "活跃耗材订单" : "我的耗材订单"}
          </>
        }
        noteField="notes"
        enableExpandAll={true}
        renderExpandedRow={(itemRaw) => {
          const item = itemRaw as unknown as DashboardConsumableOrder;
          return <ConsumableOrderExpandedRow item={item} />;
        }}
      />
      <DashboardConsumableEditDialog dialog={consumableEditDialog} isAdmin={isAdmin} />
    </>
  );
}
