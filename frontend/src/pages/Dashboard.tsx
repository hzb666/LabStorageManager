/** 仪表盘页面容器。 */
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Activity,
  ArchiveRestore,
  AlertTriangle,
  ArrowRightLeft,
  BadgeDollarSign,
  Boxes,
  ClipboardList,
  FlaskConical,
  Info,
  Loader2,
  Megaphone,
  MonitorCheck,
  Package,
  PackageCheck,
  ShoppingCart,
  Users,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { QuantityIndicator } from "@/components/ui/QuantityIndicator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Slider } from "@/components/ui/Slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { AnnouncementDetail } from "@/components/AnnouncementDetail";
import { cn, formatDateTime } from "@/lib/utils";
import { UserRoles } from "@/lib/constants";
import { useAuthStore } from "@/store/useStore";
import {
  getDashboardActiveTab,
  getDashboardModePreference,
  setDashboardActiveTab,
  setDashboardModePreference,
} from "@/lib/storage/appUiStorage";

import {
  type DashboardTab,
  subscribeDashboardCountsRefresh,
} from "../lib/dashboardUtils";
import { useSSE } from "@/hooks/useSSE";
import {
  COMMON_SHELF_SSE_EVENTS,
  CONSUMABLE_ORDER_SSE_EVENTS,
  INVENTORY_SSE_EVENTS,
  REAGENT_ORDER_SSE_EVENTS,
} from "@/lib/sseEvents";
import { DashboardReagentTab } from "./dashboard/DashboardReagentTab";
import { DashboardConsumableTab } from "./dashboard/DashboardConsumableTab";
import { DashboardBorrowTab } from "./dashboard/DashboardBorrowTab";
import { DashboardStockinTab } from "./dashboard/DashboardStockinTab";

import {
  reagentOrderAPI,
  consumableOrderAPI,
  inventoryAPI,
  announcementAPI,
  dashboardAPI,
  type Announcement,
  type AdminDashboardPanelItem,
  type AdminDashboardSummary,
  type AdminDashboardWindowStats,
  type DashboardBoardSummary,
} from "@/api/client";

type DashboardCounts = {
  reagentCount: number;
  consumableCount: number;
  borrowCount: number;
  borrowOverdueCount: number;
  stockinCount: number;
};

type DashboardCountsState = {
  counts: DashboardCounts;
  isLoading: boolean;
};

type DashboardCardItem = {
  tab: DashboardTab;
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  value: React.ReactNode;
};

type DashboardMode = "personal" | "board" | "management";

type DashboardModeSwitchVariant = "admin" | "member";

type ManagementCardItem = {
  tab?: DashboardTab;
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  value: React.ReactNode;
  description: string;
};

type SystemStatusDisplayItem = {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
};

type DashboardSystemSummary = {
  system_status: AdminDashboardPanelItem[];
  system_version?: string;
};

const EMPTY_COUNTS: DashboardCounts = {
  reagentCount: 0,
  consumableCount: 0,
  borrowCount: 0,
  borrowOverdueCount: 0,
  stockinCount: 0,
};

const EMPTY_ADMIN_SUMMARY: AdminDashboardSummary = {
  reagent_order_count: 0,
  consumable_order_count: 0,
  borrowed_inventory_count: 0,
  pending_stockin_count: 0,
  reagent_order_delta: 0,
  consumable_order_delta: 0,
  borrowed_inventory_delta: 0,
  pending_stockin_delta: 0,
  pending_reagent_count: 0,
  pending_consumable_count: 0,
  approved_reagent_count: 0,
  overdue_borrow_count: 0,
  pending_reagent_overdue_count: 0,
  pending_consumable_overdue_count: 0,
  pending_stockin_overdue_count: 0,
  long_pending_order_count: 0,
  common_stock_alert_count: 0,
  recent_arrival_count: 0,
  recent_reagent_order_count: 0,
  recent_consumable_order_count: 0,
  stock_in_activity_count: 0,
  order_total_value: 0,
  todo_items: [],
  risk_items: [],
  recent_actions: [],
  stock_alert_items: [],
  system_status: [],
  recent_window_days: 7,
  system_version: "",
  generated_at: "",
};

const EMPTY_ADMIN_WINDOW_STATS: AdminDashboardWindowStats = {
  recent_window_days: 7,
  is_all_time: false,
  recent_arrival_count: 0,
  recent_reagent_order_count: 0,
  recent_consumable_order_count: 0,
  stock_in_activity_count: 0,
  order_total_value: 0,
};

const EMPTY_BOARD_SUMMARY: DashboardBoardSummary = {
  action_items: [],
  order_overview_items: [],
  recent_items: [],
  stock_alert_items: [],
  announcement_items: [],
  system_status: [],
  recent_window_days: 7,
  system_version: "",
  generated_at: "",
};

const ADMIN_SUMMARY_STALE_TIME_MS = 60 * 1000;
const ADMIN_SUMMARY_GC_TIME_MS = 10 * 60 * 1000;
const BOARD_SUMMARY_QUERY_KEY = ["dashboard", "board", "summary"] as const;
const BOARD_WINDOW_STATS_QUERY_KEY = [
  "dashboard",
  "board",
  "window-stats",
] as const;
const BOARD_PUBLIC_ANNOUNCEMENTS_QUERY_KEY = [
  "dashboard",
  "board",
  "announcements",
] as const;
const ADMIN_SUMMARY_QUERY_KEY = ["dashboard", "admin", "summary"] as const;
const ADMIN_WINDOW_STATS_QUERY_KEY = [
  "dashboard",
  "admin",
  "window-stats",
] as const;
const DASHBOARD_WINDOW_MIN_DAYS = 3;
const DASHBOARD_WINDOW_MAX_DAYS = 365;
const DASHBOARD_WINDOW_DEFAULT_DAYS = 7;
const DASHBOARD_WINDOW_DEBOUNCE_MS = 200;
const ADMIN_SUMMARY_SSE_ROOMS = [
  "reagent_orders",
  "consumable_orders",
  "inventory",
  "common_shelf",
];
const ADMIN_SUMMARY_SSE_EVENTS = [
  ...REAGENT_ORDER_SSE_EVENTS,
  ...CONSUMABLE_ORDER_SSE_EVENTS,
  ...INVENTORY_SSE_EVENTS,
  ...COMMON_SHELF_SSE_EVENTS,
];
const UNUSED_SYSTEM_STATUS_LABELS = new Set([
  "待审试剂",
  "待审耗材",
  "暂存入库",
  "逾期借用",
  "处理积压",
]);
const SYSTEM_STATUS_ICON_BY_LABEL: Record<string, React.ElementType> = {
  启用用户: Users,
  有效会话: MonitorCheck,
  今日活跃: Activity,
};

const DASHBOARD_LABEL_TEXT_BY_CODE: Record<string, string> = {
  "stock_alert.inventory_low": "库存低量",
  "stock_alert.common_shelf_low": "常用低量",
  "todo.reagent_order_pending_approval": "待审批试剂订单",
  "todo.consumable_order_pending_approval": "待审批耗材订单",
  "risk.order_timeout": "订单超时",
  "risk.reagent_order_unarrived": "长时间未到货",
  "risk.consumable_order_unconfirmed": "长时间未确认收货",
  "risk.borrow_overdue": "借用超时",
  "system_status.active_users": "启用用户",
  "system_status.active_sessions": "有效会话",
  "system_status.active_users_today": "今日活跃",
  "system_status.pending_reagent_orders": "待审试剂",
  "system_status.pending_consumable_orders": "待审耗材",
  "system_status.pending_stockin": "暂存入库",
  "system_status.overdue_borrows": "逾期借用",
  "system_status.pending_backlog": "处理积压",
  "board.order_overview.reagent_order": "试剂",
  "board.order_overview.consumable_order": "耗材",
  "board.action.reagent_order_arrived_pending_confirm": "待确认到货",
  "board.action.consumable_order_arrived_pending_confirm": "待确认耗材",
  "board.action.borrow_overdue": "借用超期",
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

function joinDashboardDetailParts(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function getDashboardItemCode(item: AdminDashboardPanelItem): string | undefined {
  return item.codes?.label_code ?? undefined;
}

function getDashboardItemImpactCode(item: AdminDashboardPanelItem): string | undefined {
  return item.codes?.impact_code ?? undefined;
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
  if (code === "management_action.reagent_order_reviewed") {
    return `${item.entity?.actor_name || "系统"}处理试剂订单`;
  }
  if (code === "management_action.consumable_order_reviewed") {
    return `${item.entity?.actor_name || "系统"}处理耗材订单`;
  }
  if (code === "management_action.inventory_stocked") {
    return `${item.entity?.actor_name || "系统"}完成入库`;
  }
  if (code === "management_action.common_shelf_updated") {
    return `${item.entity?.actor_name || "系统"}更新常用货架`;
  }
  return undefined;
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
  return (code && DASHBOARD_LABEL_TEXT_BY_CODE[code]) || item.label;
}

function getDashboardItemImpactText(item: AdminDashboardPanelItem): string | undefined {
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

function getDashboardRiskDetailText(
  code: string | undefined,
  item: AdminDashboardPanelItem,
): string | undefined {
  const countText = item.metrics?.count ?? 0;
  const thresholdDaysText = item.metrics?.threshold_days ?? 0;
  const riskDetailByCode: Record<string, string> = {
    "risk.order_timeout": `超过 ${thresholdDaysText} 天未处理：${countText} 条`,
    "risk.reagent_order_unarrived": `已批准超过 ${thresholdDaysText} 天未到货：${countText} 条`,
    "risk.consumable_order_unconfirmed": `已批准超过 ${thresholdDaysText} 天未确认收货：${countText} 条`,
    "risk.borrow_overdue": `${countText} 条借用已超过归还提醒阈值`,
  };
  return code ? riskDetailByCode[code] : undefined;
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

  const riskDetail = getDashboardRiskDetailText(code, item);
  if (riskDetail) {
    return riskDetail;
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

// 判断统计卡片数字是否真正发生变化，避免同值 `setState` 触发无效更新。
function isCountsEqual(a: DashboardCounts, b: DashboardCounts): boolean {
  return (
    a.reagentCount === b.reagentCount &&
    a.consumableCount === b.consumableCount &&
    a.borrowCount === b.borrowCount &&
    a.borrowOverdueCount === b.borrowOverdueCount &&
    a.stockinCount === b.stockinCount
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
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
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

const ALL_TABS: DashboardTab[] = [
  "reagents",
  "consumables",
  "borrows",
  "stockin",
];

// `localStorage` 里的 tab 值不可信，角色切换后若旧值已不可见则回退到首个允许页签。
function getSavedTab(allowedTabs: DashboardTab[]): DashboardTab {
  try {
    const saved = getDashboardActiveTab();
    if (saved && allowedTabs.includes(saved as DashboardTab)) {
      return saved as DashboardTab;
    }
  } catch {
    // 忽略 localStorage 异常
  }
  return allowedTabs[0] ?? "borrows";
}

// 持久化当前激活的页签；写入失败只影响下次恢复，不影响当前选中态。
function saveTab(tab: DashboardTab) {
  try {
    setDashboardActiveTab(tab);
  } catch {
    // 持久化失败时保留当前内存状态，不额外打断交互。
  }
}

function getSavedDashboardMode(userRole?: string): DashboardMode {
  try {
    const savedMode = getDashboardModePreference();
    if (userRole === UserRoles.ADMIN) {
      return savedMode === "management" ? "management" : "personal";
    }
    if (userRole === UserRoles.USER) {
      return savedMode === "board" ? "board" : "personal";
    }
    return "personal";
  } catch {
    return "personal";
  }
}

function saveDashboardMode(mode: DashboardMode) {
  try {
    setDashboardModePreference(mode);
  } catch {
    // 管理模式偏好写入失败时只影响下次恢复，不影响当前切换。
  }
}

function formatManagementDelta(delta: number, isLoading: boolean): string {
  if (isLoading) {
    return "较昨日 --";
  }
  return `较昨日 ${delta >= 0 ? "+" : ""}${delta}`;
}

function getCardAlertBadge(text: string): React.ReactNode {
  return (
    <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      {text}
    </span>
  );
}

function getRowAlertBadge(label: string): React.ReactNode {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      title={label}
      aria-label={label}
    >
      <AlertTriangle className="size-3" />
      {label}
    </span>
  );
}

// 订单接口返回 `{ [status]: { orders: [] } }`；这里只累计每组 `orders.length`，不依赖状态键名。
function countGroupedOrders(
  grouped: Record<string, { orders: unknown[] }>,
): number {
  return Object.values(grouped).reduce(
    (sum, item) => sum + (item.orders?.length ?? 0),
    0,
  );
}

// `public` 角色只请求借用列表，其余统计固定为 `0`，避免触发无权限或无意义的请求。
async function loadPublicDashboardCounts(): Promise<DashboardCounts> {
  const borrowRes = await inventoryAPI.getMyBorrows();
  return {
    reagentCount: 0,
    consumableCount: 0,
    borrowCount: (borrowRes.data?.data ?? []).length,
    borrowOverdueCount: borrowRes.data?.overdue_count ?? 0,
    stockinCount: 0,
  };
}

// 成员角色的四项统计来自 4 个接口；试剂和耗材结果需要先按分组对象聚合。
async function loadMemberDashboardCounts(): Promise<DashboardCounts> {
  const [reagentRes, consumableRes, borrowRes, stockinRes] = await Promise.all([
    reagentOrderAPI.getMyReagentOrders(),
    consumableOrderAPI.getMyConsumableOrders(),
    inventoryAPI.getMyBorrows(),
    inventoryAPI.getPendingStockin(),
  ]);

  const reagentGrouped = (reagentRes.data?.data ?? {}) as Record<
    string,
    { orders: unknown[] }
  >;
  const consumableGrouped = (consumableRes.data?.data ?? {}) as Record<
    string,
    { orders: unknown[] }
  >;

  return {
    reagentCount: countGroupedOrders(reagentGrouped),
    consumableCount: countGroupedOrders(consumableGrouped),
    borrowCount: (borrowRes.data?.data ?? []).length,
    borrowOverdueCount: borrowRes.data?.overdue_count ?? 0,
    stockinCount: (stockinRes.data?.data ?? []).length,
  };
}

// 把角色分支收口在这一层，`effect` 不直接处理 public / member 分叉。
function loadDashboardCountsByRole(
  isPublicUser: boolean,
): Promise<DashboardCounts> {
  return isPublicUser
    ? loadPublicDashboardCounts()
    : loadMemberDashboardCounts();
}

// 个人统计只在当前组件生命周期内保存快照；刷新后数值不变时不触发界面更新。
function useDashboardCounts(
  userKey: string,
  isPublicUser: boolean,
  refreshToken: number,
): DashboardCountsState {
  const [countsState, setCountsState] = useState<{
    userKey: string;
    counts: DashboardCounts;
  } | null>(null);
  const counts =
    countsState?.userKey === userKey
      ? countsState.counts
      : EMPTY_COUNTS;
  const isLoading = countsState?.userKey !== userKey;

  useEffect(() => {
    let cancelled = false;

    const applyCounts = (nextCounts: DashboardCounts) => {
      if (cancelled) {
        return;
      }

      setCountsState((prev) => {
        if (
          prev?.userKey === userKey &&
          isCountsEqual(prev.counts, nextCounts)
        ) {
          return prev;
        }
        return { userKey, counts: nextCounts };
      });
    };

    const keepCountsOrUseEmpty = () => {
      if (cancelled) {
        return;
      }

      setCountsState((prev) =>
        prev?.userKey === userKey ? prev : { userKey, counts: EMPTY_COUNTS },
      );
    };

    const syncCounts = async () => {
      try {
        const nextCounts = await loadDashboardCountsByRole(isPublicUser);
        applyCounts(nextCounts);
      } catch {
        keepCountsOrUseEmpty();
      }
    };

    void syncCounts();
    return () => {
      cancelled = true;
    };
  }, [isPublicUser, refreshToken, userKey]);

  return { counts, isLoading };
}

// 子 Tab 的增删改不会自动刷新顶部统计，这里把跨组件刷新事件折叠成 `refreshToken`。
function useDashboardRefreshToken(): number {
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(
    () =>
      subscribeDashboardCountsRefresh(() => {
        setRefreshToken((value) => value + 1);
      }),
    [],
  );

  return refreshToken;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timerId);
  }, [delayMs, value]);

  return debouncedValue;
}

function useDashboardSummarySSE(
  enabled: boolean,
  summaryQueryKey: readonly string[],
  windowStatsQueryKey?: readonly string[],
) {
  const queryClient = useQueryClient();
  const refreshSummary = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: summaryQueryKey })
      .catch(() => {});
    if (windowStatsQueryKey) {
      queryClient
        .invalidateQueries({ queryKey: windowStatsQueryKey })
        .catch(() => {});
    }
  }, [queryClient, summaryQueryKey, windowStatsQueryKey]);
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        ADMIN_SUMMARY_SSE_EVENTS.map((eventType) => [eventType, refreshSummary]),
      ),
    [refreshSummary],
  );

  useSSE({
    rooms: ADMIN_SUMMARY_SSE_ROOMS,
    handlers,
    autoConnect: enabled,
    onReconnect: refreshSummary,
    onStreamStale: refreshSummary,
  });
}

function useAdminDashboardData({
  queryEnabled,
  sseEnabled,
  summaryAllTime,
  summaryWindowDays,
}: Readonly<{
  queryEnabled: boolean;
  sseEnabled: boolean;
  summaryAllTime: boolean;
  summaryWindowDays: number;
}>) {
  useDashboardSummarySSE(
    sseEnabled,
    ADMIN_SUMMARY_QUERY_KEY,
    ADMIN_WINDOW_STATS_QUERY_KEY,
  );
  const debouncedSummaryWindowDays = useDebouncedValue(
    summaryWindowDays,
    DASHBOARD_WINDOW_DEBOUNCE_MS,
  );
  const adminSummaryQuery = useQuery({
    queryKey: ADMIN_SUMMARY_QUERY_KEY,
    enabled: queryEnabled,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await dashboardAPI.getAdminSummary();
      return response.data.data;
    },
  });
  const adminWindowStatsQuery = useQuery({
    queryKey: [
      ...ADMIN_WINDOW_STATS_QUERY_KEY,
      debouncedSummaryWindowDays,
      summaryAllTime,
    ],
    enabled: queryEnabled,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const response = await dashboardAPI.getAdminWindowStats(
        debouncedSummaryWindowDays,
        summaryAllTime,
      );
      return response.data.data;
    },
  });
  const currentWindowStats = adminWindowStatsQuery.data;
  const adminSummary = adminSummaryQuery.data ?? EMPTY_ADMIN_SUMMARY;
  const adminWindowStats = currentWindowStats ?? EMPTY_ADMIN_WINDOW_STATS;
  const isAdminSummaryLoading =
    adminSummaryQuery.isPending && !adminSummaryQuery.data;
  const managementCards = useMemo(
    () => getManagementCardItems(adminSummary, isAdminSummaryLoading),
    [adminSummary, isAdminSummaryLoading],
  );

  return {
    adminSummary,
    adminWindowStats,
    managementCards,
    showWindowStatsFailureFallback:
      adminWindowStatsQuery.isError && !currentWindowStats,
  };
}

function useDashboardBoardData({
  queryEnabled,
  sseEnabled,
  summaryAllTime,
  summaryWindowDays,
}: Readonly<{
  queryEnabled: boolean;
  sseEnabled: boolean;
  summaryAllTime: boolean;
  summaryWindowDays: number;
}>) {
  useDashboardSummarySSE(
    sseEnabled,
    BOARD_SUMMARY_QUERY_KEY,
    BOARD_WINDOW_STATS_QUERY_KEY,
  );
  const debouncedSummaryWindowDays = useDebouncedValue(
    summaryWindowDays,
    DASHBOARD_WINDOW_DEBOUNCE_MS,
  );
  const boardSummaryQuery = useQuery({
    queryKey: BOARD_SUMMARY_QUERY_KEY,
    enabled: queryEnabled,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await dashboardAPI.getBoardSummary();
      return response.data.data;
    },
  });
  const boardWindowStatsQuery = useQuery({
    queryKey: [
      ...BOARD_WINDOW_STATS_QUERY_KEY,
      debouncedSummaryWindowDays,
      summaryAllTime,
    ],
    enabled: queryEnabled,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const response = await dashboardAPI.getBoardWindowStats(
        debouncedSummaryWindowDays,
        summaryAllTime,
      );
      return response.data.data;
    },
  });
  const boardAnnouncementsQuery = useQuery({
    queryKey: BOARD_PUBLIC_ANNOUNCEMENTS_QUERY_KEY,
    enabled: queryEnabled,
    staleTime: ADMIN_SUMMARY_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await announcementAPI.getPublic();
      return response.data;
    },
  });
  const currentWindowStats = boardWindowStatsQuery.data;

  return {
    boardAnnouncements: boardAnnouncementsQuery.data ?? [],
    boardSummary: boardSummaryQuery.data ?? EMPTY_BOARD_SUMMARY,
    boardWindowStats: currentWindowStats ?? EMPTY_ADMIN_WINDOW_STATS,
    showBoardWindowStatsFailureFallback:
      boardWindowStatsQuery.isError && !currentWindowStats,
  };
}

// `public` 只展示借用卡片；非 `public` 才展示订单和待入库卡片，loading 时 `value` 可以是节点。
function getDashboardCardItems(
  isPublicUser: boolean,
  counts: DashboardCounts,
  isLoading: boolean,
): DashboardCardItem[] {
  const loadingValue = (
    <Loader2 className="size-5 animate-spin text-muted-foreground" />
  );
  const borrowCard: DashboardCardItem = {
    tab: "borrows",
    title: "当前借用",
    icon: Package,
    value: isLoading ? loadingValue : counts.borrowCount,
    titleSuffix:
      !isLoading && counts.borrowOverdueCount > 0
        ? (
            <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {counts.borrowOverdueCount} 个超期
            </span>
          )
        : undefined,
  };

  if (isPublicUser) {
    return [borrowCard];
  }

  return [
    {
      tab: "reagents",
      title: "试剂订单",
      icon: ShoppingCart,
      value: isLoading ? loadingValue : counts.reagentCount,
    },
    {
      tab: "consumables",
      title: "耗材订单",
      icon: ShoppingCart,
      value: isLoading ? loadingValue : counts.consumableCount,
    },
    borrowCard,
    {
      tab: "stockin",
      title: "待入库",
      icon: ArrowRightLeft,
      value: isLoading ? loadingValue : counts.stockinCount,
    },
  ];
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
        className="cursor-pointer text-base font-medium leading-none"
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
          className="cursor-pointer text-base font-medium leading-none"
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

function getManagementCardItems(
  summary: AdminDashboardSummary,
  isLoading: boolean,
): ManagementCardItem[] {
  const loadingValue = (
    <Loader2 className="size-5 animate-spin text-muted-foreground" />
  );
  const value = (count: number) => (isLoading ? loadingValue : count);

  return [
    {
      tab: "reagents",
      title: "活跃试剂订单",
      titleSuffix:
        !isLoading && summary.pending_reagent_overdue_count > 0
          ? getCardAlertBadge(`${summary.pending_reagent_overdue_count} 个超时`)
          : undefined,
      icon: ShoppingCart,
      value: value(summary.reagent_order_count),
      description: formatManagementDelta(summary.reagent_order_delta, isLoading),
    },
    {
      tab: "consumables",
      title: "活跃耗材订单",
      titleSuffix:
        !isLoading && summary.pending_consumable_overdue_count > 0
          ? getCardAlertBadge(`${summary.pending_consumable_overdue_count} 个超时`)
          : undefined,
      icon: ShoppingCart,
      value: value(summary.consumable_order_count),
      description: formatManagementDelta(summary.consumable_order_delta, isLoading),
    },
    {
      tab: "borrows",
      title: "正在借用",
      titleSuffix:
        !isLoading && summary.overdue_borrow_count > 0
          ? getCardAlertBadge(`${summary.overdue_borrow_count} 个超期`)
          : undefined,
      icon: Package,
      value: value(summary.borrowed_inventory_count),
      description: formatManagementDelta(summary.borrowed_inventory_delta, isLoading),
    },
    {
      tab: "stockin",
      title: "正在暂存",
      titleSuffix:
        !isLoading && summary.pending_stockin_overdue_count > 0
          ? getCardAlertBadge(`${summary.pending_stockin_overdue_count} 个超时`)
          : undefined,
      icon: ArrowRightLeft,
      value: value(summary.pending_stockin_count),
      description: formatManagementDelta(summary.pending_stockin_delta, isLoading),
    },
  ];
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

function getPanelToneClassName(tone?: string) {
  if (tone === "high") {
    return "bg-destructive/10 text-destructive";
  }
  if (tone === "medium" || tone === "warning") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (tone === "success") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  return "bg-muted text-muted-foreground";
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

function ManagementPanelSection({
  title,
  icon: Icon,
  headerAction,
  children,
}: Readonly<{
  title: string;
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
            {title}
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

function getPanelTimeText(createdAt?: string) {
  return createdAt ? formatDateTime(createdAt) : "-";
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
          <tr className="text-left text-base font-semibold text-foreground">
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
    return {
      className: "transition-colors hover:bg-muted/40",
    };
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

// 用公告标题和发布时间对齐看板摘要项与公告详情数据，避免为了弹窗改动摘要接口。
function getBoardAnnouncementLookupKey(
  title: string,
  createdAt?: string,
): string {
  return `${title}::${createdAt ?? ""}`;
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
      {items.map((item) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={`${labelText}-${detailText}-${item.created_at ?? ""}`}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="px-2 py-4 text-base font-medium leading-6">{labelText}</td>
            <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            <td className="truncate px-2 py-4 text-base leading-6 text-muted-foreground">
              {item.submitter_name || "-"}
            </td>
            <td className="px-2 py-4 text-base leading-6 text-muted-foreground">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span>{getPanelTimeText(item.created_at)}</span>
                {item.is_overdue ? getRowAlertBadge("超时") : null}
              </div>
            </td>
          </tr>
        );
      })}
    </ManagementTableShell>
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

function ManagementImpactCell({ item }: Readonly<{ item: AdminDashboardPanelItem }>) {
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
      <td className="px-2 py-3.5">
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2 text-base font-medium leading-6",
            getPanelToneClassName(item.severity),
          )}
        >
          {stockAlertRemainingText}
        </span>
      </td>
    );
  }

  return (
    <td className="px-2 py-3.5">
      <span
        className={cn(
          "inline-flex h-7 items-center rounded-md px-2 text-base font-medium leading-6",
          getPanelToneClassName(item.severity),
        )}
      >
        {getDashboardItemImpactText(item) ??
          (item.count !== undefined ? `${item.count} 项` : getSeverityLabel(item.severity))}
      </span>
    </td>
  );
}

function ManagementRiskTable({
  items,
  emptyText,
  onTabChange,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  emptyText: string;
  onTabChange?: (tab: DashboardTab) => void;
}>) {
  return (
    <ManagementTableShell
      emptyText={emptyText}
      headers={[
        { label: "类型", className: "w-[18%]" },
        { label: "内容", className: "w-[42%]" },
        { label: "剩余量", className: "w-[16%]" },
        { label: "时间", className: "w-[24%]" },
      ]}
      items={items}
      minWidthClassName="min-w-[720px]"
    >
      {items.map((item) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={`${labelText}-${detailText}`}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="px-2 py-4 text-base font-medium leading-6">{labelText}</td>
            <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            <ManagementImpactCell item={item} />
            <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
              {getPanelTimeText(item.created_at)}
            </td>
          </tr>
        );
      })}
    </ManagementTableShell>
  );
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
      {items.map((item) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={`${labelText}-${detailText}-${item.created_at ?? ""}`}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="px-2 py-4 text-base font-medium leading-6">{labelText}</td>
            <td className="truncate px-2 py-4 text-base leading-6">{detailText}</td>
            {showStatus ? <ManagementImpactCell item={item} /> : null}
            <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
              {getPanelTimeText(item.created_at)}
            </td>
          </tr>
        );
      })}
    </ManagementTableShell>
  );
}

function getRecentItemCategoryClassName(category: string) {
  if (category === "试剂到货") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (category === "订单入库") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (category === "耗材到货") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

function DashboardRecentItemsTable({
  items,
  onTabChange,
}: Readonly<{
  items: AdminDashboardPanelItem[];
  onTabChange?: (tab: DashboardTab) => void;
}>) {
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
      {items.map((item) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={`${labelText}-${detailText}-${item.created_at ?? ""}`}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="truncate px-2 py-4 text-base font-medium leading-6">
              {detailText}
            </td>
            <td className="px-2 py-3.5">
              <span
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2 text-base font-medium leading-6",
                  getRecentItemCategoryClassName(labelText),
                )}
              >
                {labelText}
              </span>
            </td>
            <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
              {getPanelTimeText(item.created_at)}
            </td>
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
      {items.map((item) => {
        const labelText = getDashboardItemLabelText(item);
        const detailText = getDashboardItemDetailText(item);
        return (
          <tr
            key={`${labelText}-${detailText}-${item.created_at ?? ""}`}
            {...getManagementRowInteraction(item, onTabChange)}
          >
            <td className="truncate px-2 py-4 text-base font-medium leading-6">
              {detailText}
            </td>
            <td className="px-2 py-4 text-base leading-6">{labelText}</td>
            <ManagementImpactCell item={item} />
            <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
              {getPanelTimeText(item.created_at)}
            </td>
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
          getBoardAnnouncementLookupKey(
            announcement.title,
            announcement.created_at,
          ),
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
    if (!announcement) {
      return;
    }
    setSelectedAnnouncement(announcement);
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
        {items.map((item) => {
          const detailText = getDashboardItemDetailText(item);
          const labelText = getDashboardItemLabelText(item);
          const announcement = announcementMap.get(
            getBoardAnnouncementLookupKey(detailText, item.created_at),
          );

          return (
            <tr
              key={`${labelText}-${detailText}-${item.created_at ?? ""}`}
              {...getManagementRowInteraction(
                item,
                undefined,
                announcement ? () => handleAnnouncementOpen(item) : undefined,
              )}
            >
              <td className="truncate px-2 py-4 text-base font-medium leading-6">
                {detailText}
              </td>
              <td className="truncate px-2 py-4 text-base leading-6">
                {item.submitter_name || "-"}
              </td>
              <td className="whitespace-nowrap px-2 py-4 text-base leading-6 text-muted-foreground">
                {getPanelTimeText(item.created_at)}
              </td>
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

function formatCurrencyValue(value: number | undefined): string {
  if (typeof value !== "number") {
    return "-";
  }

  return `¥${value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  })}`;
}

function clampDashboardWindowDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DASHBOARD_WINDOW_DEFAULT_DAYS;
  }

  return Math.min(
    DASHBOARD_WINDOW_MAX_DAYS,
    Math.max(DASHBOARD_WINDOW_MIN_DAYS, Math.round(value)),
  );
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
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onWindowDaysChange(clampDashboardWindowDays(Number(event.target.value)));
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="shrink-0 text-sm font-medium text-muted-foreground">
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
          className="h-8 text-right text-sm font-semibold leading-8!"
          type="number"
          min={DASHBOARD_WINDOW_MIN_DAYS}
          max={DASHBOARD_WINDOW_MAX_DAYS}
          step={1}
          value={windowDays}
          disabled={allTime}
          onChange={handleInputChange}
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
      <span className="shrink-0 text-sm font-medium text-muted-foreground">
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
          className="cursor-pointer text-sm font-medium text-muted-foreground"
        >
          统计全部
        </Label>
      </div>
    </div>
  );
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
  const retainedItems = summary.system_status
    .map((item) => {
      const label = getDashboardItemLabelText(item);
      return {
        label,
        value: item.value ?? item.metrics?.value ?? 0,
        icon: SYSTEM_STATUS_ICON_BY_LABEL[label] ?? Package,
      };
    })
    .filter((item) => !UNUSED_SYSTEM_STATUS_LABELS.has(item.label));
  const systemVersion = summary.system_version?.trim() || "-";

  return [
    ...retainedItems,
    {
      label: getWindowStatsLabel(windowStats, "试剂订单"),
      value: windowStats.recent_reagent_order_count,
      icon: FlaskConical,
    },
    {
      label: getWindowStatsLabel(windowStats, "耗材订单"),
      value: windowStats.recent_consumable_order_count,
      icon: Boxes,
    },
    {
      label: getWindowStatsLabel(windowStats, "到货"),
      value: windowStats.recent_arrival_count,
      icon: PackageCheck,
    },
    {
      label: getWindowStatsLabel(windowStats, "入库记录"),
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
            <div className="break-words text-base font-medium leading-6 text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-3">
              <span className="break-all text-3xl font-semibold leading-none text-foreground">
                {item.value}
              </span>
            </div>
          </div>
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-6 -right-5 size-24 rotate-[-18deg] text-[#edf2f7] dark:text-[#252a32]"
          />
        </div>
      ))}
    </div>
  );
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
        <ManagementPanelSection title="待处理事项" icon={ClipboardList}>
          <ManagementTodoTable
            items={summary.todo_items}
            onTabChange={onTabChange}
          />
        </ManagementPanelSection>
        <ManagementPanelSection title="库存告警" icon={PackageCheck}>
          <ManagementRiskTable
            items={summary.stock_alert_items}
            emptyText="当前没有库存告警"
            onTabChange={onTabChange}
          />
        </ManagementPanelSection>
      </div>
      <div className="min-w-0 space-y-4">
        <ManagementPanelSection title="风险提醒" icon={AlertTriangle}>
          <ManagementRiskTable
            items={summary.risk_items}
            emptyText="当前没有明显风险提醒"
            onTabChange={onTabChange}
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
    </div>
  );
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
      <ManagementPanelSection title="我的待处理" icon={ClipboardList}>
        <DashboardBoardItemTable
          items={summary.action_items}
          emptyText="当前没有需要处理的事项"
          onTabChange={onTabChange}
          showStatus={false}
        />
      </ManagementPanelSection>
      <ManagementPanelSection title="我的订单概览" icon={ShoppingCart}>
        <DashboardBoardOverviewTable
          items={summary.order_overview_items}
          onTabChange={onTabChange}
        />
      </ManagementPanelSection>
      <ManagementPanelSection title="近期到货 / 入库" icon={PackageCheck}>
        <DashboardRecentItemsTable
          items={summary.recent_items}
          onTabChange={onTabChange}
        />
      </ManagementPanelSection>
      <ManagementPanelSection title="库存告警" icon={PackageCheck}>
        <ManagementRiskTable
          items={summary.stock_alert_items}
          emptyText="当前没有库存告警"
          onTabChange={onTabChange}
        />
      </ManagementPanelSection>
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

function DashboardHeader({
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

function getDashboardModeSwitchVariant(
  isAdmin: boolean,
  isMemberUser: boolean,
): DashboardModeSwitchVariant | undefined {
  if (isAdmin) {
    return "admin";
  }
  if (isMemberUser) {
    return "member";
  }
  return undefined;
}

function getEffectiveDashboardMode(
  dashboardMode: DashboardMode,
  isAdmin: boolean,
  isMemberUser: boolean,
): DashboardMode {
  if (isAdmin) {
    return dashboardMode === "management" ? "management" : "personal";
  }
  if (isMemberUser) {
    return dashboardMode === "board" ? "board" : "personal";
  }
  return "personal";
}

function DashboardContent({
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

// 仪表盘主组件只做权限、Tab 持久化、统计缓存和子页切换编排。
export function Dashboard() {
  const currentUser = useAuthStore((state) => state.user);
  const isPublicUser = currentUser?.role === UserRoles.PUBLIC;
  const isAdmin = currentUser?.role === UserRoles.ADMIN;
  const isMemberUser = currentUser?.role === UserRoles.USER;
  const modeSwitchVariant = getDashboardModeSwitchVariant(isAdmin, isMemberUser);
  const canSwitchDashboardMode = modeSwitchVariant !== undefined;
  const userKey = `${currentUser?.id ?? "anonymous"}-${currentUser?.role ?? "unknown"}`;
  const refreshToken = useDashboardRefreshToken();
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() =>
    getSavedDashboardMode(currentUser?.role),
  );
  const [managementActiveTab, setManagementActiveTab] =
    useState<DashboardTab | null>(null);
  const [summaryWindowDays, setSummaryWindowDays] = useState(
    DASHBOARD_WINDOW_DEFAULT_DAYS,
  );
  const [summaryAllTime, setSummaryAllTime] = useState(false);
  const effectiveDashboardMode = useMemo(
    () => getEffectiveDashboardMode(dashboardMode, isAdmin, isMemberUser),
    [dashboardMode, isAdmin, isMemberUser],
  );
  const allowedTabs = useMemo(
    () => (isPublicUser ? (["borrows"] as DashboardTab[]) : ALL_TABS),
    [isPublicUser],
  );

  const [selectedTab, setSelectedTab] = useState<DashboardTab>(() =>
    getSavedTab(allowedTabs),
  );
  const activeTab = useMemo(
    () =>
      allowedTabs.includes(selectedTab)
        ? selectedTab
        : getSavedTab(allowedTabs),
    [allowedTabs, selectedTab],
  );
  const { counts, isLoading } = useDashboardCounts(
    userKey,
    isPublicUser,
    refreshToken,
  );
  const cards = useMemo(
    () => getDashboardCardItems(isPublicUser, counts, isLoading),
    [counts, isLoading, isPublicUser],
  );
  const {
    adminSummary,
    adminWindowStats,
    managementCards,
    showWindowStatsFailureFallback,
  } = useAdminDashboardData({
    queryEnabled: isAdmin,
    sseEnabled: isAdmin && effectiveDashboardMode === "management",
    summaryAllTime,
    summaryWindowDays,
  });
  const {
    boardAnnouncements,
    boardSummary,
    boardWindowStats,
    showBoardWindowStatsFailureFallback,
  } = useDashboardBoardData({
    queryEnabled: isMemberUser,
    sseEnabled: isMemberUser && effectiveDashboardMode === "board",
    summaryAllTime,
    summaryWindowDays,
  });

  useEffect(() => {
    if (canSwitchDashboardMode) {
      saveDashboardMode(effectiveDashboardMode);
    }
  }, [canSwitchDashboardMode, effectiveDashboardMode]);

  const handleTabChange = useCallback(
    (tab: DashboardTab) => {
      if (!allowedTabs.includes(tab)) {
        return;
      }
      setSelectedTab(tab);
    },
    [allowedTabs],
  );
  const handleDashboardModeChange = useCallback(
    (mode: DashboardMode) => {
      if (isAdmin) {
        setDashboardMode(mode === "management" ? "management" : "personal");
        if (mode === "management") {
          setManagementActiveTab(null);
        }
        return;
      }
      if (isMemberUser) {
        setDashboardMode(mode === "board" ? "board" : "personal");
      }
    },
    [isAdmin, isMemberUser],
  );
  const handleManagementTabChange = useCallback((tab: DashboardTab) => {
    setManagementActiveTab((current) => (current === tab ? null : tab));
  }, []);
  const handleBoardTabChange = useCallback(
    (tab: DashboardTab) => {
      handleTabChange(tab);
      setDashboardMode("personal");
    },
    [handleTabChange],
  );

  useEffect(() => {
    saveTab(activeTab);
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <DashboardHeader
        mode={effectiveDashboardMode}
        modeSwitchVariant={modeSwitchVariant}
        onModeChange={handleDashboardModeChange}
      />
      <DashboardContent
        activeTab={activeTab}
        adminSummary={adminSummary}
        adminWindowStats={adminWindowStats}
        boardAnnouncements={boardAnnouncements}
        boardSummary={boardSummary}
        boardWindowStats={boardWindowStats}
        cards={cards}
        effectiveDashboardMode={effectiveDashboardMode}
        isAdmin={isAdmin}
        isMemberUser={isMemberUser}
        isPublicUser={isPublicUser}
        managementActiveTab={managementActiveTab}
        managementCards={managementCards}
        showBoardWindowStatsFailureFallback={showBoardWindowStatsFailureFallback}
        showWindowStatsFailureFallback={showWindowStatsFailureFallback}
        summaryAllTime={summaryAllTime}
        summaryWindowDays={summaryWindowDays}
        onBoardTabChange={handleBoardTabChange}
        onManagementTabChange={handleManagementTabChange}
        onSummaryAllTimeChange={setSummaryAllTime}
        onSummaryWindowDaysChange={setSummaryWindowDays}
        onTabChange={handleTabChange}
      />
    </div>
  );
}
