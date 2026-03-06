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

// 处理备注字段：如果有标签前缀但内容为空或只有空格，则返回空字符串
// 支持所有在 inputConfigs 中定义的标签
export function processNotes(notes: string | undefined): string {
  if (!notes) return ''

  // 遍历所有标签，检查是否有匹配的前缀
  for (const tag of getAllTags()) {
    if (notes.startsWith(tag)) {
      const content = notes.slice(tag.length).trim()
      return content || ''
    }
  }
  return notes
}

export function getFullImageUrl(url: string): string {
  if (!url) return '' 
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  return `${API_BASE_URL}${url}`
}

