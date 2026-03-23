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

// 处理备注字段：保留标签前缀，只移除内容为空的标签
// 支持所有在 inputConfigs 中定义的标签
export function processNotes(notes: string | undefined): string {
  if (!notes) return ''

  // 遍历所有标签，检查是否有匹配的前缀
  for (const tag of getAllTags()) {
    if (notes.startsWith(tag)) {
      const content = notes.slice(tag.length).trim()
      // 如果内容为空或只有空格，返回空字符串（删除标签）
      if (!content) {
        return ''
      }
      // 保留标签前缀和内容
      return notes
    }
  }
  return notes
}

/**
 * 库存借用状态标签
 * 用于试剂订单展开行和仪表盘中显示库存借用状态
 */
export function getInventoryBorrowLabel(
  status: string,
  borrowerName: string | null | undefined
): string {
  if (status === 'borrowed') {
    return borrowerName ? `借用中（${borrowerName}）` : '借用中'
  }
  return '未借用'
}

/**
 * 安全地将 unknown 值转换为字符串
 * 用于处理 API 返回的可能为 null/undefined/非字符串的值
 */
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
  const base = rawFilename.split(/[\\/]/).pop() ?? ''
  const withoutControlChars = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
  const stripped = withoutControlChars.trim().replace(/["<>|?*:]/g, '')
  if (!stripped) return fallback

  const normalized = stripped.replace(/^\.+/, '')
  if (!normalized) return fallback

  return normalized.slice(0, 255)
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
