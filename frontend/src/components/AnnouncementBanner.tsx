import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { Announcement } from '@/api/client'
import { AnnouncementDetail } from './AnnouncementDetail'

interface AnnouncementBannerProps {
  announcements: Announcement[]
  onRefresh?: () => void
}

const CLOSED_KEY_PREFIX = 'announcement_closed_'
const CLOSED_DURATION = 24 * 60 * 60 * 1000 // 1 day in milliseconds

export function AnnouncementBanner({ announcements, onRefresh }: AnnouncementBannerProps) {
  // Filter to pinned and visible announcements that are not closed
  const [visibleAnnouncements, setVisibleAnnouncements] = useState<Announcement[]>([])
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // Check if announcement is closed (within 1 day)
  const isAnnouncementClosed = useCallback((id: number): boolean => {
    try {
      const closedData = localStorage.getItem(`${CLOSED_KEY_PREFIX}${id}`)
      if (!closedData) return false

      const { timestamp } = JSON.parse(closedData)
      const now = Date.now()
      // Check if 1 day has passed
      if (now - timestamp > CLOSED_DURATION) {
        // Expired, remove from localStorage
        localStorage.removeItem(`${CLOSED_KEY_PREFIX}${id}`)
        return false
      }
      return true
    } catch {
      return false
    }
  }, [])

  // Update visible announcements when the list changes
  useEffect(() => {
    const filtered = announcements.filter(
      (announcement) => announcement.is_pinned && announcement.is_visible && !isAnnouncementClosed(announcement.id)
    )
    setVisibleAnnouncements(filtered)
  }, [announcements, isAnnouncementClosed])

  // Handle close announcement
  const handleClose = (id: number, e: React.MouseEvent) => {
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

  // If no visible announcements, don't render
  if (visibleAnnouncements.length === 0) {
    return null
  }

  return (
    <>
      <div className="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-b border-amber-200 dark:border-amber-800 overflow-hidden">
        <div className="max-w-full overflow-hidden relative">
          {/* LED style banner with marquee effect */}
          <div className="flex items-center h-10 md:h-12 py-2">
            <div className="flex-1 overflow-hidden relative">
              <div className="flex animate-marquee whitespace-nowrap">
                {visibleAnnouncements.map((announcement) => (
                  <div
                    key={announcement.id}
                    className="inline-flex items-center mx-6 cursor-pointer hover:opacity-80 transition-opacity group"
                    onClick={() => handleBannerClick(announcement)}
                  >
                    <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse" />
                    <span className="text-amber-900 dark:text-amber-100 font-medium text-sm md:text-base">
                      {announcement.title}
                    </span>
                    <X
                      className="ml-2 w-4 h-4 text-amber-600 dark:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleClose(announcement.id, e)}
                    />
                  </div>
                ))}
              </div>
            </div>
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
