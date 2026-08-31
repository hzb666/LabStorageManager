import type { Announcement } from '@/api/client'

type PopupSelectionParams = {
  announcements: Announcement[]
  closedVersions: ReadonlySet<string>
}

function parseAnnouncementTimestamp(value: string): number {
  const normalized = value.endsWith('Z') ? value : `${value}Z`
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function getAnnouncementPopupVersion(announcement: Announcement): string {
  return `${announcement.id}:${announcement.updated_at}`
}

export function selectNextPopupAnnouncement({
  announcements,
  closedVersions,
}: PopupSelectionParams): Announcement | null {
  const eligible = announcements.filter((announcement) => {
    if (!announcement.is_visible || !announcement.is_popup) {
      return false
    }
    if (closedVersions.has(getAnnouncementPopupVersion(announcement))) {
      return false
    }
    return true
  })

  return eligible.sort((left, right) => {
    const timestampDifference =
      parseAnnouncementTimestamp(right.updated_at) -
      parseAnnouncementTimestamp(left.updated_at)
    return timestampDifference || right.id - left.id
  })[0] ?? null
}
