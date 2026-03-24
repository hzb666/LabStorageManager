import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { type Announcement } from '@/api/client'
import { ANNOUNCEMENT_CLOSED_DURATION_MS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { AnnouncementDetail } from './AnnouncementDetail'

interface AnnouncementBannerProps {
  announcements: Announcement[]
}

const CLOSED_KEY = 'announcement_closed'
const BANNER_ITEM_CLASS_NAME = cn(
  'inline-flex items-center mx-4 px-4 py-1.5 h-9 cursor-pointer transition-all duration-200 rounded-md border border-transparent group/item shrink-0',
  'hover:bg-card hover:border-input hover:shadow-xs',
  'dark:hover:bg-input/30 dark:hover:border-2'
)
const DISMISS_BUTTON_CLASS_NAME =
  'ml-3 p-0.5 rounded-full bg-destructive text-white opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-destructive/80'
type ClosedAnnouncementStorage = Record<string, number>

/** 统一生成公告关闭态在本地存储中的索引键。 */
const getAnnouncementStorageKey = (id: number): string => id.toString()

/** 读取本地关闭态快照，异常时回退为空对象。 */
const getClosedStorage = (): ClosedAnnouncementStorage => {
  try {
    const data = localStorage.getItem(CLOSED_KEY)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

/** 持久化整个公告关闭态存储对象。 */
const setClosedStorage = (storage: ClosedAnnouncementStorage): void => {
  localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
}

/** 删除指定公告的关闭态记录，并同步写回本地存储。 */
const removeClosedAnnouncement = (
  storage: ClosedAnnouncementStorage,
  key: string
): void => {
  delete storage[key]
  setClosedStorage(storage)
}

/** 记录用户手动关闭公告的时间戳。 */
const dismissAnnouncement = (id: number): void => {
  const storage = getClosedStorage()
  storage[getAnnouncementStorageKey(id)] = Date.now()
  setClosedStorage(storage)
}

/** 解析后端返回的 UTC 时间文本，并兼容缺失 `Z` 的旧格式。 */
const parseUtcTimestamp = (dateStr: string): number => {
  const normalized = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
  return new Date(normalized).getTime()
}

/** 判断公告当前是否仍处于关闭态，并在过期后清理本地记录。 */
const isAnnouncementClosed = (id: number, updatedAt?: string): boolean => {
  const storage = getClosedStorage()
  const key = getAnnouncementStorageKey(id)
  const timestamp = storage[key]

  if (!timestamp) {
    return false
  }

  const now = Date.now()

  if (now - timestamp > ANNOUNCEMENT_CLOSED_DURATION_MS) {
    removeClosedAnnouncement(storage, key)
    return false
  }

  if (updatedAt && parseUtcTimestamp(updatedAt) > timestamp) {
    removeClosedAnnouncement(storage, key)
    return false
  }

  return true
}

interface AnnouncementBannerItemProps {
  announcement: Announcement
  onDismiss: (id: number) => void
  onOpen: (announcement: Announcement) => void
}

/** 渲染单条跑马灯公告项，并提供打开详情与关闭动作。 */
function AnnouncementBannerItem({
  announcement,
  onDismiss,
  onOpen,
}: Readonly<AnnouncementBannerItemProps>) {
  return (
    <div
      onClick={() => onOpen(announcement)}
      className={BANNER_ITEM_CLASS_NAME}
    >
      <span className="size-1 rounded-full bg-primary/40 group-hover/item:bg-primary mr-2.5 shrink-0 transition-colors" />
      <span className="text-sm md:text-base text-foreground/80 group-hover/item:text-foreground transition-colors">
        {announcement.title}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onDismiss(announcement.id)
        }}
        className={DISMISS_BUTTON_CLASS_NAME}
      >
        <X className="size-3.5 stroke-3" />
      </button>
    </div>
  )
}

interface AnnouncementBannerItemsProps {
  announcements: Announcement[]
  onDismiss: (id: number) => void
  onOpen: (announcement: Announcement) => void
}

/** 渲染跑马灯中的公告项列表，供双轨滚动区域复用。 */
function AnnouncementBannerItems({
  announcements,
  onDismiss,
  onOpen,
}: Readonly<AnnouncementBannerItemsProps>) {
  return (
    <>
      {announcements.map((announcement) => (
        <AnnouncementBannerItem
          key={announcement.id}
          announcement={announcement}
          onDismiss={onDismiss}
          onOpen={onOpen}
        />
      ))}
    </>
  )
}

/** 渲染顶部公告横幅，并管理详情弹窗与本地关闭态过滤。 */
export function AnnouncementBanner({ announcements }: Readonly<AnnouncementBannerProps>) {
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const visibleAnnouncements = useMemo(
    () =>
      announcements.filter(
        (a) =>
          a.is_pinned &&
          a.is_visible &&
          !isAnnouncementClosed(a.id, a.updated_at) &&
          !dismissedIds.includes(a.id)
      ),
    [announcements, dismissedIds]
  )

  if (visibleAnnouncements.length === 0) {
    return <div className="hidden md:block flex-1" />
  }

  /** 打开当前选中的公告详情弹窗。 */
  const handleOpenAnnouncement = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
    setIsDetailOpen(true)
  }

  /** 记录公告关闭动作，并把当前条目从本次渲染结果中移除。 */
  const handleDismissAnnouncement = (id: number) => {
    dismissAnnouncement(id)
    setDismissedIds((prev) => [...prev, id])
  }

  return (
    <>
      <div className="hidden md:flex flex-1 h-full overflow-hidden">
        <div className="marquee-root flex-1 h-full relative">
          <div className="marquee-content">
            <AnnouncementBannerItems
              announcements={visibleAnnouncements}
              onDismiss={handleDismissAnnouncement}
              onOpen={handleOpenAnnouncement}
            />
          </div>
          <div className="marquee-content" aria-hidden="true">
            <AnnouncementBannerItems
              announcements={visibleAnnouncements}
              onDismiss={handleDismissAnnouncement}
              onOpen={handleOpenAnnouncement}
            />
          </div>

          <div className="absolute left-0 top-0 bottom-0 w-16 bg-linear-to-r from-page-card to-transparent pointer-events-none z-20" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-linear-to-l from-page-card to-transparent pointer-events-none z-20" />
        </div>
      </div>

      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </>
  )
}
