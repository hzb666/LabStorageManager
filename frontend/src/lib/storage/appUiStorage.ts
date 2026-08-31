import {
  isRecord,
  parseJson,
  readLocalStorageItem,
  writeLocalStorageItem,
} from './localStorageCore'

export type AppTheme = 'light' | 'dark'

const APP_UI_STORAGE_KEY = 'app-ui'
const ANNOUNCEMENT_POPUP_DISMISSED_KEY_PREFIX = 'announcement-popup-dismissed:'
const CART_IMPORT_ANNOUNCEMENT_POPUP_SUPPRESSED_KEY =
  'cart-import-announcement-popup-suppressed'

type TimestampMap = Record<string, number>

export type AppUIStorage = {
  version: number
  theme?: AppTheme
  font: {
    preferredSource?: string
  }
  dashboard: {
    activeTab?: string
    mode?: string
  }
  announcement: {
    read: TimestampMap
    closed: TimestampMap
  }
  bugReport: {
    hiddenUntil: number
  }
}

const DEFAULT_APP_UI_STORAGE: AppUIStorage = {
  version: 1,
  font: {},
  dashboard: {},
  announcement: {
    read: {},
    closed: {},
  },
  bugReport: {
    hiddenUntil: 0,
  },
}

function normalizeTheme(value: unknown): AppTheme | undefined {
  if (value === 'light' || value === 'dark') {
    return value
  }
  return undefined
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

function normalizeTimestampMap(value: unknown): TimestampMap {
  if (!isRecord(value)) {
    return {}
  }

  const next: TimestampMap = {}
  for (const [key, raw] of Object.entries(value)) {
    const timestamp = normalizeTimestamp(raw)
    if (timestamp !== undefined) {
      next[key] = timestamp
    }
  }
  return next
}

function normalizeAppUIStorage(raw: unknown): AppUIStorage {
  if (!isRecord(raw)) {
    return { ...DEFAULT_APP_UI_STORAGE }
  }

  const font = isRecord(raw.font) ? raw.font : {}
  const dashboard = isRecord(raw.dashboard) ? raw.dashboard : {}
  const announcement = isRecord(raw.announcement) ? raw.announcement : {}
  const bugReport = isRecord(raw.bugReport) ? raw.bugReport : {}

  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    theme: normalizeTheme(raw.theme),
    font: {
      preferredSource:
        typeof font.preferredSource === 'string' && font.preferredSource.trim()
          ? font.preferredSource
          : undefined,
    },
    dashboard: {
      activeTab:
        typeof dashboard.activeTab === 'string' && dashboard.activeTab.trim()
          ? dashboard.activeTab
          : undefined,
      mode:
        typeof dashboard.mode === 'string' && dashboard.mode.trim()
          ? dashboard.mode
          : undefined,
    },
    announcement: {
      read: normalizeTimestampMap(announcement.read),
      closed: normalizeTimestampMap(announcement.closed),
    },
    bugReport: {
      hiddenUntil: normalizeTimestamp(bugReport.hiddenUntil) ?? 0,
    },
  }
}

function readAppUIStorageRaw(): AppUIStorage {
  const parsed = parseJson<unknown>(readLocalStorageItem(APP_UI_STORAGE_KEY), DEFAULT_APP_UI_STORAGE)
  return normalizeAppUIStorage(parsed)
}

export function getAppUI(): AppUIStorage {
  return readAppUIStorageRaw()
}

export function setAppUI(next: AppUIStorage): boolean {
  return writeLocalStorageItem(APP_UI_STORAGE_KEY, JSON.stringify(normalizeAppUIStorage(next)))
}

export function updateAppUI(updater: (current: AppUIStorage) => AppUIStorage): boolean {
  const current = getAppUI()
  const next = normalizeAppUIStorage(updater(current))
  return setAppUI(next)
}

export function getTheme(): AppTheme {
  return getAppUI().theme ?? 'light'
}

export function getThemePreference(): AppTheme | null {
  return getAppUI().theme ?? null
}

export function setTheme(theme: AppTheme): void {
  updateAppUI((current) => ({
    ...current,
    theme,
  }))
}

export function getPreferredFontSource(): string | null {
  const source = getAppUI().font.preferredSource
  return source ?? null
}

export function setPreferredFontSource(preferredSource: string): void {
  updateAppUI((current) => ({
    ...current,
    font: {
      ...current.font,
      preferredSource,
    },
  }))
}

export function clearPreferredFontSource(): void {
  updateAppUI((current) => ({
    ...current,
    font: {},
  }))
}

export function getDashboardActiveTab(): string | null {
  return getAppUI().dashboard.activeTab ?? null
}

export function setDashboardActiveTab(activeTab: string): void {
  updateAppUI((current) => ({
    ...current,
    dashboard: {
      ...current.dashboard,
      activeTab,
    },
  }))
}

export function clearDashboardActiveTab(): void {
  updateAppUI((current) => ({
    ...current,
    dashboard: {
      ...current.dashboard,
      activeTab: undefined,
    },
  }))
}

export function getDashboardModePreference(): string | null {
  return getAppUI().dashboard.mode ?? null
}

export function setDashboardModePreference(mode: string): void {
  updateAppUI((current) => ({
    ...current,
    dashboard: {
      ...current.dashboard,
      mode,
    },
  }))
}

export function getAnnouncementReadState(): TimestampMap {
  return getAppUI().announcement.read
}

export function markAnnouncementRead(id: string | number, timestamp: number = Date.now()): void {
  updateAppUI((current) => ({
    ...current,
    announcement: {
      ...current.announcement,
      read: {
        ...current.announcement.read,
        [String(id)]: timestamp,
      },
    },
  }))
}

export function setAnnouncementReadState(readState: TimestampMap): void {
  updateAppUI((current) => ({
    ...current,
    announcement: {
      ...current.announcement,
      read: normalizeTimestampMap(readState),
    },
  }))
}

export function getAnnouncementClosedState(): TimestampMap {
  return getAppUI().announcement.closed
}

export function setAnnouncementClosedState(closedState: TimestampMap): void {
  updateAppUI((current) => ({
    ...current,
    announcement: {
      ...current.announcement,
      closed: normalizeTimestampMap(closedState),
    },
  }))
}

export function dismissAnnouncement(id: string | number, timestamp: number = Date.now()): void {
  updateAppUI((current) => ({
    ...current,
    announcement: {
      ...current.announcement,
      closed: {
        ...current.announcement.closed,
        [String(id)]: timestamp,
      },
    },
  }))
}

export function getSessionDismissedAnnouncementPopupVersions(userId: number): Set<string> {
  let storedVersions: string | null = null
  try {
    storedVersions = globalThis.sessionStorage?.getItem(
      `${ANNOUNCEMENT_POPUP_DISMISSED_KEY_PREFIX}${userId}`,
    ) ?? null
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }

  const raw = parseJson<unknown>(storedVersions, [])
  return new Set(
    Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string')
      : [],
  )
}

export function dismissAnnouncementPopupForSession(userId: number, version: string): void {
  const versions = getSessionDismissedAnnouncementPopupVersions(userId)
  const separatorIndex = version.indexOf(':')
  if (separatorIndex > 0) {
    const announcementPrefix = `${version.slice(0, separatorIndex)}:`
    for (const existingVersion of versions) {
      if (existingVersion.startsWith(announcementPrefix)) {
        versions.delete(existingVersion)
      }
    }
  }
  versions.add(version)
  try {
    globalThis.sessionStorage?.setItem(
      `${ANNOUNCEMENT_POPUP_DISMISSED_KEY_PREFIX}${userId}`,
      JSON.stringify([...versions]),
    )
  } catch {
    // Closing the popup must still work when storage is unavailable.
  }
}

export function suppressAnnouncementPopupForCartImportSession(): void {
  try {
    globalThis.sessionStorage?.setItem(CART_IMPORT_ANNOUNCEMENT_POPUP_SUPPRESSED_KEY, '1')
  } catch {
    // The cart import page remains usable when storage is unavailable.
  }
}

export function isAnnouncementPopupSuppressedForCartImportSession(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(
      CART_IMPORT_ANNOUNCEMENT_POPUP_SUPPRESSED_KEY,
    ) === '1'
  } catch {
    return false
  }
}

export function getBugButtonHiddenUntil(): number {
  return getAppUI().bugReport.hiddenUntil
}

export function setBugButtonHiddenUntil(hiddenUntil: number): void {
  const normalized = normalizeTimestamp(hiddenUntil) ?? 0
  updateAppUI((current) => ({
    ...current,
    bugReport: {
      hiddenUntil: normalized,
    },
  }))
}

export function clearBugButtonHiddenUntil(): void {
  updateAppUI((current) => ({
    ...current,
    bugReport: {
      hiddenUntil: 0,
    },
  }))
}
