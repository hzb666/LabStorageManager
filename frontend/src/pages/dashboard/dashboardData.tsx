import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Package, ShoppingCart } from "lucide-react";

import {
  announcementAPI,
  consumableOrderAPI,
  dashboardAPI,
  inventoryAPI,
  reagentOrderAPI,
  type AdminDashboardSummary,
  type AdminDashboardWindowStats,
  type DashboardBoardSummary,
} from "@/api/client";
import { useSSE } from "@/hooks/useSSE";
import {
  getDashboardAlertBadgeClassName,
  isApprovedOrderOverdue,
  type DashboardTab,
  type DashboardAlertTone,
  subscribeDashboardCountsRefresh,
} from "@/lib/dashboardUtils";
import {
  COMMON_SHELF_SSE_EVENTS,
  CONSUMABLE_ORDER_SSE_EVENTS,
  INVENTORY_SSE_EVENTS,
  REAGENT_ORDER_SSE_EVENTS,
} from "@/lib/sseEvents";

export const DASHBOARD_WINDOW_MIN_DAYS = 3;
export const DASHBOARD_WINDOW_MAX_DAYS = 365;
export const DASHBOARD_WINDOW_DEFAULT_DAYS = 7;

export function clampDashboardWindowDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DASHBOARD_WINDOW_DEFAULT_DAYS;
  }

  return Math.min(
    DASHBOARD_WINDOW_MAX_DAYS,
    Math.max(DASHBOARD_WINDOW_MIN_DAYS, Math.round(value)),
  );
}

export type DashboardMode = "personal" | "board" | "management";

export type DashboardModeSwitchVariant = "admin" | "member";

export function getDashboardModeSwitchVariant(
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

export function getEffectiveDashboardMode(
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

export type DashboardCounts = {
  reagentCount: number;
  reagentArrivalOverdueCount: number;
  consumableCount: number;
  consumableReceiptOverdueCount: number;
  borrowCount: number;
  borrowOverdueCount: number;
  stockinCount: number;
};

export type DashboardCountsState = {
  counts: DashboardCounts;
  isLoading: boolean;
};

export const EMPTY_COUNTS: DashboardCounts = {
  reagentCount: 0,
  reagentArrivalOverdueCount: 0,
  consumableCount: 0,
  consumableReceiptOverdueCount: 0,
  borrowCount: 0,
  borrowOverdueCount: 0,
  stockinCount: 0,
};

// 订单接口返回 `{ [status]: { orders: [] } }`；此处累计每组 `orders.length`，不依赖状态键名。
function countGroupedOrders(grouped: Record<string, { orders: unknown[] }>): number {
  return Object.values(grouped).reduce(
    (sum, item) => sum + (item.orders?.length ?? 0),
    0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOptionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined || typeof value === "string") {
    return value;
  }
  return undefined;
}

function countGroupedApprovedOrderOverdue(
  grouped: Record<string, { orders: unknown[] }>,
): number {
  return Object.entries(grouped).reduce((sum, [groupStatus, item]) => {
    const overdueCount = (item.orders ?? []).filter((order) => {
      if (!isRecord(order)) {
        return false;
      }
      return isApprovedOrderOverdue(
        order.status ?? groupStatus,
        getOptionalString(order.updated_at),
      );
    }).length;
    return sum + overdueCount;
  }, 0);
}

function isCountsEqual(a: DashboardCounts, b: DashboardCounts): boolean {
  return (
    a.reagentCount === b.reagentCount &&
    a.reagentArrivalOverdueCount === b.reagentArrivalOverdueCount &&
    a.consumableCount === b.consumableCount &&
    a.consumableReceiptOverdueCount === b.consumableReceiptOverdueCount &&
    a.borrowCount === b.borrowCount &&
    a.borrowOverdueCount === b.borrowOverdueCount &&
    a.stockinCount === b.stockinCount
  );
}

// `public` 角色只请求借用列表，其余统计固定为 `0`，避免触发无权限或无意义的请求。
async function loadPublicDashboardCounts(): Promise<DashboardCounts> {
  const borrowRes = await inventoryAPI.getMyBorrows();
  return {
    reagentCount: 0,
    reagentArrivalOverdueCount: 0,
    consumableCount: 0,
    consumableReceiptOverdueCount: 0,
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
    reagentArrivalOverdueCount: countGroupedApprovedOrderOverdue(reagentGrouped),
    consumableCount: countGroupedOrders(consumableGrouped),
    consumableReceiptOverdueCount: countGroupedApprovedOrderOverdue(consumableGrouped),
    borrowCount: (borrowRes.data?.data ?? []).length,
    borrowOverdueCount: borrowRes.data?.overdue_count ?? 0,
    stockinCount: (stockinRes.data?.data ?? []).length,
  };
}

function loadDashboardCountsByRole(isPublicUser: boolean): Promise<DashboardCounts> {
  return isPublicUser ? loadPublicDashboardCounts() : loadMemberDashboardCounts();
}

// 个人统计只在当前组件生命周期内保存快照；刷新后数值不变时不触发界面更新。
export function useDashboardCounts(
  userKey: string,
  isPublicUser: boolean,
  refreshToken: number,
  queryEnabled: boolean,
): DashboardCountsState {
  const [countsState, setCountsState] = useState<{
    userKey: string;
    counts: DashboardCounts;
  } | null>(null);
  const counts =
    queryEnabled && countsState?.userKey === userKey
      ? countsState.counts
      : EMPTY_COUNTS;
  const isLoading = queryEnabled && countsState?.userKey !== userKey;

  useEffect(() => {
    if (!queryEnabled) {
      return;
    }

    let cancelled = false;
    const applyCounts = (nextCounts: DashboardCounts) => {
      if (cancelled) {
        return;
      }

      setCountsState((prev) => {
        if (prev?.userKey === userKey && isCountsEqual(prev.counts, nextCounts)) {
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
  }, [isPublicUser, queryEnabled, refreshToken, userKey]);

  return { counts, isLoading };
}

// 子 Tab 的增删改不会自动刷新顶部统计，这里把跨组件刷新事件折叠成 `refreshToken`。
export function useDashboardRefreshToken(): number {
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

export type DashboardCardItem = {
  tab: DashboardTab;
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  value: React.ReactNode;
};

export type ManagementCardItem = {
  tab?: DashboardTab;
  title: string;
  titleSuffix?: React.ReactNode;
  icon: React.ElementType;
  value: React.ReactNode;
  description: string;
};

function formatManagementDelta(delta: number, isLoading: boolean): string {
  if (isLoading) {
    return "较昨日 --";
  }
  return `较昨日 ${delta >= 0 ? "+" : ""}${delta}`;
}

function getCardAlertBadge(text: string): React.ReactNode {
  return getCardAlertBadgeWithTone(text);
}

function getCardAlertBadgeWithTone(
  text: string,
  tone: DashboardAlertTone = "destructive",
): React.ReactNode {
  return (
    <span className={getDashboardAlertBadgeClassName(tone)}>
      {text}
    </span>
  );
}

function getCardAlertBadges(
  items: Array<{ count: number; label: string; tone?: DashboardAlertTone }>,
): React.ReactNode {
  const visibleItems = items.filter((item) => item.count > 0);
  if (visibleItems.length === 0) {
    return undefined;
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {visibleItems.map((item) => (
        <span
          key={item.label}
          className={getDashboardAlertBadgeClassName(item.tone)}
        >
          {item.count} 个{item.label}
        </span>
      ))}
    </span>
  );
}

// `public` 只展示借用卡片；非 `public` 才展示订单和待入库卡片，loading 时 `value` 可以是节点。
export function getDashboardCardItems(
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
            getCardAlertBadge(`${counts.borrowOverdueCount} 个超时`)
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
      titleSuffix:
        !isLoading && counts.reagentArrivalOverdueCount > 0
          ? getCardAlertBadgeWithTone(
              `${counts.reagentArrivalOverdueCount} 个到货超时`,
              "warning",
            )
          : undefined,
    },
    {
      tab: "consumables",
      title: "耗材订单",
      icon: ShoppingCart,
      value: isLoading ? loadingValue : counts.consumableCount,
      titleSuffix:
        !isLoading && counts.consumableReceiptOverdueCount > 0
          ? getCardAlertBadgeWithTone(
              `${counts.consumableReceiptOverdueCount} 个收货超时`,
              "warning",
            )
          : undefined,
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

export function getManagementCardItems(
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
      titleSuffix: isLoading
        ? undefined
        : getCardAlertBadges([
            { count: summary.pending_reagent_overdue_count, label: "审批超时" },
            {
              count: summary.long_unarrived_approved_reagent_count,
              label: "到货超时",
              tone: "warning",
            },
          ]),
      icon: ShoppingCart,
      value: value(summary.reagent_order_count),
      description: formatManagementDelta(summary.reagent_order_delta, isLoading),
    },
    {
      tab: "consumables",
      title: "活跃耗材订单",
      titleSuffix: isLoading
        ? undefined
        : getCardAlertBadges([
            { count: summary.pending_consumable_overdue_count, label: "审批超时" },
            {
              count: summary.long_unconfirmed_approved_consumable_count,
              label: "收货超时",
              tone: "warning",
            },
          ]),
      icon: ShoppingCart,
      value: value(summary.consumable_order_count),
      description: formatManagementDelta(summary.consumable_order_delta, isLoading),
    },
    {
      tab: "borrows",
      title: "正在借用",
      titleSuffix:
        !isLoading && summary.overdue_borrow_count > 0
          ? getCardAlertBadge(`${summary.overdue_borrow_count} 个超时`)
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
  long_unarrived_approved_reagent_count: 0,
  long_unconfirmed_approved_consumable_count: 0,
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
  item_counts: { todo_items: 0, risk_items: 0, stock_alert_items: 0 },
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
  item_counts: { action_items: 0, order_overview_items: 0, stock_alert_items: 0 },
  recent_window_days: 7,
  system_version: "",
  generated_at: "",
};

export const ADMIN_SUMMARY_STALE_TIME_MS = 60 * 1000;
export const ADMIN_SUMMARY_GC_TIME_MS = 10 * 60 * 1000;
export const DASHBOARD_SECTION_DETAIL_QUERY_KEY = ["dashboard", "section", "detail"] as const;

const BOARD_SUMMARY_QUERY_KEY = ["dashboard", "board", "summary"] as const;
const BOARD_WINDOW_STATS_QUERY_KEY = ["dashboard", "board", "window-stats"] as const;
const BOARD_PUBLIC_ANNOUNCEMENTS_QUERY_KEY = ["dashboard", "board", "announcements"] as const;
const ADMIN_SUMMARY_QUERY_KEY = ["dashboard", "admin", "summary"] as const;
const ADMIN_WINDOW_STATS_QUERY_KEY = ["dashboard", "admin", "window-stats"] as const;
const DASHBOARD_WINDOW_DEBOUNCE_MS = 200;
const ADMIN_SUMMARY_SSE_ROOMS = ["reagent_orders", "consumable_orders", "inventory", "common_shelf"];
const ADMIN_SUMMARY_SSE_EVENTS = [
  ...REAGENT_ORDER_SSE_EVENTS,
  ...CONSUMABLE_ORDER_SSE_EVENTS,
  ...INVENTORY_SSE_EVENTS,
  ...COMMON_SHELF_SSE_EVENTS,
];

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
    queryClient
      .invalidateQueries({ queryKey: DASHBOARD_SECTION_DETAIL_QUERY_KEY })
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

export function useAdminDashboardData({
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

export function useDashboardBoardData({
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
