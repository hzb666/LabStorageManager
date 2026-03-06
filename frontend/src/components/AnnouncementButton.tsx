import { useState, useEffect, useRef } from 'react'
import { Bell, Pin, X } from 'lucide-react'
import { type Announcement } from '@/api/client'
import { AnnouncementDetail } from './AnnouncementDetail'
import { Button } from './ui/Button'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip'
import { formatDate } from '@/lib/utils'

interface AnnouncementButtonProps {
  announcements: Announcement[]
}

const READ_KEY = 'announcement_read'

// 获取已读状态存储对象
const getReadStorage = (): Record<string, number> => {
  try {
    const data = localStorage.getItem(READ_KEY)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

// 设置公告为已读 - 只存储时间戳（用户点击时间）
const setAnnouncementRead = (id: number) => {
  const storage = getReadStorage()
  storage[id.toString()] = Date.now()
  localStorage.setItem(READ_KEY, JSON.stringify(storage))
}

// 检查公告是否已读 - 如果公告有更新则删除记录并视为未读
// 使用 UTC 毫秒数比较
const checkAnnouncementRead = (id: number, currentUpdatedAt: string): boolean => {
  const storage = getReadStorage()
  const key = id.toString()
  const timestamp = storage[key]
  
  if (!timestamp) {
    return false
  }
  
  // 将时间统一转换为 UTC 毫秒数进行比较
  // 处理带 Z 和不带 Z 的 ISO 字符串
  const parseUTC = (dateStr: string): number => {
    // 如果没有 Z 后缀，添加 Z 以便正确解析为 UTC
    const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z'
    return new Date(normalized).getTime()
  }
  
  const updatedTime = parseUTC(currentUpdatedAt)
  
  console.log('[Announcement] checkAnnouncementRead:', { 
    id, 
    currentUpdatedAt, 
    timestamp, 
    updatedTime,
    isUpdated: updatedTime > timestamp 
  })
  
  // 如果公告更新时间晚于用户点击时间，说明公告有更新，需要重新标记为未读
  if (updatedTime > timestamp) {
    delete storage[key]
    localStorage.setItem(READ_KEY, JSON.stringify(storage))
    return false
  }
  
  return true
}

export function AnnouncementButton({ announcements }: AnnouncementButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filter to visible announcements (both pinned and unpinned)
  const visibleAnnouncements = announcements.filter((a) => a.is_visible)

  // Calculate unread count (announcements that are not read or have been updated)
  const unreadCount = visibleAnnouncements.filter((announcement) => {
    return !checkAnnouncementRead(announcement.id, announcement.updated_at)
  }).length

  // Check if we should show the button (not mobile)
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const checkScreenSize = () => {
      setIsDesktop(window.innerWidth >= 768)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)

    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle clicking on an announcement item
  const handleAnnouncementClick = (announcement: Announcement) => {
    // Mark as read - store timestamp (permanent until announcement updates)
    setAnnouncementRead(announcement.id)
    setSelectedAnnouncement(announcement)
    setIsDetailOpen(true)
    setIsOpen(false)
  }

  // Don't render on mobile
  if (!isDesktop) {
    return null
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setIsOpen(!isOpen)}
            variant="ghost"
            size="icon"
            className="h-10 w-10 hidden md:flex transition-colors"
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] text-xs font-bold text-destructive-foreground bg-destructive rounded-full px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>公告列表</p>
        </TooltipContent>
      </Tooltip>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 md:w-96 max-h-[400px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h3 className="font-bold">公告列表</h3>
            <Button
              variant="ghost"
              className="size-8"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="divide-y divide-border">
            {visibleAnnouncements.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground">
                暂无公告
              </div>
            ) : (
              visibleAnnouncements.map((announcement) => {
                const unread = !checkAnnouncementRead(announcement.id, announcement.updated_at)
                return (
                  <div
                    key={announcement.id}
                    onClick={() => handleAnnouncementClick(announcement)}
                    className={`px-4 py-3 cursor-pointer hover:bg-accent dark:hover:bg-input/50 transition-colors ${
                      unread ? 'bg-accent/30' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {announcement.is_pinned && (
                            <Pin className="size-3 text-amber-600 dark:text-amber-500 shrink-0" />
                          )}
                          <span className={`font-bold truncate text-sm ${unread ? '' : 'text-muted-foreground'}`}>
                            {announcement.title}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground shrink-0">
                            {formatDate(announcement.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {announcement.content.replace(/<[^>]*>/g, '')}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Announcement Detail Dialog */}
      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </div>
  )
}
