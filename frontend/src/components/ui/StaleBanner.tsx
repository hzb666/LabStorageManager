/**
 * 列表快照结构性过期时显示的横幅。
 *
 * 保持独立组件形态，页面只需少量接线即可接入。
 */
import { useCallback, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSSEStore } from "@/store/sseStore";
import { toast } from "@/lib/toast";

interface StaleBannerProps {
  staleKey: string;
  onRefresh: () => void | Promise<void>;
}

export function StaleBanner({ staleKey, onRefresh }: StaleBannerProps) {
  const isStale = useSSEStore((state) => state.hasStaleKey(staleKey));
  const clearStaleKey = useSSEStore((state) => state.clearStaleKey);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshLock = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    const version = useSSEStore.getState().staleVersions[staleKey] ?? 0;
    setIsRefreshing(true);
    try {
      await onRefresh();
      clearStaleKey(staleKey, version);
    } catch {
      toast.error("刷新失败，请稍后重试");
    } finally {
      setIsRefreshing(false);
      refreshLock.current = false;
    }
  }, [clearStaleKey, onRefresh, staleKey]);

  if (!isStale) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 shadow-lg dark:border-input" aria-busy={isRefreshing}>
        <span className="truncate px-2 text-sm text-foreground" role="status">
          {isRefreshing ? "正在刷新列表…" : "有新更新"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded-full px-3 shadow-none"
          aria-label="刷新列表"
        >
          <RefreshCw
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          刷新列表
        </Button>
      </div>
    </div>
  );
}
