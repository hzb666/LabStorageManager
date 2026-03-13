import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { type Announcement } from '@/api/client'
import { AnnouncementDetail } from './AnnouncementDetail'
import { cn } from '@/lib/utils'

interface AnnouncementBannerProps {
  announcements: Announcement[]
}

const CLOSED_KEY = 'announcement_closed'
const CLOSED_DURATION = 24 * 60 * 60 * 1000 // 24小时毫秒数

// 获取关闭状态存储对象
const getClosedStorage = (): Record<string, number> => {
  try {
    const data = localStorage.getItem(CLOSED_KEY)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

// 检查公告是否处于关闭状态
const isAnnouncementClosed = (id: number, updatedAt?: string): boolean => {
  const storage = getClosedStorage()
  const key = id.toString()
  const timestamp = storage[key]
  
  if (!timestamp) return false // 从未关闭过
  
  const now = Date.now()
  
  // 1. 检查是否超过 24 小时
  if (now - timestamp > CLOSED_DURATION) {
    delete storage[key]
    localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
    return false
  }
  
  // 2. 检查公告是否有更新
  if (updatedAt) {
    const parseUTC = (dateStr: string): number => {
      const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z'
      return new Date(normalized).getTime()
    }
    
    const updatedTime = parseUTC(updatedAt)
    
    if (updatedTime > timestamp) {
      delete storage[key]
      localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
      return false
    }
  }
  
  return true
}

export function AnnouncementBanner({ announcements }: AnnouncementBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // 💡 删除了臃肿的 isDesktop 状态和 window.resize 监听器
  // 交给强大的 Tailwind CSS 处理即可！

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

  // 💡 移动端隐藏，PC端显示空占位
  if (visibleAnnouncements.length === 0) {
    return <div className="hidden md:block flex-1" />
  }

  // 渲染单个公告按钮的函数
  const renderItems = () => (
    <>
      {visibleAnnouncements.map((announcement) => (
        <div
          key={announcement.id}
          onClick={() => {
            setSelectedAnnouncement(announcement)
            setIsDetailOpen(true)
          }}
          className={cn(
            "inline-flex items-center mx-4 px-4 py-1.5 h-9 cursor-pointer transition-all duration-200 rounded-md border border-transparent group/item shrink-0",
            "hover:bg-card hover:border-input hover:shadow-xs",
            "dark:hover:bg-input/30 dark:hover:border-2"
          )}
        >
          <span className="size-1 rounded-full bg-primary/40 group-hover/item:bg-primary mr-2.5 shrink-0 transition-colors" />
          <span className="text-sm md:text-base text-foreground/80 group-hover/item:text-foreground transition-colors">
            {announcement.title}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const storage = getClosedStorage()
              storage[announcement.id.toString()] = Date.now()
              localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
              setDismissedIds((prev) => [...prev, announcement.id])
            }}
            className="ml-3 p-0.5 rounded-full bg-destructive text-white opacity-0 group-hover/item:opacity-100 transition-opacity hover:bg-destructive/80"
          >
            <X className="size-3.5 stroke-3" />
          </button>
        </div>
      ))}
    </>
  )

 return (
    <>
      {/* 💡 核心修复：外层加一个纯净的包裹 div，专门用来在移动端隐藏它（彻底隔绝 marquee-root 样式的干扰） */}
      <div className="hidden md:flex flex-1 h-full overflow-hidden">
        
        {/* 里面的 marquee 逻辑保持原样，去掉 hidden 控制 */}
        <div className="marquee-root flex-1 h-full relative">
          <div className="marquee-content">
            {renderItems()}
          </div>
          <div className="marquee-content" aria-hidden="true">
            {renderItems()}
          </div>

          {/* 边缘遮罩 */}
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-page-card to-transparent pointer-events-none z-20" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-page-card to-transparent pointer-events-none z-20" />
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