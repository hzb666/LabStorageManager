import { type ClassValue, clsx } from "clsx"
import type { AxiosResponse } from 'axios'
import { twMerge } from "tailwind-merge"
import { buildBackendUrl } from "./apiConfig"
import { inputConfigs } from "./inputConfigs"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  })
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  })
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

