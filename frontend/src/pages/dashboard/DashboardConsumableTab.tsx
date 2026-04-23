// 仪表盘中的耗材订单页签，承载本地筛选、编辑和确认收货流程。
import { useMemo, useState, useCallback } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AlertTriangle, Check, ShoppingCart, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { FilterTable } from "@/components/ui/FilterTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableActionButtonsMemo } from "@/components/TableActionButtons";
import { BaseForm } from "@/components/BaseForm";
import { EditDialogActions } from "@/components/EditDialogActions";
import { ConsumableOrderExpandedRow } from "@/components/ConsumableOrderExpandedRow";
import { toast } from "@/lib/toast";
import { formatDate, processNotes, toText } from "@/lib/utils";
import { UserRoles } from "@/lib/constants";
import { useAuthStore } from "@/store/useStore";

import { consumableOrderAPI, ConsumableOrderStatus } from "@/api/client";
import type { FilterAPI } from "@/hooks/useTableState";
import { getConsumableOrderTableColumns } from "@/lib/tableConfigs";
import { CONSUMABLE_ORDER_SSE_EVENTS } from '@/lib/sseEvents'
import {
  isApprovableOrderStatus,
  isOrderEditableByRole,
  isRejectableOrderStatus,
} from "@/lib/orderEditRules";
import {
  ConsumableOrderSchema,
  createValibotResolver,
  extractApiErrorDetail,
  getApiErrorMessage,
  toValidationErrors,
  normalizeApiErrorMessage,
} from "@/lib/validationSchemas";
import type {
  ConsumableOrderFormData,
  ConsumableOrderFormInputData,
} from "@/lib/validationSchemas";
import {
  getConsumableOrderFormFields,
  defaultConsumableOrderValues,
} from "@/lib/formConfigs";

import {
  type DashboardConsumableOrder,
  type DashboardParams,
  CONSUMABLE_STATUS_OPTIONS,
  DASHBOARD_CONSUMABLE_SEARCH_FIELDS,
  DASHBOARD_CONSUMABLE_ADMIN_SEARCH_FIELDS,
  buildLocalListData,
  flattenGroupedOrders,
  isApprovedOrderOverdue,
  isPendingApprovalOverdue,
  removeApplicantColumn,
  requestDashboardCountsRefresh,
} from "../../lib/dashboardUtils";

const consumableColumnHelper = createColumnHelper<DashboardConsumableOrder>();

function renderAlertBadge(label: string, title: string) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      title={title}
      aria-label={title}
    >
      <AlertTriangle className="size-3" />
      {label}
    </span>
  );
}

// Dashboard 接口返回分组订单，这里先拍平成 `FilterTable` 可消费的本地列表结构。
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

// `public` 账户永远不能编辑，非管理员只能编辑本人订单；返回值直接复用为提示文案。
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

// 把后端可空字段收口成 RHF 可控输入默认值，避免编辑弹窗拿到 `undefined` 或 `null`。
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

// “我的耗材订单”会移除申请人列；仅 `approved` 状态显示确认收货，编辑按钮按角色和归属禁用。
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
  const createdAtColumnIndex = columns.findIndex((column) => column.id === "created_at");
  if (managementMode && createdAtColumnIndex >= 0) {
    columns[createdAtColumnIndex] = consumableColumnHelper.accessor("created_at", {
      header: "申购时间",
      size: 190,
      minSize: 160,
      maxSize: 240,
      cell: (info) => {
        const item = info.row.original as DashboardConsumableOrder;
        return (
          <div className="flex items-center gap-2">
            <span>{formatDate(info.getValue() as string)}</span>
            {isPendingApprovalOverdue(item.status, item.created_at)
              ? renderAlertBadge("超时", "已超时")
              : null}
          </div>
        );
      },
    }) as ColumnDef<Record<string, unknown>, unknown>;
  }
  const statusColumnIndex = columns.findIndex((column) => column.id === "status");
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
            <StatusBadge status={String(info.getValue() ?? "")} />
            {isApprovedOrderOverdue(item.status, item.updated_at)
              ? renderAlertBadge("超期", "确认收货超期")
              : null}
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

// 仅待审批和已驳回状态允许保存编辑。
function DashboardConsumableEditDialog({
  dialog,
  isAdmin,
}: Readonly<{
  dialog: {
    editingConsumable: DashboardConsumableOrder | null;
    deleteConfirm: boolean;
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
    deleteConfirm,
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
            deleteConfirm={deleteConfirm}
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

// 编辑弹窗的状态与副作用独立管理，避免页面主函数同时承担列表和弹窗编排。
function useDashboardConsumableDialogController({
  consumableForm,
  currentUserId,
  currentUserRole,
  isAdmin,
  refreshTables,
}: Readonly<{
  consumableForm: ReturnType<
    typeof useForm<
      ConsumableOrderFormInputData,
      unknown,
      ConsumableOrderFormData
    >
  >;
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
  isAdmin: boolean;
  refreshTables: () => Promise<void>;
}>) {
  const [editingConsumable, setEditingConsumable] =
    useState<DashboardConsumableOrder | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isSubmittingConsumable, setIsSubmittingConsumable] = useState(false);

  // 打开编辑前先做权限拦截，拦截失败直接 toast，不进入弹窗状态。
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
      setDeleteConfirm(false);
      consumableForm.reset(buildConsumableFormValues(item));
    },
    [consumableForm, currentUserId, currentUserRole, isAdmin],
  );

  // 提交成功后同时失效 Dashboard 列表和订单列表缓存；字段级校验错误回填表单而不是 toast。
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
      setDeleteConfirm(false);
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
              message: e.msg || "输入不合法",
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

  // 删除采用两段式确认：第一次只切确认态，第二次才真正调用删除接口。
  const handleDeleteConsumable = useCallback(async () => {
    if (!editingConsumable) return;

    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    try {
      await consumableOrderAPI.delete(editingConsumable.id);
      setDeleteConfirm(false);
      setEditingConsumable(null);
      consumableForm.reset(defaultConsumableOrderValues);
      await refreshTables();
      toast.success("耗材订单已删除");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除失败"));
    }
  }, [consumableForm, deleteConfirm, editingConsumable, refreshTables]);

  // 关闭弹窗时同时清理 `editingConsumable`、`deleteConfirm` 和表单默认值。
  const closeConsumableDialog = useCallback(() => {
    setEditingConsumable(null);
    setDeleteConfirm(false);
    consumableForm.reset(defaultConsumableOrderValues);
  }, [consumableForm]);

  return {
    handleConsumableEdit,
    consumableEditDialog: {
      editingConsumable,
      deleteConfirm,
      consumableForm,
      isSubmittingConsumable,
      onDelete: handleDeleteConsumable,
      onClose: closeConsumableDialog,
      onSubmit: submitConsumableEdit,
    },
  };
}

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
    ]);
    requestDashboardCountsRefresh();
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
          room: 'consumable_orders',
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
