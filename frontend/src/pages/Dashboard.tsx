/** 仪表盘页面容器。 */
import { useState, useCallback, useEffect, useMemo } from "react";

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
} from "../lib/dashboardUtils";
import {
  DASHBOARD_WINDOW_DEFAULT_DAYS,
  getDashboardCardItems,
  getDashboardModeSwitchVariant,
  getEffectiveDashboardMode,
  type DashboardMode,
  useAdminDashboardData,
  useDashboardBoardData,
  useDashboardCounts,
  useDashboardRefreshToken,
} from "./dashboard/dashboardData";
import {
  DashboardContent,
  DashboardHeader,
} from "./dashboard/dashboardPanels";

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
    // 持久化失败时沿用当前内存状态，不打断交互。
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
  const personalDashboardEnabled =
    (isAdmin || isMemberUser) && effectiveDashboardMode === "personal";
  const boardDashboardEnabled =
    isPublicUser || (isMemberUser && effectiveDashboardMode === "board");
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
    refreshToken,
    personalDashboardEnabled,
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
    queryEnabled: isAdmin && effectiveDashboardMode === "management",
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
    queryEnabled: boardDashboardEnabled,
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
