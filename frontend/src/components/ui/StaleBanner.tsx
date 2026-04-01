/**
 * Banner shown when list snapshot is considered structurally stale.
 *
 * Keep it independent so each page can opt in with minimal wiring.
 */
import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSSEStore } from "@/store/sseStore";

interface StaleBannerProps {
  staleKey: string;
  onRefresh: () => void | Promise<void>;
}

export function StaleBanner({ staleKey, onRefresh }: StaleBannerProps) {
  const isStale = useSSEStore((state) => state.hasStaleKey(staleKey));
  const clearStaleKey = useSSEStore((state) => state.clearStaleKey);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
      clearStaleKey(staleKey);
    } finally {
      setIsRefreshing(false);
    }
  }, [clearStaleKey, onRefresh, staleKey]);

  if (!isStale) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card/96 px-2 py-1.5 shadow-lg backdrop-blur dark:border-2 dark:border-input">
        <span className="truncate px-2 text-sm text-foreground">
          检测到更新
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="size-8 rounded-full px-3 shadow-none"
        >
          <RefreshCw
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    </div>
  );
}
