import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  BadgeDollarSign,
  Boxes,
  ClipboardList,
  FlaskConical,
  Info,
  Megaphone,
  MonitorCheck,
  Package,
  PackageCheck,
  ShoppingCart,
  Users,
} from "lucide-react";

import { AnnouncementDetail } from "@/components/AnnouncementDetail";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Pagination, PaginationInfo } from "@/components/ui/Pagination";
import { QuantityIndicator } from "@/components/ui/QuantityIndicator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Slider } from "@/components/ui/Slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import {
  dashboardAPI,
  type AdminDashboardPanelItem,
  type AdminDashboardSummary,
  type AdminDashboardWindowStats,
  type Announcement,
  type DashboardAdminSection,
  type DashboardBoardSection,
  type DashboardBoardSummary,
  type PaginatedResponse,
  type PaginationParams,
} from "@/api/client";
import type { DashboardTab } from "@/lib/dashboardUtils";
import { cn, formatDate, formatDisplayDate } from "@/lib/utils";

import { DashboardConsumableTab } from "./DashboardConsumableTab";
import { DashboardReagentTab } from "./DashboardReagentTab";
import { DashboardBorrowTab, DashboardStockinTab } from "./dashboardInventoryTabs";
import {
  ADMIN_SUMMARY_GC_TIME_MS,
  ADMIN_SUMMARY_STALE_TIME_MS,
  DASHBOARD_SECTION_DETAIL_QUERY_KEY,
  DASHBOARD_WINDOW_MAX_DAYS,
  DASHBOARD_WINDOW_MIN_DAYS,
  clampDashboardWindowDays,
  type DashboardCardItem,
  type DashboardMode,
  type DashboardModeSwitchVariant,
  type ManagementCardItem,
} from "./dashboardData";

type PanelTone = "high" | "alert" | "medium" | "warning" | "success" | "sky" | "violet" | "low" | "neutral";

function getPanelToneClassName(tone?: PanelTone) {
  if (tone === "high" || tone === "alert") {
    return "bg-destructive/10 text-destructive";
  }
  if (tone === "medium" || tone === "warning") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (tone === "success") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (tone === "sky") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (tone === "violet") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  }
  return "bg-muted text-muted-foreground";
}

function DashboardBadge({
  tone,
  icon: Icon,
  children,
}: Readonly<{
  tone?: PanelTone;
  icon?: React.ElementType;
  children: React.ReactNode;
}>) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-normal leading-6",
        getPanelToneClassName(tone),
      )}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {children}
    </span>
  );
}

function DashboardTimeCell({ text }: Readonly<{ text: string }>) {
  return (
    <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
      {text}
    </td>
  );
}

function DashboardBadgeCell({
  tone,
  children,
}: Readonly<{
  tone?: PanelTone;
  children: React.ReactNode;
}>) {
  return (
    <td className="px-2 py-3.5">
      <DashboardBadge tone={tone}>{children}</DashboardBadge>
    </td>
  );
}

function getSeverityLabel(severity?: string) {
  if (severity === "high") {
    return "高";
  }
  if (severity === "medium" || severity === "warning") {
    return "中";
  }
  if (severity === "success") {
    return "正常";
  }
  return "提示";
}

function getPanelTimeText(createdAt?: string) {
  return createdAt ? formatDisplayDate(createdAt) : "-";
}

function getAnnouncementPanelTimeText(updatedAt?: string) {
  return updatedAt ? formatDate(updatedAt) : "-";
}

function getManagementRowInteraction(
  item: AdminDashboardPanelItem,
  onTabChange?: (tab: DashboardTab) => void,
  onActivate?: () => void,
) {
  const tab = item.tab;
  const activate =
    onActivate ??
    (tab && onTabChange ? () => onTabChange(tab as DashboardTab) : undefined);

  if (!activate) {
    return { className: "transition-colors hover:bg-muted/40" };
  }

  return {
    role: "button",
    tabIndex: 0,
    className:
      "cursor-pointer transition-colors hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-none",
    onClick: activate,
    onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    },
  };
}

const DASHBOARD_LABEL_TEXT_BY_CODE: Record<string, string> = {
  "stock_alert.inventory_low": "库存低量",
  "stock_alert.common_shelf_low": "常用低量",
  "todo.reagent_order_pending_approval": "待审批试剂订单",
  "todo.consumable_order_pending_approval": "待审批耗材订单",
  "risk.order_timeout": "订单超时",
  "risk.reagent_order_approval_timeout": "审批超时",
  "risk.consumable_order_approval_timeout": "审批超时",
  "risk.reagent_order_unarrived": "到货超时",
  "risk.consumable_order_unconfirmed": "收货超时",
  "risk.borrow_overdue": "借用超时",
  "risk.pending_stockin_overdue": "暂存超时",
  "system_status.active_users": "启用用户",
  "system_status.active_sessions": "有效会话",
  "system_status.active_users_today": "今日活跃",
  "board.order_overview.reagent_order": "试剂",
  "board.order_overview.consumable_order": "耗材",
  "board.action.reagent_order_arrived_pending_confirm": "待确认到货",
  "board.action.consumable_order_arrived_pending_confirm": "待确认耗材",
  "board.action.borrow_overdue": "借用超时",
  "board.recent.reagent_order_arrived": "试剂到货",
  "board.recent.consumable_order_completed": "耗材到货",
  "board.recent.inventory_stocked": "订单入库",
};

const DASHBOARD_IMPACT_TEXT_BY_CODE: Record<string, string> = {
  "order_status.pending": "待审批",
  "order_status.approved": "已批准",
  "order_status.rejected": "已驳回",
  "announcement.pinned": "置顶",
  "announcement.normal": "公告",
};

const MANAGEMENT_ACTION_LABEL_SUFFIX_BY_CODE: Record<string, string> = {
  "management_action.reagent_order_reviewed": "处理试剂订单",
  "management_action.consumable_order_reviewed": "处理耗材订单",
  "management_action.inventory_stocked": "完成入库",
  "management_action.common_shelf_updated": "更新常用货架",
  "management_action.other": "处理事项",
};

function joinDashboardDetailParts(
  ...parts: Array<string | null | undefined>
): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function getDashboardItemCode(
  item: AdminDashboardPanelItem,
): string | undefined {
  return item.codes?.label_code ?? undefined;
}

function getDashboardPanelItemKey(
  item: AdminDashboardPanelItem,
  index: number,
  scope: string,
): string {
  const code = getDashboardItemCode(item) ?? item.entity?.entity_type ?? "dashboard-item";
  const entityType = item.entity?.entity_type ?? "";
  const entityId = item.entity?.entity_id;
  if (entityType && entityId !== null && entityId !== undefined && entityId !== "") {
    return `${scope}-${code}-${entityType}-${entityId}`;
  }

  return `${scope}-${code}-${item.tab ?? ""}-${item.created_at ?? ""}-${index}`;
}

function getDashboardItemImpactCode(item: AdminDashboardPanelItem): string | undefined {
  return item.codes?.impact_code ?? undefined;
}

function isDashboardRiskCode(code: string | undefined): boolean {
  return code?.startsWith("risk.") ?? false;
}

function getDashboardRiskThresholdSuffix(item: AdminDashboardPanelItem): string {
  return typeof item.metrics?.threshold_days === "number"
    ? `（满 ${item.metrics.threshold_days} 天）`
    : "";
}

function getDashboardEntityName(item: AdminDashboardPanelItem): string {
  return (
    item.entity?.preferred_name?.trim() ||
    item.entity?.name?.trim() ||
    item.detail ||
    ""
  );
}

function getDashboardEntitySpecification(item: AdminDashboardPanelItem): string {
  return item.entity?.specification?.trim() || "";
}

function getManagementActionLabelText(item: AdminDashboardPanelItem): string | undefined {
  const code = getDashboardItemCode(item);
  if (!code) {
    return undefined;
  }
  const suffix = MANAGEMENT_ACTION_LABEL_SUFFIX_BY_CODE[code];
  return suffix ? `${item.entity?.actor_name || "系统"}${suffix}` : undefined;
}

function getDashboardItemLabelText(item: AdminDashboardPanelItem): string {
  const managementActionLabel = getManagementActionLabelText(item);
  if (managementActionLabel) {
    return managementActionLabel;
  }

  const code = getDashboardItemCode(item);
  if (code === "board.announcement") {
    return getDashboardItemImpactCode(item) === "announcement.pinned" ? "置顶公告" : "公告";
  }
  const label = (code && DASHBOARD_LABEL_TEXT_BY_CODE[code]) || code || "-";
  return isDashboardRiskCode(code) ? `${label}${getDashboardRiskThresholdSuffix(item)}` : label;
}

function getDashboardRiskCategoryText(item: AdminDashboardPanelItem): string {
  const code = getDashboardItemCode(item);
  return (code && DASHBOARD_LABEL_TEXT_BY_CODE[code]) || code || "-";
}

function getDashboardRiskNameText(item: AdminDashboardPanelItem): string {
  return getDashboardEntityName(item) || item.detail || "-";
}

function getDashboardItemImpactText(
  item: AdminDashboardPanelItem,
): string | undefined {
  const code = getDashboardItemImpactCode(item);
  return (code && DASHBOARD_IMPACT_TEXT_BY_CODE[code]) || item.impact || undefined;
}

function getDashboardItemQuantityText(item: AdminDashboardPanelItem): string {
  return typeof item.entity?.quantity === "number" ? String(item.entity.quantity) : "";
}

function getDashboardStaticDetailText(
  code: string | undefined,
  item: AdminDashboardPanelItem,
  name: string,
  specification: string,
): string | undefined {
  if (code === "stock_alert.inventory_low") {
    return joinDashboardDetailParts(name, item.entity?.cas_number || "");
  }
  if (code === "stock_alert.common_shelf_low") {
    return joinDashboardDetailParts(name, item.entity?.brand || "", specification);
  }
  if (code === "todo.reagent_order_pending_approval") {
    return joinDashboardDetailParts(name, item.entity?.cas_number || "");
  }
  if (code === "todo.consumable_order_pending_approval") {
    return joinDashboardDetailParts(name, specification || item.entity?.unit || "-");
  }
  return undefined;
}

function getDashboardBoardActionDetailText(
  code: string | undefined,
  item: AdminDashboardPanelItem,
  name: string,
  specification: string,
): string | undefined {
  const quantityText = getDashboardItemQuantityText(item) || "0";
  if (code === "board.action.reagent_order_arrived_pending_confirm") {
    return `${joinDashboardDetailParts(name, item.entity?.cas_number || "", specification || "-")} × ${quantityText}`;
  }
  if (code === "board.action.consumable_order_arrived_pending_confirm") {
    return `${joinDashboardDetailParts(name, specification || item.entity?.unit || "-")} × ${quantityText}`;
  }
  if (code === "board.action.borrow_overdue") {
    return joinDashboardDetailParts(name, item.entity?.cas_number || "", specification || "-");
  }
  return undefined;
}

function isDashboardNameOnlyDetail(code: string | undefined): boolean {
  return [
    "management_action.reagent_order_reviewed",
    "management_action.consumable_order_reviewed",
    "management_action.inventory_stocked",
    "management_action.common_shelf_updated",
    "board.order_overview.reagent_order",
    "board.order_overview.consumable_order",
    "board.recent.reagent_order_arrived",
    "board.recent.consumable_order_completed",
    "board.recent.inventory_stocked",
    "board.announcement",
  ].includes(code || "");
}

function getDashboardItemDetailText(item: AdminDashboardPanelItem): string {
  const code = getDashboardItemCode(item);
  const name = getDashboardEntityName(item);
  const specification = getDashboardEntitySpecification(item);

  const staticDetail = getDashboardStaticDetailText(code, item, name, specification);
  if (staticDetail) {
    return staticDetail;
  }

  const boardActionDetail = getDashboardBoardActionDetailText(code, item, name, specification);
  if (boardActionDetail) {
    return boardActionDetail;
  }

  if (isDashboardNameOnlyDetail(code)) {
    return name || item.detail;
  }

  return item.detail;
}

function ManagementPanelSection({
  title,
  titleSuffix,
  icon: Icon,
  headerAction,
  children,
}: Readonly<{
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0 pb-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
            <Icon className="size-5 shrink-0 text-primary" />
            <span>{title}</span>
            {titleSuffix}
          </CardTitle>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

function EmptyPanelText({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="px-1 py-4 text-base leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

type ManagementTableHeader = {
  label: string;
  className?: string;
};

function ManagementTableShell({
  children,
  emptyText,
  headers,
  items,
  minWidthClassName,
}: Readonly<{
  children: React.ReactNode;
  emptyText: string;
  headers: ManagementTableHeader[];
  items: readonly unknown[];
  minWidthClassName: string;
}>) {
  if (items.length === 0) {
    return <EmptyPanelText>{emptyText}</EmptyPanelText>;
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={cn("w-full table-fixed border-collapse", minWidthClassName)}>
        <thead>
          <tr className="text-left text-base font-bold text-foreground">
            {headers.map((header, index) => (
              <th
                key={`${header.label}-${index}`}
                className={cn("px-2 py-3 leading-6", header.className)}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

function hasInventoryStockQuantity(
  item: AdminDashboardPanelItem,
): item is AdminDashboardPanelItem & {
  remaining_quantity: number;
  initial_quantity: number;
} {
  return (
    item.alert_kind === "inventory" &&
    typeof item.remaining_quantity === "number" &&
    typeof item.initial_quantity === "number"
  );
}

function getStockAlertRemainingText(item: AdminDashboardPanelItem): string | null {
  if (item.alert_kind === "common_shelf" && typeof item.count === "number") {
    return `剩 ${item.count} 瓶`;
  }

  return null;
}

function getDashboardItemCount(item: AdminDashboardPanelItem): number | null {
  if (typeof item.count === "number") {
    return item.count;
  }
  if (typeof item.metrics?.count === "number") {
    return item.metrics.count;
  }
  return null;
}

function ManagementImpactCell({
  item,
}: Readonly<{ item: AdminDashboardPanelItem }>) {
  if (hasInventoryStockQuantity(item)) {
    return (
      <td className="px-2 py-3.5">
        <QuantityIndicator
          remaining={item.remaining_quantity}
          initial={item.initial_quantity}
          unit={item.unit ?? ""}
          specification={item.specification ?? undefined}
          className="h-8 text-base"
        />
      </td>
    );
  }

  const stockAlertRemainingText = getStockAlertRemainingText(item);
  if (stockAlertRemainingText) {
    return (
      <DashboardBadgeCell tone={item.severity}>
        {stockAlertRemainingText}
      </DashboardBadgeCell>
    );
  }

  const count = getDashboardItemCount(item);
  return (
    <DashboardBadgeCell tone={item.severity}>
      {getDashboardItemImpactText(item) ??
        (count !== null ? `${count} 项` : getSeverityLabel(item.severity))}
    </DashboardBadgeCell>
  );
}

function ManagementRiskTable({
  items,
  emptyText,
  onTabChange,
  impactHeaderLabel = "数量",
  showContent = true,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  emptyText: string;
  onTabChange?: (tab: DashboardTab) => void;
  impactHeaderLabel?: string;
  showContent?: boolean;
}>) {
  const headers = showContent
    ? [
        { label: "类型", className: "w-[18%]" },
        { label: "内容", className: "w-[42%]" },
        { label: impactHeaderLabel, className: "w-[16%]" },
        { label: "时间", className: "w-[24%]" },
      ]
    : [
        { label: "类型", className: "w-[45%]" },
        { label: impactHeaderLabel, className: "w-[25%]" },
        { label: "时间", className: "w-[30%]" },
      ];
  return (
    <ManagementTableShell
      emptyText={emptyText}
      headers={headers}
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item, index) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = showContent ? getDashboardItemDetailText(item) : "";
        return (
          <tr
            key={getDashboardPanelItemKey(item, index, "management-risk")}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <DashboardBadgeCell tone={item.severity}>
              {labelText}
            </DashboardBadgeCell>
            {showContent ? (
              <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            ) : null}
            <ManagementImpactCell item={item} />
            <DashboardTimeCell text={getPanelTimeText(item.created_at)} />
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

function ManagementRiskDetailTable({
  items,
  onTabChange,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <ManagementTableShell
      emptyText="当前没有明显风险提醒"
      headers={[
        { label: "类别", className: "w-[24%]" },
        { label: "名称", className: "w-[34%]" },
        { label: "人员", className: "w-[18%]" },
        { label: "时间", className: "w-[24%]" },
      ]}
      items={items}
      minWidthClassName="min-w-[760px]"
    >
      {items.map((item, index) => (
        <tr
          key={getDashboardPanelItemKey(item, index, "management-risk-detail")}
          {...getManagementRowInteraction(item, onTabChange)}
        >
          <DashboardBadgeCell tone={item.severity}>
            {getDashboardRiskCategoryText(item)}
          </DashboardBadgeCell>
          <td className="truncate px-2 py-4 text-base font-normal leading-6">
            {getDashboardRiskNameText(item)}
          </td>
          <td className="truncate px-2 py-4 text-base leading-6">
            {item.submitter_name || "-"}
          </td>
          <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
            {getPanelTimeText(item.created_at)}
          </td>
        </tr>
      ))}
    </ManagementTableShell>
  );
}

const BOARD_PANEL_PREVIEW_LIMIT = 5;
const BOARD_SECTION_DETAIL_PAGE_SIZE = 50;

type ExpandablePanelItemsRenderer = (
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) => React.ReactNode;

type DashboardSectionItemsFetcher = (
  params: Pick<PaginationParams, "skip" | "limit">,
) => Promise<{ data: PaginatedResponse<AdminDashboardPanelItem> }>;

type DashboardSectionDetailSource = Readonly<{
  queryKey: readonly string[];
  fetchItems: DashboardSectionItemsFetcher;
}>;

function getPanelCountSuffix(count: number) {
  return (
    <span className="font-normal text-muted-foreground">
      (&thinsp;{count}&thinsp;)
    </span>
  );
}

function ManagementPanelViewAllButton({
  onClick,
}: Readonly<{ onClick: () => void }>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-base font-normal text-primary"
      onClick={onClick}
    >
      查看全部 &gt;
    </Button>
  );
}

function DashboardPanelDetailDialog({
  children,
  onOpenChange,
  open,
  title,
  titleSuffix,
}: Readonly<{
  children: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  titleSuffix?: React.ReactNode;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[94vw] max-w-5xl md:w-[94vw]">
        <DialogHeader>
          <DialogTitle className="mb-4 pr-10">
            <span>{title}</span>
            {titleSuffix}
          </DialogTitle>
          <DialogCloseButton onClick={() => onOpenChange(false)} />
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function getBoardSectionTotalPages(total: number, pageSize: number) {
  return Math.max(Math.ceil(total / Math.max(pageSize, 1)), 1);
}

function BoardSectionDetailPagination({
  currentPage,
  isFetching,
  onPageChange,
  onPageSizeChange,
  pageSize,
  total,
}: Readonly<{
  currentPage: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSize: number;
  total: number;
}>) {
  const totalPages = getBoardSectionTotalPages(total, pageSize);
  const displayPage = Math.min(currentPage, totalPages);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
      <div className="flex items-center gap-2">
        <PaginationInfo currentPage={displayPage} pageSize={pageSize} total={total} />
        {isFetching ? (
          <span className="text-base text-muted-foreground">
            正在更新
          </span>
        ) : null}
      </div>
      <Pagination
        currentPage={displayPage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function ExpandablePanelDetailContent({
  currentPage,
  isError,
  isFetching,
  isLoading,
  items,
  onPageChange,
  onPageSizeChange,
  onTabChange,
  pageSize,
  renderItems,
  total,
  usePagination,
}: Readonly<{
  currentPage: number;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  items: AdminDashboardPanelItem[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onTabChange: (tab: DashboardTab) => void;
  pageSize: number;
  renderItems: ExpandablePanelItemsRenderer;
  total: number;
  usePagination: boolean;
}>) {
  if (isLoading) {
    return <EmptyPanelText>正在加载详情...</EmptyPanelText>;
  }
  if (isError && items.length === 0) {
    return <EmptyPanelText>详情加载失败，请稍后重试</EmptyPanelText>;
  }
  return (
    <>
      {renderItems(items, onTabChange)}
      {usePagination ? (
        <BoardSectionDetailPagination
          currentPage={currentPage}
          isFetching={isFetching}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSize={pageSize}
          total={total}
        />
      ) : null}
    </>
  );
}

function ExpandableManagementPanelSection({
  detailSource,
  icon,
  items,
  onTabChange,
  renderItems,
  title,
  totalCount,
}: Readonly<{
  detailSource?: DashboardSectionDetailSource;
  icon: React.ElementType;
  items: AdminDashboardPanelItem[];
  onTabChange: (tab: DashboardTab) => void;
  renderItems: ExpandablePanelItemsRenderer;
  title: string;
  totalCount?: number;
}>) {
  const [open, setOpen] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(BOARD_SECTION_DETAIL_PAGE_SIZE);
  const detailSkip = (detailPage - 1) * detailPageSize;
  const detailQuery = useQuery({
    queryKey: [
      ...DASHBOARD_SECTION_DETAIL_QUERY_KEY,
      ...(detailSource?.queryKey ?? []),
      detailSkip,
      detailPageSize,
    ],
    enabled: open && detailSource !== undefined,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (!detailSource) {
        return { data: [], total: 0, skip: 0, limit: detailPageSize };
      }
      const response = await detailSource.fetchItems({
        skip: detailSkip,
        limit: detailPageSize,
      });
      return response.data;
    },
  });
  const summaryTotalItems = totalCount ?? items.length;
  const totalItems = open && detailSource
    ? detailQuery.data?.total ?? summaryTotalItems
    : summaryTotalItems;
  const titleSuffix = getPanelCountSuffix(totalItems);
  const dialogItems = detailSource ? detailQuery.data?.data ?? [] : items;
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDetailPage(1);
    }
  }, []);
  const handleDetailPageSizeChange = useCallback((pageSize: number) => {
    setDetailPageSize(pageSize);
    setDetailPage(1);
  }, []);
  const handleDialogTabChange = useCallback((tab: DashboardTab) => {
    setOpen(false);
    onTabChange(tab);
  }, [onTabChange]);

  return (
    <>
      <ManagementPanelSection
        title={title}
        titleSuffix={titleSuffix}
        icon={icon}
        headerAction={
          <ManagementPanelViewAllButton onClick={() => handleOpenChange(true)} />
        }
      >
        {renderItems(items.slice(0, BOARD_PANEL_PREVIEW_LIMIT), onTabChange)}
      </ManagementPanelSection>
      <DashboardPanelDetailDialog
        open={open}
        title={title}
        titleSuffix={titleSuffix}
        onOpenChange={handleOpenChange}
      >
        <ExpandablePanelDetailContent
          currentPage={detailPage}
          isError={detailQuery.isError}
          isFetching={detailQuery.isFetching}
          isLoading={detailSource !== undefined && detailQuery.isLoading}
          items={dialogItems}
          onPageChange={setDetailPage}
          onPageSizeChange={handleDetailPageSizeChange}
          onTabChange={handleDialogTabChange}
          pageSize={detailPageSize}
          renderItems={renderItems}
          total={totalItems}
          usePagination={detailSource !== undefined}
        />
      </DashboardPanelDetailDialog>
    </>
  );
}

const BOARD_SECTION_ACTIONS: DashboardBoardSection = "actions";
const BOARD_SECTION_ORDERS: DashboardBoardSection = "orders";
const BOARD_SECTION_STOCK_ALERTS: DashboardBoardSection = "stockAlerts";
const ADMIN_SECTION_TODOS: DashboardAdminSection = "todos";
const ADMIN_SECTION_RISKS: DashboardAdminSection = "risks";
const ADMIN_SECTION_STOCK_ALERTS: DashboardAdminSection = "stockAlerts";

const BOARD_SECTION_DETAIL_SOURCES: Record<
  DashboardBoardSection,
  DashboardSectionDetailSource
> = {
  [BOARD_SECTION_ACTIONS]: {
    queryKey: ["board", BOARD_SECTION_ACTIONS],
    fetchItems: (params) => dashboardAPI.getBoardSectionItems(BOARD_SECTION_ACTIONS, params),
  },
  [BOARD_SECTION_ORDERS]: {
    queryKey: ["board", BOARD_SECTION_ORDERS],
    fetchItems: (params) => dashboardAPI.getBoardSectionItems(BOARD_SECTION_ORDERS, params),
  },
  [BOARD_SECTION_STOCK_ALERTS]: {
    queryKey: ["board", BOARD_SECTION_STOCK_ALERTS],
    fetchItems: (params) =>
      dashboardAPI.getBoardSectionItems(BOARD_SECTION_STOCK_ALERTS, params),
  },
};

const ADMIN_SECTION_DETAIL_SOURCES: Record<
  DashboardAdminSection,
  DashboardSectionDetailSource
> = {
  [ADMIN_SECTION_TODOS]: {
    queryKey: ["admin", ADMIN_SECTION_TODOS],
    fetchItems: (params) => dashboardAPI.getAdminSectionItems(ADMIN_SECTION_TODOS, params),
  },
  [ADMIN_SECTION_RISKS]: {
    queryKey: ["admin", ADMIN_SECTION_RISKS],
    fetchItems: (params) => dashboardAPI.getAdminSectionItems(ADMIN_SECTION_RISKS, params),
  },
  [ADMIN_SECTION_STOCK_ALERTS]: {
    queryKey: ["admin", ADMIN_SECTION_STOCK_ALERTS],
    fetchItems: (params) =>
      dashboardAPI.getAdminSectionItems(ADMIN_SECTION_STOCK_ALERTS, params),
  },
};

function getBoardAnnouncementLookupKey(title: string, createdAt?: string): string {
  return `${title}::${createdAt ?? ""}`;
}

function DashboardBoardItemTable({
  items,
  emptyText,
  onTabChange,
  showStatus = true,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  emptyText: string;
  onTabChange?: (tab: DashboardTab) => void;
  showStatus?: boolean;
}>) {
  return (
    <ManagementTableShell
      emptyText={emptyText}
      headers={
        showStatus
          ? [
              { label: "类型", className: "w-[18%]" },
              { label: "内容", className: "w-[42%]" },
              { label: "状态", className: "w-[16%]" },
              { label: "时间", className: "w-[24%]" },
            ]
          : [
              { label: "类型", className: "w-[18%]" },
              { label: "内容", className: "w-[58%]" },
              { label: "时间", className: "w-[24%]" },
            ]
      }
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item, index) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={getDashboardPanelItemKey(item, index, "board-item")}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <DashboardBadgeCell tone={item.severity}>
              {labelText}
            </DashboardBadgeCell>
            <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            {showStatus ? <ManagementImpactCell item={item} /> : null}
            <DashboardTimeCell text={getPanelTimeText(item.created_at)} />
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

const RECENT_ITEM_TONE: Record<string, PanelTone> = {
  "试剂到货": "sky",
  "订单入库": "success",
  "耗材到货": "violet",
};

function DashboardRecentItemsTable({
  items,
}: Readonly<{ items: AdminDashboardPanelItem[] }>) {
  return (
    <ManagementTableShell
      emptyText="暂无近期到货或入库记录"
      headers={[
        { label: "名称", className: "w-[56%]" },
        { label: "分类", className: "w-[20%]" },
        { label: "时间", className: "w-[24%]" },
      ]}
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item, index) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={getDashboardPanelItemKey(item, index, "recent-item")}
            className="transition-colors hover:bg-muted/40"
          >
            <td className="truncate px-2 py-4 text-base font-normal leading-6">
              {detailText}
            </td>
            <DashboardBadgeCell tone={RECENT_ITEM_TONE[labelText]}>
              {labelText}
            </DashboardBadgeCell>
            <DashboardTimeCell text={getPanelTimeText(item.created_at)} />
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

function DashboardBoardOverviewTable({
  items,
  onTabChange,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <ManagementTableShell
      emptyText="暂无订单概览"
      headers={[
        { label: "名称", className: "w-[40%]" },
        { label: "分类", className: "w-[18%]" },
        { label: "状态", className: "w-[18%]" },
        { label: "时间", className: "w-[24%]" },
      ]}
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item, index) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={getDashboardPanelItemKey(item, index, "board-overview")}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="truncate px-2 py-4 text-base font-normal leading-6">
              {detailText}
            </td>
            <td className="px-2 py-4 text-base leading-6">{labelText}</td>
            <ManagementImpactCell item={item} />
            <DashboardTimeCell text={getPanelTimeText(item.created_at)} />
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

function DashboardAnnouncementTable({
  items,
  announcements,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  announcements: Announcement[];
}>) {
  const [selectedAnnouncement, setSelectedAnnouncement] =
    useState<Announcement | null>(null);
  const announcementMap = useMemo(
    () =>
      new Map(
        announcements.map((announcement) => [
          getBoardAnnouncementLookupKey(announcement.title, announcement.updated_at),
          announcement,
        ]),
      ),
    [announcements],
  );
  const handleAnnouncementOpen = useCallback((item: AdminDashboardPanelItem) => {
    const announcementTitle = getDashboardItemDetailText(item);
    const announcement = announcementMap.get(
      getBoardAnnouncementLookupKey(announcementTitle, item.created_at),
    );
    if (announcement) {
      setSelectedAnnouncement(announcement);
    }
  }, [announcementMap]);

  return (
    <>
      <ManagementTableShell
        emptyText="暂无最新公告"
        headers={[
          { label: "标题", className: "w-[52%]" },
          { label: "发布人", className: "w-[20%]" },
          { label: "时间", className: "w-[28%]" },
        ]}
        items={items}
        minWidthClassName="min-w-[720px]"
      >
        {items.map((item, index) => {
          const detailText = getDashboardItemDetailText(item);
          const announcement = announcementMap.get(
            getBoardAnnouncementLookupKey(detailText, item.created_at),
          );

          return (
            <tr
              key={getDashboardPanelItemKey(item, index, "announcement")}
              {...getManagementRowInteraction(
                item,
                undefined,
                announcement ? () => handleAnnouncementOpen(item) : undefined,
              )}
            >
              <td className="truncate px-2 py-4 text-base font-normal leading-6">
                {detailText}
              </td>
              <td className="truncate px-2 py-4 text-base leading-6">
                {item.submitter_name || "-"}
              </td>
              <DashboardTimeCell text={getAnnouncementPanelTimeText(item.created_at)} />
            </tr>
          );
        })}
      </ManagementTableShell>

      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={selectedAnnouncement !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAnnouncement(null);
          }
        }}
      />
    </>
  );
}

type DashboardSystemSummary = {
  system_status: AdminDashboardPanelItem[];
  system_version?: string;
};

type SystemStatusDisplayItem = {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
};

const SYSTEM_STATUS_ICON_BY_CODE: Record<string, React.ElementType> = {
  "system_status.active_users": Users,
  "system_status.active_sessions": MonitorCheck,
  "system_status.active_users_today": Activity,
};

function formatCurrencyValue(value: number | undefined): string {
  if (typeof value !== "number") {
    return "-";
  }

  return `¥${value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  })}`;
}

function getWindowStatsLabel(windowStats: AdminDashboardWindowStats, text: string) {
  return windowStats.is_all_time
    ? `全部${text}`
    : `近${windowStats.recent_window_days}日${text}`;
}

function getSystemStatusDisplayItems(
  summary: DashboardSystemSummary,
  windowStats: AdminDashboardWindowStats,
  showWindowStatsFailureFallback: boolean,
): SystemStatusDisplayItem[] {
  const retainedItems = summary.system_status.map((item) => {
    const code = getDashboardItemCode(item) ?? "";
    return {
      label: getDashboardItemLabelText(item),
      value: item.value ?? item.metrics?.value ?? 0,
      icon: SYSTEM_STATUS_ICON_BY_CODE[code] ?? Package,
    };
  });
  const systemVersion = summary.system_version?.trim() || "-";

  return [
    ...retainedItems,
    {
      label: getWindowStatsLabel(windowStats, "试剂订单数"),
      value: windowStats.recent_reagent_order_count,
      icon: FlaskConical,
    },
    {
      label: getWindowStatsLabel(windowStats, "耗材订单数"),
      value: windowStats.recent_consumable_order_count,
      icon: Boxes,
    },
    {
      label: getWindowStatsLabel(windowStats, "到货数"),
      value: windowStats.recent_arrival_count,
      icon: PackageCheck,
    },
    {
      label: getWindowStatsLabel(windowStats, "入库记录数"),
      value: windowStats.stock_in_activity_count,
      icon: ArchiveRestore,
    },
    {
      label: getWindowStatsLabel(windowStats, "试剂订单总价值"),
      value: showWindowStatsFailureFallback
        ? "-"
        : formatCurrencyValue(windowStats.order_total_value),
      icon: BadgeDollarSign,
    },
    {
      label: "系统版本",
      value: systemVersion,
      icon: Info,
    },
  ];
}

function SystemStatusWindowControl({
  allTime,
  windowDays,
  onAllTimeChange,
  onWindowDaysChange,
}: Readonly<{
  allTime: boolean;
  windowDays: number;
  onAllTimeChange: (value: boolean) => void;
  onWindowDaysChange: (value: number) => void;
}>) {
  const handleSliderChange = (value: number[]) => {
    onWindowDaysChange(clampDashboardWindowDays(value[0] ?? windowDays));
  };
  const handleInputChange = (value: string) => {
    onWindowDaysChange(clampDashboardWindowDays(Number(value)));
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="shrink-0 text-sm font-normal text-muted-foreground">
        近
      </span>
      <Slider
        aria-label="统计天数"
        className="w-40 sm:w-52 lg:w-60"
        disabled={allTime}
        min={DASHBOARD_WINDOW_MIN_DAYS}
        max={DASHBOARD_WINDOW_MAX_DAYS}
        step={1}
        value={[windowDays]}
        onValueChange={handleSliderChange}
      />
      <div className="w-20 shrink-0">
        <Input
          aria-label="统计天数"
          className="h-8 text-right text-sm font-bold leading-8!"
          type="number"
          min={DASHBOARD_WINDOW_MIN_DAYS}
          max={DASHBOARD_WINDOW_MAX_DAYS}
          step={1}
          value={windowDays}
          disabled={allTime}
          onValueChange={handleInputChange}
          styles={{
            stepper: {
              wrapper:
                "absolute right-1 top-1/2 z-10 flex h-7 w-6 -translate-y-1/2 flex-col overflow-hidden rounded-sm bg-transparent",
              button:
                "flex h-3.5 items-center justify-center text-muted-foreground/50 transition-all hover:bg-accent/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30",
              icon: "size-3",
            },
          }}
        />
      </div>
      <span className="shrink-0 text-sm font-normal text-muted-foreground">
        天
      </span>
      <div className="ml-1 flex shrink-0 items-center gap-2">
        <Checkbox
          id="dashboard-window-all-time"
          checked={allTime}
          onCheckedChange={(value) => onAllTimeChange(value === true)}
        />
        <Label
          htmlFor="dashboard-window-all-time"
          className="cursor-pointer text-sm font-normal text-muted-foreground"
        >
          统计全部
        </Label>
      </div>
    </div>
  );
}

function SystemStatusGrid({
  summary,
  windowStats,
  showWindowStatsFailureFallback,
}: Readonly<{
  summary: DashboardSystemSummary;
  windowStats: AdminDashboardWindowStats;
  showWindowStatsFailureFallback: boolean;
}>) {
  const items = getSystemStatusDisplayItems(
    summary,
    windowStats,
    showWindowStatsFailureFallback,
  );

  if (items.length === 0) {
    return <EmptyPanelText>暂无运行状态数据</EmptyPanelText>;
  }

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-3">
      {items.map(({ icon: Icon, ...item }) => (
        <div
          key={item.label}
          className="relative min-h-28 min-w-0 overflow-hidden rounded-md border border-border/50 bg-muted/20 px-4 py-3.5 transition-colors hover:bg-muted/30"
        >
          <div className="relative z-10">
            <div className="break-words text-base font-normal leading-6 text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-3">
              <span className="break-all text-3xl font-bold leading-none text-foreground">
                {item.value}
              </span>
            </div>
          </div>
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-6 -right-5 size-24 rotate-[-18deg] text-[#edf2f7] dark:text-[#1b1f25]"
          />
        </div>
      ))}
    </div>
  );
}

// 统计卡片只负责展示标题、图标、数值和激活态，不参与数据获取或权限判断。
function StatCard({
  title,
  titleSuffix,
  icon: Icon,
  value,
  onClick,
  isActive,
  description,
}: Readonly<{
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  value: React.ReactNode;
  onClick?: () => void;
  isActive?: boolean;
  description?: string;
}>) {
  const isInteractive = typeof onClick === "function";
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <Card
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      className={cn(
        "transition-all",
        isInteractive && "cursor-pointer hover:bg-accent",
        isActive && "border bg-accent/70 dark:border-primary",
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
          <span>{title}</span>
          {titleSuffix}
        </CardTitle>
        <Icon
          className={cn(
            "h-4 w-4",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      </CardHeader>
      <CardContent>
        {description ? (
          <div className="flex h-8 items-center justify-between gap-3">
            <div
              className={cn(
                "flex min-w-0 items-center text-2xl font-bold",
                isActive && "text-primary",
              )}
            >
              {value}
            </div>
            <p className="shrink-0 text-base leading-none text-muted-foreground">
              {description}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "flex h-8 items-center text-2xl font-bold",
              isActive && "text-primary",
            )}
          >
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// `cards.length` 决定统计区网格列数，单卡片布局与多卡片布局沿用同一套点击行为。
function DashboardStats({
  cards,
  activeTab,
  onTabChange,
}: Readonly<{
  cards: DashboardCardItem[];
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <div
      className={cn(
        "grid gap-3",
        cards.length === 1
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-2 lg:grid-cols-4",
      )}
    >
      {cards.map((card) => (
        <StatCard
          key={card.tab}
          title={card.title}
          titleSuffix={card.titleSuffix}
          icon={card.icon}
          value={card.value}
          onClick={() => onTabChange(card.tab)}
          isActive={activeTab === card.tab}
        />
      ))}
    </div>
  );
}

function ManagementDashboardStats({
  activeTab,
  cards,
  onTabChange,
}: Readonly<{
  activeTab: DashboardTab | null;
  cards: ManagementCardItem[];
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const tab = card.tab;
        return (
          <StatCard
            key={card.title}
            title={card.title}
            titleSuffix={card.titleSuffix}
            icon={card.icon}
            value={card.value}
            description={card.description}
            onClick={tab ? () => onTabChange(tab) : undefined}
            isActive={tab !== undefined && activeTab === tab}
          />
        );
      })}
    </div>
  );
}

function renderBoardActionPanelItems(
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) {
  return (
    <DashboardBoardItemTable
      items={items}
      emptyText="当前没有需要处理的事项"
      onTabChange={onTabChange}
      showStatus={false}
    />
  );
}

function renderBoardOrderOverviewPanelItems(
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) {
  return <DashboardBoardOverviewTable items={items} onTabChange={onTabChange} />;
}

function DashboardBoardPanel({
  summary,
  announcements,
  summaryAllTime,
  windowStats,
  showWindowStatsFailureFallback,
  summaryWindowDays,
  onSummaryAllTimeChange,
  onSummaryWindowDaysChange,
  onTabChange,
}: Readonly<{
  summary: DashboardBoardSummary;
  announcements: Announcement[];
  summaryAllTime: boolean;
  windowStats: AdminDashboardWindowStats;
  showWindowStatsFailureFallback: boolean;
  summaryWindowDays: number;
  onSummaryAllTimeChange: (value: boolean) => void;
  onSummaryWindowDaysChange: (value: number) => void;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  const itemCounts = summary.item_counts;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ManagementPanelSection title="最新公告" icon={Megaphone}>
        <DashboardAnnouncementTable
          items={summary.announcement_items}
          announcements={announcements}
        />
      </ManagementPanelSection>
      <ManagementPanelSection
        title="系统运行状态"
        icon={Package}
        headerAction={
          <SystemStatusWindowControl
            allTime={summaryAllTime}
            windowDays={summaryWindowDays}
            onAllTimeChange={onSummaryAllTimeChange}
            onWindowDaysChange={onSummaryWindowDaysChange}
          />
        }
      >
        <SystemStatusGrid
          summary={summary}
          windowStats={windowStats}
          showWindowStatsFailureFallback={showWindowStatsFailureFallback}
        />
      </ManagementPanelSection>
      <ExpandableManagementPanelSection
        title="我的待处理"
        icon={ClipboardList}
        detailSource={BOARD_SECTION_DETAIL_SOURCES[BOARD_SECTION_ACTIONS]}
        items={summary.action_items}
        totalCount={itemCounts.action_items}
        onTabChange={onTabChange}
        renderItems={renderBoardActionPanelItems}
      />
      <ExpandableManagementPanelSection
        title="我的订单概览"
        icon={ShoppingCart}
        detailSource={BOARD_SECTION_DETAIL_SOURCES[BOARD_SECTION_ORDERS]}
        items={summary.order_overview_items}
        totalCount={itemCounts.order_overview_items}
        onTabChange={onTabChange}
        renderItems={renderBoardOrderOverviewPanelItems}
      />
      <ManagementPanelSection title="近期到货 / 入库" icon={PackageCheck}>
        <DashboardRecentItemsTable items={summary.recent_items} />
      </ManagementPanelSection>
      <ExpandableManagementPanelSection
        title="库存告警"
        icon={PackageCheck}
        detailSource={BOARD_SECTION_DETAIL_SOURCES[BOARD_SECTION_STOCK_ALERTS]}
        items={summary.stock_alert_items}
        totalCount={itemCounts.stock_alert_items}
        onTabChange={onTabChange}
        renderItems={renderStockAlertPanelItems}
      />
    </div>
  );
}

function PublicDashboardPanel({
  announcements,
  summary,
  summaryAllTime,
  windowStats,
  showWindowStatsFailureFallback,
  summaryWindowDays,
  onSummaryAllTimeChange,
  onSummaryWindowDaysChange,
}: Readonly<{
  announcements: Announcement[];
  summary: DashboardBoardSummary;
  summaryAllTime: boolean;
  windowStats: AdminDashboardWindowStats;
  showWindowStatsFailureFallback: boolean;
  summaryWindowDays: number;
  onSummaryAllTimeChange: (value: boolean) => void;
  onSummaryWindowDaysChange: (value: number) => void;
}>) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ManagementPanelSection title="最新公告" icon={Megaphone}>
        <DashboardAnnouncementTable
          items={summary.announcement_items}
          announcements={announcements}
        />
      </ManagementPanelSection>
      <ManagementPanelSection
        title="系统运行状态"
        icon={Package}
        headerAction={
          <SystemStatusWindowControl
            allTime={summaryAllTime}
            windowDays={summaryWindowDays}
            onAllTimeChange={onSummaryAllTimeChange}
            onWindowDaysChange={onSummaryWindowDaysChange}
          />
        }
      >
        <SystemStatusGrid
          summary={summary}
          windowStats={windowStats}
          showWindowStatsFailureFallback={showWindowStatsFailureFallback}
        />
      </ManagementPanelSection>
    </div>
  );
}

function ManagementTodoTable({
  items,
  onTabChange,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <ManagementTableShell
      emptyText="当前没有需要立即处理的事项"
      headers={[
        { label: "类型", className: "w-[18%]" },
        { label: "内容", className: "w-[38%]" },
        { label: "提交人", className: "w-[16%]" },
        { label: "时间", className: "w-[28%]" },
      ]}
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item, index) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={getDashboardPanelItemKey(item, index, "management-todo")}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="px-2 py-4 text-base font-normal leading-6">{labelText}</td>
            <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            <td className="truncate px-2 py-4 text-base leading-6 text-muted-foreground">
              {item.submitter_name || "-"}
            </td>
            <td className="px-2 py-4 text-base leading-6 text-muted-foreground">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span>{getPanelTimeText(item.created_at)}</span>
                {item.is_overdue ? (
                  <DashboardBadge tone="alert" icon={AlertTriangle}>超时</DashboardBadge>
                ) : null}
              </div>
            </td>
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

function renderManagementTodoPanelItems(
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) {
  return <ManagementTodoTable items={items} onTabChange={onTabChange} />;
}

function renderStockAlertPanelItems(
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) {
  return (
    <ManagementRiskTable
      items={items}
      emptyText="当前没有库存告警"
      impactHeaderLabel="剩余量"
      onTabChange={onTabChange}
    />
  );
}

function renderRiskPanelItems(
  items: AdminDashboardPanelItem[],
  onTabChange: (tab: DashboardTab) => void,
) {
  return <ManagementRiskDetailTable items={items} onTabChange={onTabChange} />;
}

function ManagementDashboardPanel({
  summary,
  summaryAllTime,
  windowStats,
  showWindowStatsFailureFallback,
  summaryWindowDays,
  onSummaryAllTimeChange,
  onSummaryWindowDaysChange,
  onTabChange,
}: Readonly<{
  summary: AdminDashboardSummary;
  summaryAllTime: boolean;
  windowStats: AdminDashboardWindowStats;
  showWindowStatsFailureFallback: boolean;
  summaryWindowDays: number;
  onSummaryAllTimeChange: (value: boolean) => void;
  onSummaryWindowDaysChange: (value: number) => void;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <ExpandableManagementPanelSection
          title="待处理事项"
          icon={ClipboardList}
          items={summary.todo_items}
          detailSource={ADMIN_SECTION_DETAIL_SOURCES[ADMIN_SECTION_TODOS]}
          totalCount={summary.item_counts.todo_items}
          onTabChange={onTabChange}
          renderItems={renderManagementTodoPanelItems}
        />
        <ExpandableManagementPanelSection
          title="库存告警"
          icon={PackageCheck}
          items={summary.stock_alert_items}
          detailSource={ADMIN_SECTION_DETAIL_SOURCES[ADMIN_SECTION_STOCK_ALERTS]}
          totalCount={summary.item_counts.stock_alert_items}
          onTabChange={onTabChange}
          renderItems={renderStockAlertPanelItems}
        />
      </div>
      <div className="min-w-0 space-y-4">
        <ExpandableManagementPanelSection
          title="风险提醒"
          icon={AlertTriangle}
          items={summary.risk_items}
          detailSource={ADMIN_SECTION_DETAIL_SOURCES[ADMIN_SECTION_RISKS]}
          totalCount={summary.item_counts.risk_items}
          onTabChange={onTabChange}
          renderItems={renderRiskPanelItems}
        />
        <ManagementPanelSection
          title="系统运行状态"
          icon={Package}
          headerAction={
            <SystemStatusWindowControl
              allTime={summaryAllTime}
              windowDays={summaryWindowDays}
              onAllTimeChange={onSummaryAllTimeChange}
              onWindowDaysChange={onSummaryWindowDaysChange}
            />
          }
        >
          <SystemStatusGrid
            summary={summary}
            windowStats={windowStats}
            showWindowStatsFailureFallback={showWindowStatsFailureFallback}
          />
        </ManagementPanelSection>
      </div>
    </div>
  );
}

function ManagementDashboardTable({
  activeTab,
}: Readonly<{ activeTab: DashboardTab | null }>) {
  if (activeTab === "reagents") {
    return <DashboardReagentTab managementMode />;
  }
  if (activeTab === "consumables") {
    return <DashboardConsumableTab managementMode />;
  }
  if (activeTab === "borrows") {
    return <DashboardBorrowTab managementMode />;
  }
  if (activeTab === "stockin") {
    return <DashboardStockinTab managementMode />;
  }
  return null;
}

function DashboardModeSwitch({
  mode,
  onModeChange,
  variant,
}: Readonly<{
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  variant: DashboardModeSwitchVariant;
}>) {
  const secondaryMode = variant === "admin" ? "management" : "board";
  const secondaryLabel = variant === "admin" ? "管理模式" : "看板";
  const secondaryTooltip =
    mode === secondaryMode ? `再次点击${secondaryLabel}回到个人模式` : `切换到${secondaryLabel}`;
  const handleSecondaryModeClick = () => {
    if (mode === secondaryMode) {
      onModeChange("personal");
    }
  };
  const secondaryControl = (
    <div
      className="inline-flex h-8 items-center gap-2"
      onClick={handleSecondaryModeClick}
    >
      <RadioGroupItem
        value={secondaryMode}
        id={`dashboard-mode-${secondaryMode}`}
      />
      <Label
        htmlFor={`dashboard-mode-${secondaryMode}`}
        className="cursor-pointer text-base font-normal leading-none"
      >
        {secondaryLabel}
      </Label>
    </div>
  );

  return (
    <RadioGroup
      value={mode}
      onValueChange={(value) => onModeChange(value as DashboardMode)}
      className="flex flex-row items-center gap-4"
      aria-label="仪表盘模式"
    >
      <div className="inline-flex h-8 items-center gap-2">
        <RadioGroupItem value="personal" id="dashboard-mode-personal" />
        <Label
          htmlFor="dashboard-mode-personal"
          className="cursor-pointer text-base font-normal leading-none"
        >
          个人模式
        </Label>
      </div>
      {variant === "admin" ? (
        <Tooltip>
          <TooltipTrigger asChild>{secondaryControl}</TooltipTrigger>
          <TooltipContent side="bottom">{secondaryTooltip}</TooltipContent>
        </Tooltip>
      ) : (
        secondaryControl
      )}
    </RadioGroup>
  );
}

export function DashboardHeader({
  mode,
  modeSwitchVariant,
  onModeChange,
}: Readonly<{
  mode: DashboardMode;
  modeSwitchVariant?: DashboardModeSwitchVariant;
  onModeChange: (mode: DashboardMode) => void;
}>) {
  return (
    <div className="flex flex-row flex-wrap items-center gap-4">
      <h1 className="text-3xl font-bold text-primary card-title-placeholder">
        仪表盘
      </h1>
      {modeSwitchVariant ? (
        <DashboardModeSwitch
          mode={mode}
          onModeChange={onModeChange}
          variant={modeSwitchVariant}
        />
      ) : null}
    </div>
  );
}

function PersonalDashboardContent({
  activeTab,
  cards,
  isPublicUser,
  onTabChange,
}: Readonly<{
  activeTab: DashboardTab;
  cards: DashboardCardItem[];
  isPublicUser: boolean;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  return (
    <>
      <DashboardStats cards={cards} activeTab={activeTab} onTabChange={onTabChange} />
      {!isPublicUser && activeTab === "reagents" ? <DashboardReagentTab /> : null}
      {!isPublicUser && activeTab === "consumables" ? <DashboardConsumableTab /> : null}
      {activeTab === "borrows" ? <DashboardBorrowTab /> : null}
      {!isPublicUser && activeTab === "stockin" ? <DashboardStockinTab /> : null}
    </>
  );
}

export function DashboardContent({
  activeTab,
  adminSummary,
  adminWindowStats,
  boardAnnouncements,
  boardSummary,
  boardWindowStats,
  cards,
  effectiveDashboardMode,
  isAdmin,
  isMemberUser,
  isPublicUser,
  managementActiveTab,
  managementCards,
  showBoardWindowStatsFailureFallback,
  showWindowStatsFailureFallback,
  summaryAllTime,
  summaryWindowDays,
  onBoardTabChange,
  onManagementTabChange,
  onSummaryAllTimeChange,
  onSummaryWindowDaysChange,
  onTabChange,
}: Readonly<{
  activeTab: DashboardTab;
  adminSummary: AdminDashboardSummary;
  adminWindowStats: AdminDashboardWindowStats;
  boardAnnouncements: Announcement[];
  boardSummary: DashboardBoardSummary;
  boardWindowStats: AdminDashboardWindowStats;
  cards: DashboardCardItem[];
  effectiveDashboardMode: DashboardMode;
  isAdmin: boolean;
  isMemberUser: boolean;
  isPublicUser: boolean;
  managementActiveTab: DashboardTab | null;
  managementCards: ManagementCardItem[];
  showBoardWindowStatsFailureFallback: boolean;
  showWindowStatsFailureFallback: boolean;
  summaryAllTime: boolean;
  summaryWindowDays: number;
  onBoardTabChange: (tab: DashboardTab) => void;
  onManagementTabChange: (tab: DashboardTab) => void;
  onSummaryAllTimeChange: (value: boolean) => void;
  onSummaryWindowDaysChange: (value: number) => void;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  if (isPublicUser) {
    return (
      <PublicDashboardPanel
        announcements={boardAnnouncements}
        summary={boardSummary}
        summaryAllTime={summaryAllTime}
        windowStats={boardWindowStats}
        showWindowStatsFailureFallback={showBoardWindowStatsFailureFallback}
        summaryWindowDays={summaryWindowDays}
        onSummaryAllTimeChange={onSummaryAllTimeChange}
        onSummaryWindowDaysChange={onSummaryWindowDaysChange}
      />
    );
  }

  if (effectiveDashboardMode === "management" && isAdmin) {
    return (
      <>
        <ManagementDashboardStats
          cards={managementCards}
          activeTab={managementActiveTab}
          onTabChange={onManagementTabChange}
        />
        {managementActiveTab ? (
          <ManagementDashboardTable activeTab={managementActiveTab} />
        ) : (
          <ManagementDashboardPanel
            summary={adminSummary}
            summaryAllTime={summaryAllTime}
            windowStats={adminWindowStats}
            showWindowStatsFailureFallback={showWindowStatsFailureFallback}
            summaryWindowDays={summaryWindowDays}
            onSummaryAllTimeChange={onSummaryAllTimeChange}
            onSummaryWindowDaysChange={onSummaryWindowDaysChange}
            onTabChange={onManagementTabChange}
          />
        )}
      </>
    );
  }

  if (effectiveDashboardMode === "board" && isMemberUser) {
    return (
      <DashboardBoardPanel
        announcements={boardAnnouncements}
        summary={boardSummary}
        summaryAllTime={summaryAllTime}
        windowStats={boardWindowStats}
        showWindowStatsFailureFallback={showBoardWindowStatsFailureFallback}
        summaryWindowDays={summaryWindowDays}
        onSummaryAllTimeChange={onSummaryAllTimeChange}
        onSummaryWindowDaysChange={onSummaryWindowDaysChange}
        onTabChange={onBoardTabChange}
      />
    );
  }

  return (
    <PersonalDashboardContent
      cards={cards}
      activeTab={activeTab}
      isPublicUser={isPublicUser}
      onTabChange={onTabChange}
    />
  );
}
