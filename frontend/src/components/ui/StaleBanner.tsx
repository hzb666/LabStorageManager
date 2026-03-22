/**
 * Banner shown when list snapshot is considered structurally stale.
 *
 * Keep it independent so each page can opt in with minimal wiring.
 */
import { useCallback, useState } from 'react'
import { RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useSSEStore } from '@/store/sseStore'

interface StaleBannerProps {
  room: string
  onRefresh: () => void | Promise<void>
  message?: string
}

export function StaleBanner({ room, onRefresh, message }: StaleBannerProps) {
  const isStale = useSSEStore((state) => state.staleRooms.has(room))
  const clearRoomStale = useSSEStore((state) => state.clearRoomStale)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
      clearRoomStale(room)
    } finally {
      setIsRefreshing(false)
    }
  }, [clearRoomStale, onRefresh, room])

  if (!isStale) {
    return null
  }

  return (
    <div className="mb-4 flex items-center justify-between overflow-hidden rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 shadow-sm transition-all animate-in fade-in slide-in-from-top-4 duration-300 ease-out">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-4 w-4" />
        </div>
        <span className="text-sm  text-foreground">
          {message ?? '已接收到数据更新，点击刷新获取最新内容'}
        </span>
      </div>
      <Button
        variant="default"
        size="sm"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="h-8 shrink-0 shadow-none transition-colors"
      >
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isRefreshing ? '刷新中...' : '立即刷新'}
      </Button>
    </div>
  )
}
