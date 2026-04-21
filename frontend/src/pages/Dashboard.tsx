/** 仪表盘页面容器。 */
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Loader2,
  Package,
  PackageCheck,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { cn } from "@/lib/utils";
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
import { DashboardReagentTab } from "./dashboard/DashboardReagentTab";
import { DashboardConsumableTab } from "./dashboard/DashboardConsumableTab";
import { DashboardBorrowTab } from "./dashboard/DashboardBorrowTab";
import { DashboardStockinTab } from "./dashboard/DashboardStockinTab";

import {
  reagentOrderAPI,
  consumableOrderAPI,
  inventoryAPI,
  dashboardAPI,
  type AdminDashboardSummary,
} from "@/api/client";

type DashboardCounts = {
  reagentCount: number;
  consumableCount: number;
  borrowCount: number;
  stockinCount: number;
};

type DashboardCountsCache = {
  userKey: string;
  counts: DashboardCounts;
};

type DashboardCountsState = {
  counts: DashboardCounts;
  isLoading: boolean;
};

type DashboardCardItem = {
  tab: DashboardTab;
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
};

type DashboardMode = "personal" | "management";

type ManagementCardItem = {
  tab?: DashboardTab;
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  description: string;
};

const EMPTY_COUNTS: DashboardCounts = {
  reagentCount: 0,
  consumableCount: 0,
  borrowCount: 0,
  stockinCount: 0,
};

const EMPTY_ADMIN_SUMMARY: AdminDashboardSummary = {
  reagent_order_count: 0,
  consumable_order_count: 0,
  borrowed_inventory_count: 0,
  pending_stockin_count: 0,
  common_stock_alert_count: 0,
  recent_arrival_count: 0,
  stock_in_activity_count: 0,
  recent_window_days: 7,
  generated_at: "",
};

let dashboardCountsCache: DashboardCountsCache | null = null;

// 判断统计卡片数字是否真正发生变化，避免同值 `setState` 触发无效更新。
function isCountsEqual(a: DashboardCounts, b: DashboardCounts): boolean {
  return (
    a.reagentCount === b.reagentCount &&
    a.consumableCount === b.consumableCount &&
    a.borrowCount === b.borrowCount &&
    a.stockinCount === b.stockinCount
  );
}

// 统计卡片只负责展示标题、图标、数值和激活态，不参与数据获取或权限判断。
function StatCard({
  title,
  icon: Icon,
  value,
  onClick,
  isActive,
  description,
}: Readonly<{
  title: string;
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
        <CardTitle className="text-base">{title}</CardTitle>
        <Icon
          className={cn(
            "h-4 w-4",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-bold flex h-8 items-center",
            isActive && "text-primary",
          )}
        >
          {value}
        </div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
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

function getSavedDashboardMode(isAdmin: boolean): DashboardMode {
  if (!isAdmin) {
    return "personal";
  }
  try {
    return getDashboardModePreference() === "management"
      ? "management"
      : "personal";
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

// 模块级缓存按 `userKey` 隔离；有缓存时先显示缓存再后台刷新，无缓存时才显示 loading。
function useDashboardCounts(
  userKey: string,
  isPublicUser: boolean,
  refreshToken: number,
): DashboardCountsState {
  const cachedCountsForUser =
    dashboardCountsCache?.userKey === userKey
      ? dashboardCountsCache.counts
      : null;
  const [countsState, setCountsState] = useState<DashboardCountsCache | null>(
    () =>
      cachedCountsForUser ? { userKey, counts: cachedCountsForUser } : null,
  );
  const counts =
    countsState?.userKey === userKey
      ? countsState.counts
      : (cachedCountsForUser ?? EMPTY_COUNTS);
  const isLoading =
    cachedCountsForUser === null && countsState?.userKey !== userKey;

  useEffect(() => {
    let cancelled = false;
    const cachedCounts =
      dashboardCountsCache?.userKey === userKey
        ? dashboardCountsCache.counts
        : null;

    const applyCounts = (nextCounts: DashboardCounts) => {
      if (cancelled) {
        return;
      }

      dashboardCountsCache = {
        userKey,
        counts: nextCounts,
      };

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

    const syncCounts = async () => {
      try {
        const nextCounts = await loadDashboardCountsByRole(isPublicUser);
        applyCounts(nextCounts);
      } catch {
        if (cachedCounts !== null) {
          return;
        }
        applyCounts(EMPTY_COUNTS);
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
}: Readonly<{
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
}>) {
  return (
    <RadioGroup
      value={mode}
      onValueChange={(value) => onModeChange(value as DashboardMode)}
      className="flex flex-row items-center gap-4 rounded-md border bg-card px-3 py-2"
      aria-label="仪表盘模式"
    >
      <div className="flex items-center gap-2">
        <RadioGroupItem value="personal" id="dashboard-mode-personal" />
        <Label htmlFor="dashboard-mode-personal" className="cursor-pointer">
          个人模式
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="management" id="dashboard-mode-management" />
        <Label htmlFor="dashboard-mode-management" className="cursor-pointer">
          管理模式
        </Label>
      </div>
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
      title: "全部试剂订单",
      icon: ShoppingCart,
      value: value(summary.reagent_order_count),
      description: "待审批、已批准、近一周驳回",
    },
    {
      tab: "consumables",
      title: "全部耗材订单",
      icon: ShoppingCart,
      value: value(summary.consumable_order_count),
      description: "待审批、已批准、近一周驳回",
    },
    {
      tab: "borrows",
      title: "正在借用",
      icon: Package,
      value: value(summary.borrowed_inventory_count),
      description: "所有未归还试剂",
    },
    {
      tab: "stockin",
      title: "正在暂存",
      icon: ArrowRightLeft,
      value: value(summary.pending_stockin_count),
      description: "所有待补全入库试剂",
    },
    {
      title: "常用库存告警",
      icon: AlertTriangle,
      value: value(summary.common_stock_alert_count),
      description: "常用货架剩余 1 瓶及以下",
    },
    {
      title: "近期到货",
      icon: PackageCheck,
      value: value(summary.recent_arrival_count),
      description: `近 ${summary.recent_window_days} 天到货待入库`,
    },
    {
      title: "入库活动",
      icon: Warehouse,
      value: value(summary.stock_in_activity_count),
      description: `近 ${summary.recent_window_days} 天入库记录`,
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
  isAdmin,
  mode,
  onModeChange,
}: Readonly<{
  isAdmin: boolean;
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
}>) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 className="text-3xl font-bold text-primary card-title-placeholder">
        仪表盘
      </h1>
      {isAdmin ? (
        <DashboardModeSwitch mode={mode} onModeChange={onModeChange} />
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

function DashboardContent({
  activeTab,
  cards,
  dashboardMode,
  isAdmin,
  isPublicUser,
  managementActiveTab,
  managementCards,
  onManagementTabChange,
  onTabChange,
}: Readonly<{
  activeTab: DashboardTab;
  cards: DashboardCardItem[];
  dashboardMode: DashboardMode;
  isAdmin: boolean;
  isPublicUser: boolean;
  managementActiveTab: DashboardTab | null;
  managementCards: ManagementCardItem[];
  onManagementTabChange: (tab: DashboardTab) => void;
  onTabChange: (tab: DashboardTab) => void;
}>) {
  if (dashboardMode === "management" && isAdmin) {
    return (
      <>
        <ManagementDashboardStats
          cards={managementCards}
          activeTab={managementActiveTab}
          onTabChange={onManagementTabChange}
        />
        <ManagementDashboardTable activeTab={managementActiveTab} />
      </>
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
  const userKey = `${currentUser?.id ?? "anonymous"}-${currentUser?.role ?? "unknown"}`;
  const refreshToken = useDashboardRefreshToken();
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(() =>
    getSavedDashboardMode(currentUser?.role === UserRoles.ADMIN),
  );
  const [managementActiveTab, setManagementActiveTab] =
    useState<DashboardTab | null>(null);
  const effectiveDashboardMode = isAdmin ? dashboardMode : "personal";
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
  const adminSummaryQuery = useQuery({
    queryKey: ["dashboard", "admin", "summary"],
    enabled: isAdmin && effectiveDashboardMode === "management",
    queryFn: async () => {
      const response = await dashboardAPI.getAdminSummary();
      return response.data.data;
    },
  });
  const adminSummary = adminSummaryQuery.data ?? EMPTY_ADMIN_SUMMARY;
  const managementCards = useMemo(
    () => getManagementCardItems(adminSummary, adminSummaryQuery.isLoading),
    [adminSummary, adminSummaryQuery.isLoading],
  );

  useEffect(() => {
    if (isAdmin) {
      saveDashboardMode(dashboardMode);
    }
  }, [dashboardMode, isAdmin]);

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
      if (!isAdmin) {
        return;
      }
      setDashboardMode(mode);
      if (mode === "management") {
        setManagementActiveTab(null);
      }
    },
    [isAdmin],
  );
  const handleManagementTabChange = useCallback((tab: DashboardTab) => {
    setManagementActiveTab((current) => (current === tab ? null : tab));
  }, []);

  useEffect(() => {
    saveTab(activeTab);
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <DashboardHeader
        isAdmin={isAdmin}
        mode={effectiveDashboardMode}
        onModeChange={handleDashboardModeChange}
      />
      <DashboardContent
        activeTab={activeTab}
        cards={cards}
        dashboardMode={effectiveDashboardMode}
        isAdmin={isAdmin}
        isPublicUser={isPublicUser}
        managementActiveTab={managementActiveTab}
        managementCards={managementCards}
        onManagementTabChange={handleManagementTabChange}
        onTabChange={handleTabChange}
      />
    </div>
  );
}
