import type { LogItem } from '@/api/client'

import { cn } from '@/lib/utils'
import { buildSections } from './operation-logs/expandedRowSections'
import {
  asRecord,
  type DetailSection,
  formatText,
  hasValue,
  type LogRecord,
  type Tone,
} from './operation-logs/expandedRowUtils'
import { getLogTypeLabel } from './operation-logs/logTypeMeta'

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-foreground',
  success: 'text-green-600',
  warning: 'text-orange-600',
  danger: 'text-red-600',
  info: 'text-blue-600',
}

function getDetailText(item: LogItem, fullData: LogRecord): string {
  const detail = item.detail || ''
  if (fullData.is_cli !== true) return detail
  return detail.startsWith('[cli] ') ? detail : `[cli] ${detail}`
}

function renderSections(sections: DetailSection[]) {
  const visibleSections = sections
    .map(item => ({ ...item, fields: item.fields.filter(fieldItem => fieldItem.visible) }))
    .filter(item => item.fields.length > 0)

  if (visibleSections.length === 0) {
    return <div className="text-base text-muted-foreground">暂无可展示的详细字段</div>
  }

  return (
    <div className="flex-1 space-y-5">
      {visibleSections.map(item => (
        <section key={item.title} className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {item.fields.map(detail => (
              <div
                key={`${item.title}-${detail.label}`}
                className={cn(
                  'flex min-w-0 items-baseline gap-1.5 text-base leading-7',
                  detail.wide && 'sm:col-span-2 xl:col-span-4'
                )}
              >
                <span className="shrink-0 font-medium text-muted-foreground">
                  {detail.label}：
                </span>
                <span
                  className={cn(
                    'min-w-0 break-words',
                    TONE_CLASS[detail.tone ?? 'default']
                  )}
                >
                  {detail.content}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function OperationLogExpandedRow({ item }: Readonly<{ item: LogItem }>) {
  const fullData = asRecord(item.full_data ?? item)
  const detail = getDetailText(item, fullData)

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-base font-medium text-foreground">{detail || '操作详情'}</div>
        {hasValue(item.type) && (
          <div className="text-sm text-muted-foreground">
            类型：{getLogTypeLabel(formatText(item.type))}
          </div>
        )}
      </div>
      {renderSections(buildSections(item.type || 'unknown', fullData))}
    </div>
  )
}
