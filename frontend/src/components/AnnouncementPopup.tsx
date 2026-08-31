import { useMemo, useState } from 'react'

import type { Announcement } from '@/api/client'
import { AnnouncementDetail } from '@/components/AnnouncementDetail'
import {
  getAnnouncementPopupVersion,
  selectNextPopupAnnouncement,
} from '@/lib/announcementPopup'
import {
  dismissAnnouncementPopupForSession,
  getSessionDismissedAnnouncementPopupVersions,
} from '@/lib/storage/appUiStorage'

export type AnnouncementPopupCheck = {
  announcements: Announcement[]
  id: number
}

type AnnouncementPopupProps = {
  check: AnnouncementPopupCheck | null
  userId: number
}

export function AnnouncementPopup({ check, userId }: Readonly<AnnouncementPopupProps>) {
  const [closedVersions, setClosedVersions] = useState(
    () => getSessionDismissedAnnouncementPopupVersions(userId),
  )
  const [closedCheckId, setClosedCheckId] = useState<number | null>(null)
  const announcement = useMemo(
    () => check
      ? selectNextPopupAnnouncement({
          announcements: check.announcements,
          closedVersions,
        })
      : null,
    [check, closedVersions],
  )
  const open = Boolean(
    announcement && check && closedCheckId !== check.id,
  )

  const closeForSession = () => {
    if (announcement) {
      const version = getAnnouncementPopupVersion(announcement)
      dismissAnnouncementPopupForSession(userId, version)
      setClosedVersions((current) => new Set(current).add(version))
    }
    if (check) {
      setClosedCheckId(check.id)
    }
  }

  return (
    <AnnouncementDetail
      announcement={announcement}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeForSession()
        }
      }}
    />
  )
}
