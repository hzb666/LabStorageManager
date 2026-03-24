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
const ANNOUNCEMENT_DROPDOWN_ITEM_CLASS_NAME =
  'px-4 py-3 cursor-pointer hover:bg-accent dark:hover:bg-input/50 transition-colors'

/** 统一生成公告已读态在本地存储中的索引键。 */
const getAnnouncementStorageKey = (id: number): string => id.toString()

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
  storage[getAnnouncementStorageKey(id)] = Date.now()
  localStorage.setItem(READ_KEY, JSON.stringify(storage))
}

/** 解析后端返回的 UTC 时间文本，并兼容缺失 `Z` 的旧格式。 */
const parseUtcTimestamp = (dateStr: string): number => {
  const normalized = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
  return new Date(normalized).getTime()
}

/** 线性移除摘要中的 HTML 标签，同时保留未闭合标签后的原始文本。 */
const stripHtmlTags = (content: string): string => {
  let result = ''
  let currentIndex = 0

  while (currentIndex < content.length) {
    if (content[currentIndex] !== '<') {
      result += content[currentIndex]
      currentIndex += 1
      continue
    }

    const closingTagIndex = content.indexOf('>', currentIndex + 1)
    if (closingTagIndex === -1) {
      result += content[currentIndex]
      currentIndex += 1
      continue
    }

    currentIndex = closingTagIndex + 1
  }

  return result
}

// 检查公告是否已读
const checkAnnouncementRead = (id: number, currentUpdatedAt: string): boolean => {
  const storage = getReadStorage()
  const key = getAnnouncementStorageKey(id)
  const timestamp = storage[key]

  if (!timestamp) return false

  const updatedTime = parseUtcTimestamp(currentUpdatedAt)

  if (updatedTime > timestamp) {
    delete storage[key]
    localStorage.setItem(READ_KEY, JSON.stringify(storage))
    return false
  }
  return true
}

/** 渲染公告按钮、未读角标、下拉列表与详情弹窗。 */
export function AnnouncementButton({ announcements }: Readonly<AnnouncementButtonProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const visibleAnnouncements = announcements.filter((a) => a.is_visible)

  const unreadCount = visibleAnnouncements.filter((announcement) => {
    return !checkAnnouncementRead(announcement.id, announcement.updated_at)
  }).length

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  /** 打开公告详情并在同一时刻标记为已读。 */
  const handleAnnouncementClick = (announcement: Announcement) => {
    setAnnouncementRead(announcement.id)
    setSelectedAnnouncement(announcement)
    setIsDetailOpen(true)
    setIsOpen(false)
  }

  /** 根据未读态返回下拉项样式，保持已读与未读视觉区分。 */
  const getAnnouncementItemClassName = (unread: boolean): string => {
    if (unread) {
      return `${ANNOUNCEMENT_DROPDOWN_ITEM_CLASS_NAME} bg-accent/30`
    }

    return ANNOUNCEMENT_DROPDOWN_ITEM_CLASS_NAME
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setIsOpen(!isOpen)}
            variant="ghost"
            size="icon"
            className="h-10 w-10 transition-colors"
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4.5 h-4.5 text-sm font-bold text-destructive-foreground bg-destructive rounded-full px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>公告列表</p>
        </TooltipContent>
      </Tooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[85vw] md:w-96 max-h-100 overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
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
              <div className="px-4 py-8 text-center text-muted-foreground">暂无公告</div>
            ) : (
              visibleAnnouncements.map((announcement) => {
                const unread = !checkAnnouncementRead(announcement.id, announcement.updated_at)
                return (
                  <div
                    key={announcement.id}
                    onClick={() => handleAnnouncementClick(announcement)}
                    className={getAnnouncementItemClassName(unread)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {unread && (
                            <span className="size-2 bg-destructive rounded-full shrink-0" />
                          )}
                          {announcement.is_pinned && (
                            <Pin className="size-3 text-amber-600 dark:text-amber-500 shrink-0" />
                          )}
                          <span className={`font-bold truncate text-base ${unread ? '' : 'text-muted-foreground'}`}>
                            {announcement.title}
                          </span>
                          <span className="ml-auto text-sm text-muted-foreground shrink-0">
                            {formatDate(announcement.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {stripHtmlTags(announcement.content)}
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

      {/* 父组件不用再传 hasImages 了，最干净的调用方式 */}
      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </div>
  )
}
