import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Package, ShoppingCart } from "lucide-react";

import {
  dashboardAPI,
  type AdminDashboardSummary,
  type AdminDashboardWindowStats,
  type DashboardBoardSummary,
  type PersonalDashboardSummary,
} from "@/api/client";
import { useSSE } from "@/hooks/useSSE";
import {
  getDashboardAlertBadgeClassName,
  type DashboardTab,
  type DashboardAlertTone,
  subscribeDashboardCountsRefresh,
} from "@/lib/dashboardUtils";
import { getPublicAnnouncementsQueryOptions } from "@/lib/announcementQueries";
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
  stockinOverdueCount: number;
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
  stockinOverdueCount: 0,
};

const PERSONAL_SUMMARY_QUERY_KEY = ["dashboard", "personal", "summary"] as const;
const PERSONAL_SUMMARY_SSE_ROOMS = ["reagent_orders", "consumable_orders", "inventory"];
const PERSONAL_SUMMARY_SSE_EVENTS = [
  ...REAGENT_ORDER_SSE_EVENTS,
  ...CONSUMABLE_ORDER_SSE_EVENTS,
  ...INVENTORY_SSE_EVENTS,
];

function mapPersonalSummaryToCounts(summary: PersonalDashboardSummary): DashboardCounts {
  return {
    reagentCount: summary.reagent_count,
    reagentArrivalOverdueCount: summary.reagent_arrival_overdue_count,
    consumableCount: summary.consumable_count,
    consumableReceiptOverdueCount: summary.consumable_receipt_overdue_count,
    borrowCount: summary.borrow_count,
    borrowOverdueCount: summary.borrow_overdue_count,
    stockinCount: summary.stockin_count,
    stockinOverdueCount: summary.stockin_overdue_count,
  };
}

function useModeAwareReconnect(
  enabled: boolean,
  refreshSnapshot: () => void,
): () => void {
  const previousEnabledRef = useRef(enabled);
  const skipNextReconnectRef = useRef(false);

  useEffect(() => {
    if (enabled && !previousEnabledRef.current) {
      skipNextReconnectRef.current = true;
    }
    previousEnabledRef.current = enabled;
  }, [enabled]);

  return useCallback(() => {
    if (skipNextReconnectRef.current) {
      skipNextReconnectRef.current = false;
      return;
    }
    refreshSnapshot();
  }, [refreshSnapshot]);
}

function usePersonalSummarySSE(enabled: boolean, queryKey: readonly string[]) {
  const queryClient = useQueryClient();
  const refreshSummary = useCallback(() => {
    queryClient.invalidateQueries({ queryKey }).catch(() => {});
  }, [queryClient, queryKey]);
  const handleReconnect = useModeAwareReconnect(enabled, refreshSummary);
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        PERSONAL_SUMMARY_SSE_EVENTS.map((eventType) => [eventType, refreshSummary]),
      ),
    [refreshSummary],
  );

  useSSE({
    rooms: PERSONAL_SUMMARY_SSE_ROOMS,
    handlers,
    autoConnect: enabled,
    onReconnect: handleReconnect,
    onStreamStale: refreshSummary,
  });
}

// 个人模式只获取聚合快照；SSE 和跨组件刷新事件都失效同一 Query。
export function useDashboardCounts(
  userKey: string,
  refreshToken: number,
  queryEnabled: boolean,
): DashboardCountsState {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [...PERSONAL_SUMMARY_QUERY_KEY, userKey] as const,
    [userKey],
  );
  const previousRefreshTokenRef = useRef(refreshToken);
  usePersonalSummarySSE(queryEnabled, queryKey);
  const summaryQuery = useQuery({
    queryKey,
    enabled: queryEnabled,
    staleTime: DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS,
    gcTime: ADMIN_SUMMARY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await dashboardAPI.getPersonalSummary();
      return mapPersonalSummaryToCounts(response.data.data);
    },
  });

  useEffect(() => {
    if (previousRefreshTokenRef.current === refreshToken) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    if (queryEnabled) {
      queryClient.invalidateQueries({ queryKey }).catch(() => {});
    }
  }, [queryClient, queryEnabled, queryKey, refreshToken]);

  return {
    counts: queryEnabled ? summaryQuery.data ?? EMPTY_COUNTS : EMPTY_COUNTS,
    isLoading: queryEnabled && summaryQuery.isPending,
  };
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
      titleSuffix:
        !isLoading && counts.stockinOverdueCount > 0
          ? getCardAlertBadge(`${counts.stockinOverdueCount} 个超时`)
          : undefined,
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
  item_counts: { todo_items: 0, risk_items: 0, stock_alert_items: 0, recent_actions: 0 },
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

const DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS = 0;
const BOARD_SUMMARY_QUERY_KEY = ["dashboard", "board", "summary"] as const;
const BOARD_WINDOW_STATS_QUERY_KEY = ["dashboard", "board", "window-stats"] as const;
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

function getAdminSummaryWindowStats(
  summary: AdminDashboardSummary,
): AdminDashboardWindowStats {
  return {
    recent_window_days: summary.recent_window_days,
    is_all_time: summary.is_all_time ?? false,
    recent_arrival_count: summary.recent_arrival_count,
    recent_reagent_order_count: summary.recent_reagent_order_count ?? 0,
    recent_consumable_order_count: summary.recent_consumable_order_count ?? 0,
    stock_in_activity_count: summary.stock_in_activity_count,
    order_total_value: summary.order_total_value ?? 0,
  };
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
  const handleReconnect = useModeAwareReconnect(enabled, refreshSummary);

  useSSE({
    rooms: ADMIN_SUMMARY_SSE_ROOMS,
    handlers,
    autoConnect: enabled,
    onReconnect: handleReconnect,
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
    staleTime: DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS,
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
    enabled:
      queryEnabled &&
      (summaryAllTime || debouncedSummaryWindowDays !== DASHBOARD_WINDOW_DEFAULT_DAYS),
    staleTime: DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS,
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
  const usesDefaultWindow =
    !summaryAllTime &&
    debouncedSummaryWindowDays === DASHBOARD_WINDOW_DEFAULT_DAYS;
  const adminWindowStats = usesDefaultWindow
    ? getAdminSummaryWindowStats(adminSummary)
    : currentWindowStats ?? EMPTY_ADMIN_WINDOW_STATS;
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
      !usesDefaultWindow && adminWindowStatsQuery.isError && !currentWindowStats,
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
    staleTime: DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS,
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
    staleTime: DASHBOARD_MODE_SNAPSHOT_STALE_TIME_MS,
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
    ...getPublicAnnouncementsQueryOptions(),
    enabled: queryEnabled,
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
