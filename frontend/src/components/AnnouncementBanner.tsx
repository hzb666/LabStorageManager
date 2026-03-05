import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { type Announcement } from '@/api/client'
import { AnnouncementDetail } from './AnnouncementDetail'

interface AnnouncementBannerProps {
  announcements: Announcement[]
}

const CLOSED_KEY_PREFIX = 'announcement_closed_'
const CLOSED_DURATION = 24 * 60 * 60 * 1000 // 1 day in milliseconds

export function AnnouncementBanner({ announcements }: AnnouncementBannerProps) {
  // Filter to pinned and visible announcements that are not closed
  const [visibleAnnouncements, setVisibleAnnouncements] = useState<Announcement[]>([])
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // For pinned announcements - always show (ignore closed status)
  // Non-pinned announcements are not returned by the API anyway
  const shouldShowAnnouncement = useCallback((announcement: Announcement): boolean => {
    return announcement.is_pinned && announcement.is_visible
  }, [])

  // Update visible announcements when the list changes
  useEffect(() => {
    const filtered = announcements.filter(shouldShowAnnouncement)
    setVisibleAnnouncements(filtered)
  }, [announcements, shouldShowAnnouncement])

  // Handle close announcement
  const handleClose = (id: number, _updatedAt: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation()
    // Save to localStorage with timestamp
    localStorage.setItem(
      `${CLOSED_KEY_PREFIX}${id}`,
      JSON.stringify({ timestamp: Date.now() })
    )
    setVisibleAnnouncements((prev) => prev.filter((a) => a.id !== id))
  }

  // Handle click to open detail
  const handleBannerClick = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
    setIsDetailOpen(true)
  }

  // If no visible announcements, maintain the layout spacing for the header
  if (visibleAnnouncements.length === 0) {
    return <div className="flex-1" />
  }

  return (
    <>
      <div className="flex-1 overflow-hidden relative mx-2 md:mx-4 flex items-center h-full">
        {/* LED style banner with marquee effect */}
        <div className="w-full overflow-hidden">
          {/* 复制内容以实现无缝滚动效果 */}
          <div className="flex animate-marquee whitespace-nowrap">
            {[...visibleAnnouncements, ...visibleAnnouncements].map((announcement, index) => (
              <div
                key={`${announcement.id}-${index}`}
                className="inline-flex items-center mx-6 cursor-pointer hover:opacity-80 transition-opacity group"
                onClick={() => handleBannerClick(announcement)}
              >
                <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-primary mr-2 animate-pulse" />
                <span className="text-foreground font-medium text-sm md:text-base">
                  {announcement.title}
                </span>
                <X
                  className="ml-2 w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                  onClick={(e) => handleClose(announcement.id, announcement.updated_at, e)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Announcement Detail Dialog */}
      <AnnouncementDetail
        announcement={selectedAnnouncement}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </>
  )
}