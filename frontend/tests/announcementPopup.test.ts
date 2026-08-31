import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAnnouncementPopupVersion,
  selectNextPopupAnnouncement,
} from '../src/lib/announcementPopup.ts'

const announcement = {
  id: 7,
  title: '系统维护',
  content: '今晚进行系统维护',
  images: [],
  is_pinned: false,
  is_visible: true,
  is_popup: true,
  created_by: 1,
  created_by_name: '管理员',
  created_at: '2026-08-30T09:00:00Z',
  updated_at: '2026-08-30T10:00:00Z',
}

test('closed popup version stays suppressed', () => {
  const selected = selectNextPopupAnnouncement({
    announcements: [announcement],
    closedVersions: new Set([
      getAnnouncementPopupVersion(announcement),
    ]),
  })

  assert.equal(selected, null)
})

test('updated popup is eligible after its previous version was closed', () => {
  const previousVersion = {
    ...announcement,
    updated_at: '2026-08-30T09:00:00Z',
  }
  const selected = selectNextPopupAnnouncement({
    announcements: [announcement],
    closedVersions: new Set([
      getAnnouncementPopupVersion(previousVersion),
    ]),
  })

  assert.equal(selected?.id, announcement.id)
})

test('newest eligible popup is selected first', () => {
  const selected = selectNextPopupAnnouncement({
    announcements: [
      announcement,
      {
        ...announcement,
        id: 8,
        updated_at: '2026-08-30T11:00:00Z',
      },
    ],
    closedVersions: new Set<string>(),
  })

  assert.equal(selected?.id, 8)
})

test('only visible popup announcements participate in selection', () => {
  const selected = selectNextPopupAnnouncement({
    announcements: [
      { ...announcement, id: 8, is_popup: false },
      { ...announcement, id: 9, is_visible: false },
    ],
    closedVersions: new Set<string>(),
  })

  assert.equal(selected, null)
})
