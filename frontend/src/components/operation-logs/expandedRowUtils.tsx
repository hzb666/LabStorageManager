import type { ReactNode } from 'react'

import { formatDateTimeWithSeconds as formatSharedDateTimeWithSeconds } from '@/lib/utils'
import { safeString } from '@/lib/validationSchemas'

export type LogRecord = Record<string, unknown>
export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info'

export interface DetailField {
  label: string
  content: ReactNode
  visible: boolean
  wide?: boolean
  mono?: boolean
  tone?: Tone
}

export interface DetailSection {
  title: string
  fields: DetailField[]
}

interface FieldOptions {
  wide?: boolean
  mono?: boolean
  tone?: Tone
  visible?: boolean
}

export function isRecord(value: unknown): value is LogRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): LogRecord {
  return isRecord(value) ? value : {}
}

export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

export function firstValue(...values: unknown[]): unknown {
  return values.find(hasValue)
}

export function formatText(value: unknown, fallback = '-'): string {
  return safeString(value, fallback)
}

export function formatDateTime(value: unknown): string {
  if (!hasValue(value)) return '-'
  const text = formatText(value, '')
  if (!text) return '-'

  try {
    return formatSharedDateTimeWithSeconds(text)
  } catch {
    return text
  }
}

export function formatBoolean(value: unknown): string {
  if (value === true) return '是'
  if (value === false) return '否'
  return ''
}

export function formatPrice(value: unknown): string {
  return hasValue(value) ? `¥${formatText(value)}` : ''
}

export function formatQuantity(quantity: unknown, unit: unknown): string {
  if (!hasValue(quantity)) return ''
  const unitText = hasValue(unit) ? ` ${formatText(unit)}` : ''
  return `${formatText(quantity)}${unitText}`
}

export function mergeDisplayRecord(fullData: LogRecord): LogRecord {
  return {
    ...asRecord(fullData.snapshot),
    ...asRecord(fullData.before),
    ...asRecord(fullData.after),
    ...fullData,
  }
}

export function field(
  label: string,
  value: unknown,
  options: FieldOptions = {}
): DetailField {
  return {
    label,
    content: formatText(value),
    visible: options.visible ?? hasValue(value),
    wide: options.wide,
    mono: options.mono,
    tone: options.tone,
  }
}

export function dateField(
  label: string,
  value: unknown,
  options: FieldOptions = {}
): DetailField {
  return field(label, formatDateTime(value), {
    ...options,
    visible: options.visible ?? hasValue(value),
  })
}

export function customField(
  label: string,
  content: ReactNode,
  options: FieldOptions = {}
): DetailField {
  return {
    label,
    content,
    visible: options.visible ?? true,
    wide: options.wide,
    mono: options.mono,
    tone: options.tone,
  }
}

export function diffField(
  label: string,
  beforeValue: unknown,
  afterValue: unknown,
  options: FieldOptions = {}
): DetailField {
  const beforeText = formatText(beforeValue)
  const afterText = formatText(afterValue)
  return customField(label, renderDiffValue(beforeText, afterText), {
    ...options,
    visible: options.visible ?? (
      (hasValue(beforeValue) || hasValue(afterValue)) && beforeText !== afterText
    ),
  })
}

export function section(title: string, fields: DetailField[]): DetailSection {
  return { title, fields }
}

export function systemSection(fullData: LogRecord): DetailSection {
  return section('系统信息', [
    field('日志ID', fullData.id, { mono: true }),
    field('订单ID', fullData.order_id, { mono: true }),
    field('库存ID', fullData.inventory_id, { mono: true }),
    field('货架ID', fullData.common_shelf_id, { mono: true }),
    field('设备ID', fullData.device_id, { mono: true, wide: true }),
    field('会话ID', fullData.session_id, { mono: true }),
    field('操作人ID', fullData.actor_user_id, { mono: true }),
    field('申请人ID', fullData.applicant_id, { mono: true }),
    field('目标用户ID', fullData.target_user_id, { mono: true }),
    field('客户端 IP', fullData.client_ip),
    dateField('记录时间', fullData.created_at),
    field('来源', fullData.is_cli === true ? 'CLI' : 'Web', {
      visible: hasValue(fullData.is_cli),
    }),
    field('Request ID', fullData.request_id, { mono: true, wide: true }),
  ])
}

function renderDiffValue(before: string, after: string) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-red-600">{before}</span>
      <span className="text-muted-foreground">→</span>
      <span className="text-green-600">{after}</span>
    </span>
  )
}
