import { type ClassValue, clsx } from "clsx"
import type { AxiosResponse } from 'axios'
import { twMerge } from "tailwind-merge"
import { buildBackendUrl } from "./apiConfig"
import { inputConfigs } from "./inputConfigs"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const CHINA_TIME_ZONE = 'Asia/Shanghai'

const localFilenameDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const chinaFilenameDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: CHINA_TIME_ZONE,
})

function getDateTimeParts(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(date)
  const getPart = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find(part => part.type === type)?.value ?? ''
  )

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  }
}

function getUtcOffsetLabel(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0')
  const minutes = String(absoluteMinutes % 60).padStart(2, '0')

  return `UTC${sign}${hours}:${minutes}`
}

function normalizeUtcOffset(offsetText: string): string {
  const trimmed = offsetText.trim()
  if (!trimmed) {
    throw new Error('UTC offset is required')
  }

  const sign = trimmed[0]
  if (sign !== '+' && sign !== '-') {
    throw new Error('UTC offset must start with + or -')
  }

  const body = trimmed.slice(1)
  const [hoursRaw, minutesRaw = '00'] = body.includes(':')
    ? body.split(':', 2)
    : [body, '00']

  if (!/^\d{1,2}$/.test(hoursRaw) || !/^\d{1,2}$/.test(minutesRaw)) {
    throw new Error('UTC offset must use digits like +8 or +08:00')
  }

  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (hours > 14 || minutes >= 60 || (hours === 14 && minutes !== 0)) {
    throw new Error('UTC offset must be within UTC-14:00 to UTC+14:00')
  }

  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatUtcOffsetLabel(offsetText: string): string {
  return `UTC${normalizeUtcOffset(offsetText)}`
}

function getUtcOffsetMinutes(offsetText: string): number {
  const normalized = normalizeUtcOffset(offsetText)
  const sign = normalized.startsWith('+') ? 1 : -1
  const [hoursText, minutesText] = normalized.slice(1).split(':', 2)
  return sign * (Number(hoursText) * 60 + Number(minutesText))
}

function getUtcShiftedDate(date: string | Date, offsetText: string): Date {
  const sourceDate = new Date(date)
  return new Date(sourceDate.getTime() + getUtcOffsetMinutes(offsetText) * 60_000)
}

function getUtcDateParts(date: Date) {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
    hour: String(date.getUTCHours()).padStart(2, '0'),
    minute: String(date.getUTCMinutes()).padStart(2, '0'),
    second: String(date.getUTCSeconds()).padStart(2, '0'),
  }
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: CHINA_TIME_ZONE,
  })
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CHINA_TIME_ZONE,
  })
}

export function formatDateTimeWithSeconds(date: string | Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: CHINA_TIME_ZONE,
  })
}

export function formatLocalDateTimeWithSeconds(date: string | Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function getLocalTimeZoneLabel(date: string | Date = new Date()): string {
  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetLabel = getUtcOffsetLabel(new Date(date))

  return resolvedTimeZone ? `${resolvedTimeZone} (${offsetLabel})` : offsetLabel
}

export function formatLocalDateTimeForFilename(date = new Date()): string {
  const { year, month, day, hour, minute, second } = getDateTimeParts(
    date,
    localFilenameDateTimeFormatter,
  )
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`
}

export function formatUtcOffsetDateTimeWithSeconds(
  date: string | Date,
  offsetText: string,
): string {
  const shiftedDate = getUtcShiftedDate(date, offsetText)
  const { year, month, day, hour, minute, second } = getUtcDateParts(shiftedDate)
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`
}

export function formatUtcOffsetDateTimeForFilename(
  date: string | Date,
  offsetText: string,
): string {
  const shiftedDate = getUtcShiftedDate(date, offsetText)
  const { year, month, day, hour, minute, second } = getUtcDateParts(shiftedDate)
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`
}

export function formatChinaDateForFilename(date = new Date()): string {
  const { year, month, day } = getDateTimeParts(date, chinaFilenameDateTimeFormatter)
  return `${year}-${month}-${day}`
}

export function formatChinaDateTimeForFilename(date = new Date()): string {
  const { year, month, day, hour, minute, second } = getDateTimeParts(
    date,
    chinaFilenameDateTimeFormatter,
  )
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

// 获取所有标签前缀
export function getAllTags(): string[] {
  return Object.keys(inputConfigs)
}

// 备注保留标签前缀，只移除空标签。
export function processNotes(notes: string | undefined): string {
  if (!notes) return ''

  for (const tag of getAllTags()) {
    if (notes.startsWith(tag)) {
      const content = notes.slice(tag.length).trim()
      if (!content) {
        return ''
      }
      return notes
    }
  }
  return notes
}

/** 返回库存借用状态标签。 */
export function getInventoryBorrowLabel(
  status: string,
  borrowerName: string | null | undefined
): string {
  if (status === 'borrowed') {
    return borrowerName ? `借用中（${borrowerName}）` : '借用中'
  }
  return '未借用'
}

/** 安全地把 unknown 值转成字符串。 */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

export function getFullImageUrl(url: string): string {
  return buildBackendUrl(url)
}

function parseFilenameFromContentDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) {
    return null
  }

  const utf8Regex = /filename\*=UTF-8''([^;]+)/i
  const utf8Match = utf8Regex.exec(contentDisposition)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const asciiRegex = /filename="?([^";]+)"?/i
  const asciiMatch = asciiRegex.exec(contentDisposition)
  if (asciiMatch?.[1]) {
    return asciiMatch[1]
  }

  return null
}

function sanitizeFilename(rawFilename: string, fallback: string): string {
  const sanitizeSingle = (name: string): string | null => {
    const base = name.split(/[\\/]/).pop() ?? ''
    const withoutControlChars = Array.from(base)
      .filter((char) => {
        const code = char.codePointAt(0) ?? 0
        return code >= 0x20 && code !== 0x7f
      })
      .join('')
    const stripped = withoutControlChars.trim().replaceAll(/["<>|?*:]/g, '')
    if (!stripped) return null

    const normalized = stripped.replace(/^\.+/, '')
    if (!normalized) return null

    return normalized.slice(0, 255)
  }

  const primary = sanitizeSingle(rawFilename)
  if (primary) return primary

  const fallbackSanitized = sanitizeSingle(fallback)
  if (fallbackSanitized) return fallbackSanitized

  return 'download'
}

export function downloadBlobResponse(
  response: AxiosResponse<Blob>,
  fallbackFilename: string,
): void {
  const contentDisposition = response.headers?.['content-disposition'] as string | undefined
  const parsedFilename = parseFilenameFromContentDisposition(contentDisposition)
  const filename = sanitizeFilename(parsedFilename ?? fallbackFilename, fallbackFilename)

  const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'

  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

