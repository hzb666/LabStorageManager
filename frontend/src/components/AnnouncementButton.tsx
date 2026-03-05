import { useState, useEffect, useRef } from 'react'
import { Bell, X } from 'lucide-react'
import { Announcement } from '@/api/client'
import { AnnouncementDetail } from './AnnouncementDetail'

interface AnnouncementButtonProps {
  announcements: Announcement[]
}

const READ_KEY_PREFIX = 'announcement_read_'

export function AnnouncementButton({ announcements }: AnnouncementButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filter to visible announcements (both pinned and unpinned)
  const visibleAnnouncements = announcements.filter((a) => a.is_visible)

  // Calculate unread count (announcements not marked as read)
  const unreadCount = visibleAnnouncements.filter((announcement) => {
    const isRead = localStorage.getItem(`${READ_KEY_PREFIX}${announcement.id}`)
    return !isRead
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
    // Mark as read
    localStorage.setItem(`${READ_KEY_PREFIX}${announcement.id}`, 'true')
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
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        title="公告列表"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold text-primary-foreground bg-destructive rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 md:w-96 max-h-[400px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold">公告列表</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-muted rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-border">
            {visibleAnnouncements.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground">
                暂无公告
              </div>
            ) : (
              visibleAnnouncements.map((announcement) => {
                const isRead = localStorage.getItem(`${READ_KEY_PREFIX}${announcement.id}`)
                return (
                  <div
                    key={announcement.id}
                    onClick={() => handleAnnouncementClick(announcement)}
                    className={`px-4 py-3 cursor-pointer hover:bg-muted transition-colors ${
                      !isRead ? 'bg-accent/30' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!isRead && (
                        <span className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {announcement.is_pinned && (
                            <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded">
                              置顶
                            </span>
                          )}
                          <span className={`font-medium truncate ${!isRead ? '' : 'text-muted-foreground'}`}>
                            {announcement.title}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {announcement.content.replace(/<[^>]*>/g, '')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(announcement.created_at).toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
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
