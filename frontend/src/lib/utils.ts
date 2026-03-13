import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
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
  if (!url) return '' 
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  return `${API_BASE_URL}${url}`
}

