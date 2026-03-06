import { useState, useEffect } from 'react'
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
// 返回 true 表示已关闭（不显示），返回 false 表示未关闭（需要显示）
// 使用 UTC 时间比较
const isAnnouncementClosed = (id: number, updatedAt?: string): boolean => {
  const storage = getClosedStorage()
  const key = id.toString()
  const timestamp = storage[key]
  
  if (!timestamp) return false // 从未关闭过
  
  const now = Date.now()
  
  // 1. 检查是否超过 24 小时
  if (now - timestamp > CLOSED_DURATION) {
    // 已过期，删除记录并返回 false（需要重新显示）
    delete storage[key]
    localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
    return false
  }
  
  // 2. 检查公告是否有更新 - 使用 UTC 时间比较
  if (updatedAt) {
    // 处理带 Z 和不带 Z 的 ISO 字符串
    const parseUTC = (dateStr: string): number => {
      const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z'
      return new Date(normalized).getTime()
    }
    
    const updatedTime = parseUTC(updatedAt)
    
    console.log('[AnnouncementBanner] check update:', { id, updatedAt, timestamp, updatedTime, isUpdated: updatedTime > timestamp })
    
    // 如果公告更新时间晚于关闭时间，说明公告有更新，需要重新显示
    if (updatedTime > timestamp) {
      delete storage[key]
      localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
      return false
    }
  }
  
  return true // 关闭状态有效
}

export function AnnouncementBanner({ announcements }: AnnouncementBannerProps) {
  const [visibleAnnouncements, setVisibleAnnouncements] = useState<Announcement[]>([])
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  useEffect(() => {
    const filtered = announcements.filter(
      (a) => a.is_pinned && a.is_visible && !isAnnouncementClosed(a.id, a.updated_at)
    )
    setVisibleAnnouncements(filtered)
  }, [announcements, isAnnouncementClosed])

  if (visibleAnnouncements.length === 0) return <div className="flex-1" />

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
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover/item:bg-primary mr-2.5 shrink-0 transition-colors" />
          <span className="text-sm md:text-base text-foreground/80 group-hover/item:text-foreground transition-colors">
            {announcement.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              const storage = getClosedStorage()
              storage[announcement.id.toString()] = Date.now()
              localStorage.setItem(CLOSED_KEY, JSON.stringify(storage))
              setVisibleAnnouncements(prev => prev.filter(a => a.id !== announcement.id))
            }}
            className="ml-3 p-0.5 rounded-full hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover/item:opacity-100 transition-all"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </>
  )

  return (
    <>
      <div className="marquee-root flex-1 h-full">
        {/* 第一组内容 */}
        <div className="marquee-content">
          {renderItems()}
        </div>
        {/* 第二组完全相同的内容，紧随其后 */}
        <div className="marquee-content" aria-hidden="true">
          {renderItems()}
        </div>

        {/* 边缘遮罩：确保颜色与 Header 背景 page-card 匹配 */}
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-page-card to-transparent pointer-events-none z-20" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-page-card to-transparent pointer-events-none z-20" />
      </div>

      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </>
  )
}