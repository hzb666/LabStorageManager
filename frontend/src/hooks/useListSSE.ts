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
import { useSSEStore } from '@/store/sseStore'
import type { ListResponseData } from '@/hooks/useTableState'

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

function toItemId(data: AnyRecord): number | null {
  const candidate = data.item_id ?? data.id
  return typeof candidate === 'number' ? candidate : null
}

function containsAnyField(data: AnyRecord, fields: string[]): boolean {
  if (fields.length === 0) return false
  return fields.some((field) => Object.prototype.hasOwnProperty.call(data, field))
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
      const isCreate = eventType.includes('.created')
      const isDelete = eventType.includes('.deleted')

      // Rule A: create/delete always stale.
      if (isCreate || isDelete) {
        markRoomStale(room)
        return
      }

      const itemId = toItemId(payload)
      const item = (payload.item as AnyRecord | undefined) ?? payload

      // Rule B: cannot identify item -> stale.
      if (!itemId) {
        markRoomStale(room)
        return
      }

      const context = getContext()

      // Rule C: update for unloaded record -> stale.
      if (!context.loadedIds.has(itemId)) {
        markRoomStale(room)
        return
      }

      // Rule D: search keyword active + touched searchable field -> stale.
      if (context.searchKeyword.trim() && containsAnyField(item, context.searchFields)) {
        markRoomStale(room)
        return
      }

      // Rule E: sort field changed -> stale.
      if (context.sortBy && Object.prototype.hasOwnProperty.call(item, context.sortBy)) {
        markRoomStale(room)
        return
      }

      // Safe path: patch loaded cache only.
      queryClient.setQueryData<InfiniteData<ListResponseData>>(queryKey, (oldData) => {
        if (!oldData) return oldData

        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            data: page.data.map((row) => {
              const record = row as AnyRecord
              if (record.id === itemId) {
                return { ...record, ...item }
              }
              return row
            }),
          })),
        }
      })

      if (onSafePatch) {
        onSafePatch(event)
      }
    }
  }, [getContext, markRoomStale, onSafePatch, queryClient, queryKey, room])

  const handlers = useMemo<Record<string, SSEEventHandler>>(() => {
    return eventTypes.reduce<Record<string, SSEEventHandler>>((acc, type) => {
      acc[type] = handler
      return acc
    }, {})
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
