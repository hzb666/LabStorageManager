/**
 * List-focused SSE integration hook.
 *
 * Policy:
 * - Only do local patch for very safe updated events.
 * - Otherwise mark room stale and let user refresh snapshot.
 */
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'

import { useSSE, type SSEEventEnvelope, type SSEEventHandler } from '@/hooks/useSSE'
import type { ListResponseData } from '@/hooks/useTableState'
import { useSSEStore } from '@/store/sseStore'

export interface ListSSEContext {
  loadedIds: Set<number>
  visibleIds?: Set<number>
  searchKeyword: string
  searchFields: string[]
  sortBy?: string
}

export interface UseListSSEOptions {
  room: string
  queryKey: readonly unknown[]
  eventTypes: string[]
  getContext: () => ListSSEContext
  onSafePatch?: (event: SSEEventEnvelope) => void
}

type AnyRecord = Record<string, unknown>

// 从 SSE 载荷中提取统一的条目 id。
function toItemId(data: AnyRecord): number | null {
  const candidate = data.item_id ?? data.id
  return typeof candidate === 'number' ? candidate : null
}

// 判断事件载荷中是否包含当前搜索或排序会关注的字段。
function containsAnyField(data: AnyRecord, fields: string[]): boolean {
  if (fields.length === 0) return false
  return fields.some((field) => Object.prototype.hasOwnProperty.call(data, field))
}

// 标记新增或删除事件，这类事件统一走 stale 刷新策略。
function isCreateOrDeleteEvent(eventType: string): boolean {
  return eventType.includes('.created') || eventType.includes('.deleted')
}

// 判断当前事件是否已经超出安全局部 patch 的边界。
function shouldMarkContextStale(
  context: ListSSEContext,
  itemId: number,
  item: AnyRecord
): boolean {
  if (!context.loadedIds.has(itemId)) {
    return true
  }

  if (context.searchKeyword.trim() && containsAnyField(item, context.searchFields)) {
    return true
  }

  if (context.sortBy && Object.prototype.hasOwnProperty.call(item, context.sortBy)) {
    return true
  }

  return false
}

// 只 patch 已加载页里命中的那一行，避免在前端凭空改动未取回的分页快照。
function patchPageRows(
  rows: ListResponseData['data'],
  itemId: number,
  item: AnyRecord
): ListResponseData['data'] {
  return rows.map((row) => {
    const record = row as AnyRecord
    if (record.id === itemId) {
      return { ...record, ...item }
    }
    return row
  })
}

// 维持分页结构不变，只做安全的单行替换，避免把局部更新扩散成列表重排。
function patchListResponseData(
  oldData: InfiniteData<ListResponseData> | undefined,
  itemId: number,
  item: AnyRecord
): InfiniteData<ListResponseData> | undefined {
  if (!oldData) {
    return oldData
  }

  return {
    ...oldData,
    pages: oldData.pages.map((page) => ({
      ...page,
      data: patchPageRows(page.data, itemId, item),
    })),
  }
}

function createHandlers(
  eventTypes: string[],
  handler: SSEEventHandler
): Record<string, SSEEventHandler> {
  return Object.fromEntries(eventTypes.map((type) => [type, handler]))
}

export function useListSSE({
  room,
  queryKey,
  eventTypes,
  getContext,
  onSafePatch,
}: UseListSSEOptions) {
  const queryClient = useQueryClient()
  const markRoomStale = useSSEStore((state) => state.markRoomStale)
  const isStale = useSSEStore((state) => state.staleRooms.has(room))

  const handler = useMemo<SSEEventHandler>(() => {
    return (event) => {
      const payload = event.data as AnyRecord
      const eventType = String(event.event ?? '').toLowerCase()

      if (isCreateOrDeleteEvent(eventType)) {
        markRoomStale(room)
        return
      }

      const itemId = toItemId(payload)
      const item = (payload.item as AnyRecord | undefined) ?? payload

      if (!itemId) {
        markRoomStale(room)
        return
      }

      const context = getContext()
      if (shouldMarkContextStale(context, itemId, item)) {
        markRoomStale(room)
        return
      }

      queryClient.setQueryData<InfiniteData<ListResponseData>>(queryKey, (oldData) =>
        patchListResponseData(oldData, itemId, item)
      )

      onSafePatch?.(event)
    }
  }, [getContext, markRoomStale, onSafePatch, queryClient, queryKey, room])

  const handlers = useMemo<Record<string, SSEEventHandler>>(() => {
    return createHandlers(eventTypes, handler)
  }, [eventTypes, handler])

  const sse = useSSE({
    rooms: [room],
    handlers,
    autoConnect: true,
  })

  return {
    ...sse,
    isStale,
  }
}
