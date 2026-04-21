/** 列表页 SSE 集成 Hook。 */
import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'

import { useSSE, type SSEEventEnvelope, type SSEEventHandler } from '@/hooks/useSSE'
import type { ListResponseData } from '@/hooks/useTableState'
import {
  DEFAULT_SEARCH_MATCH_MODE,
  matchesSearchText,
  type SearchMatchMode,
} from '@/lib/searchMatchMode'
import { useSSEStore } from '@/store/sseStore'

export interface ListSSEContext {
  loadedIds: Set<number>
  visibleIds?: Set<number>
  searchKeyword: string
  searchFields: string[]
  fuzzySearch: boolean
  matchMode: SearchMatchMode
  sortBy?: string
  statusFilter?: string
  isAtListStart?: boolean
}

export interface UseListSSEOptions {
  enabled?: boolean
  room: string
  staleKey: string
  queryKey: readonly unknown[]
  eventTypes: readonly string[]
  getContext: () => ListSSEContext
  onSafePatch?: (event: SSEEventEnvelope) => void
  staleOnly?: boolean
  shouldHandleEvent?: (event: SSEEventEnvelope, context: ListSSEContext) => boolean
}

type AnyRecord = Record<string, unknown>

type ListMutationResult = {
  matchedRow: boolean
  changed: boolean
  filterMismatch: boolean
  nextData: InfiniteData<ListResponseData> | undefined
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim().toLowerCase()
  }
  return ''
}

function getRecordId(record: AnyRecord | null | undefined): number | null {
  if (!record) {
    return null
  }

  const candidates = [record.id, record.inventory_id, record.order_id]
  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return candidate
    }
  }
  return null
}

function toItemId(data: AnyRecord): number | null {
  const candidate = data.item_id ?? data.id
  return typeof candidate === 'number' ? candidate : null
}

function containsAnyField(data: AnyRecord, fields: string[]): boolean {
  if (fields.length === 0) {
    return false
  }
  return fields.some((field) => Object.prototype.hasOwnProperty.call(data, field))
}

function matchesStatusFilter(item: AnyRecord, context: ListSSEContext): boolean {
  const statusFilter = normalizeText(context.statusFilter)
  if (!statusFilter || statusFilter === 'all') {
    return true
  }
  return normalizeText(item.status) === statusFilter
}

function matchesSearchFilter(item: AnyRecord, context: ListSSEContext): boolean {
  const keyword = normalizeText(context.searchKeyword)
  if (!keyword) {
    return true
  }

  const fields =
    context.searchFields.length > 0
      ? context.searchFields
      : Object.keys(item)

  return fields.some((field) =>
    matchesSearchText(
      item[field],
      keyword,
      context.matchMode ?? DEFAULT_SEARCH_MATCH_MODE,
      context.fuzzySearch,
    )
  )
}

function matchesCurrentFilters(item: AnyRecord, context: ListSSEContext): boolean {
  return matchesStatusFilter(item, context) && matchesSearchFilter(item, context)
}

function touchesCurrentSort(item: AnyRecord, context: ListSSEContext): boolean {
  return Boolean(context.sortBy && Object.prototype.hasOwnProperty.call(item, context.sortBy))
}

function canPrependCreatedItem(item: AnyRecord, context: ListSSEContext): boolean {
  return Boolean(
    context.isAtListStart &&
      !normalizeText(context.searchKeyword) &&
      !context.sortBy &&
      matchesStatusFilter(item, context),
  )
}

function withUpdatedTotal(
  oldData: InfiniteData<ListResponseData>,
  total: number,
  pages: ListResponseData[],
): InfiniteData<ListResponseData> {
  return {
    ...oldData,
    pages: pages.map((page) => ({
      ...page,
      total,
    })),
  }
}

function patchExistingRow(
  oldData: InfiniteData<ListResponseData> | undefined,
  itemId: number,
  item: AnyRecord,
  context: ListSSEContext,
): ListMutationResult {
  if (!oldData) {
    return { matchedRow: false, changed: false, filterMismatch: false, nextData: oldData }
  }

  let matchedRow = false
  let changed = false
  let filterMismatch = false
  const nextPages = oldData.pages.map((page) => ({
    ...page,
    data: page.data.map((row) => {
      const record = row as AnyRecord
      if (getRecordId(record) !== itemId) {
        return row
      }

      matchedRow = true
      const merged = { ...record, ...item }
      if (!matchesCurrentFilters(merged, context)) {
        filterMismatch = true
        return row
      }

      changed = true
      return merged
    }),
  }))

  if (!matchedRow || !changed) {
    return { matchedRow, changed: false, filterMismatch, nextData: oldData }
  }

  return {
    matchedRow: true,
    changed: true,
    filterMismatch,
    nextData: withUpdatedTotal(oldData, oldData.pages[0]?.total ?? 0, nextPages),
  }
}

function prependCreatedRow(
  oldData: InfiniteData<ListResponseData> | undefined,
  item: AnyRecord,
): ListMutationResult {
  if (!oldData || oldData.pages.length === 0) {
    return { matchedRow: false, changed: false, filterMismatch: false, nextData: oldData }
  }

  const firstPage = oldData.pages[0]
  const nextPages = [
    {
      ...firstPage,
      data: [item, ...firstPage.data],
    },
    ...oldData.pages.slice(1),
  ]
  const previousTotal = oldData.pages[0]?.total ?? 0

  return {
    matchedRow: false,
    changed: true,
    filterMismatch: false,
    nextData: withUpdatedTotal(oldData, previousTotal + 1, nextPages),
  }
}

function applySafeMutation(args: {
  event: SSEEventEnvelope
  nextData: InfiniteData<ListResponseData> | undefined
  queryClient: ReturnType<typeof useQueryClient>
  queryKeyRef: MutableRefObject<readonly unknown[]>
  onSafePatchRef: MutableRefObject<((event: SSEEventEnvelope) => void) | undefined>
}): void {
  const { event, nextData, queryClient, queryKeyRef, onSafePatchRef } = args
  queryClient.setQueryData(queryKeyRef.current, nextData)
  onSafePatchRef.current?.(event)
}

function touchesSearchFields(item: AnyRecord, context: ListSSEContext): boolean {
  const hasActiveSearch = Boolean(normalizeText(context.searchKeyword))
  if (!hasActiveSearch) {
    return false
  }
  return containsAnyField(item, context.searchFields)
}

type ListEventRuntime = {
  markStale: () => void
  onSafePatchRef: MutableRefObject<((event: SSEEventEnvelope) => void) | undefined>
  queryClient: ReturnType<typeof useQueryClient>
  queryKeyRef: MutableRefObject<readonly unknown[]>
}

function handleCreatedListEvent(args: {
  context: ListSSEContext
  event: SSEEventEnvelope
  item: AnyRecord | null
  itemId: number | null
  runtime: ListEventRuntime
}): void {
  const { context, event, item, itemId, runtime } = args
  const { markStale, onSafePatchRef, queryClient, queryKeyRef } = runtime

  if (!itemId || !item) {
    markStale()
    return
  }
  if (!matchesCurrentFilters(item, context)) {
    return
  }
  if (!canPrependCreatedItem(item, context)) {
    markStale()
    return
  }

  const result = prependCreatedRow(
    queryClient.getQueryData<InfiniteData<ListResponseData>>(queryKeyRef.current),
    item,
  )
  if (!result.changed) {
    markStale()
    return
  }

  applySafeMutation({ event, nextData: result.nextData, queryClient, queryKeyRef, onSafePatchRef })
}

function handleDeletedListEvent(args: {
  event: SSEEventEnvelope
  itemId: number | null
  runtime: ListEventRuntime
}): void {
  const { runtime } = args
  runtime.markStale()
}

function handleUpdatedListEvent(args: {
  context: ListSSEContext
  event: SSEEventEnvelope
  item: AnyRecord | null
  itemId: number | null
  runtime: ListEventRuntime
}): void {
  const { context, event, item, itemId, runtime } = args
  const { markStale, onSafePatchRef, queryClient, queryKeyRef } = runtime

  if (!itemId || !item) {
    markStale()
    return
  }
  if (!context.loadedIds.has(itemId)) {
    markStale()
    return
  }
  if (touchesSearchFields(item, context)) {
    markStale()
    return
  }
  if (touchesCurrentSort(item, context)) {
    markStale()
    return
  }

  const currentData = queryClient.getQueryData<InfiniteData<ListResponseData>>(queryKeyRef.current)
  const result = patchExistingRow(currentData, itemId, item, context)
  if (result.filterMismatch) {
    markStale()
    return
  }
  if (result.changed) {
    applySafeMutation({ event, nextData: result.nextData, queryClient, queryKeyRef, onSafePatchRef })
    return
  }
  if (!result.matchedRow) {
    markStale()
  }
}

function useListSSERefs(args: {
  getContext: () => ListSSEContext
  onSafePatch?: (event: SSEEventEnvelope) => void
  queryKey: readonly unknown[]
  shouldHandleEvent?: (event: SSEEventEnvelope, context: ListSSEContext) => boolean
}) {
  const { getContext, onSafePatch, queryKey, shouldHandleEvent } = args
  const queryKeyRef = useRef(queryKey)
  const getContextRef = useRef(getContext)
  const onSafePatchRef = useRef(onSafePatch)
  const shouldHandleEventRef = useRef(shouldHandleEvent)

  useEffect(() => {
    queryKeyRef.current = queryKey
    getContextRef.current = getContext
    onSafePatchRef.current = onSafePatch
    shouldHandleEventRef.current = shouldHandleEvent
  }, [getContext, onSafePatch, queryKey, shouldHandleEvent])

  return {
    queryKeyRef,
    getContextRef,
    onSafePatchRef,
    shouldHandleEventRef,
  }
}

function useStableEventTypes(eventTypes: readonly string[]): string[] {
  const eventTypesKey = useMemo(() => {
    const normalized = Array.from(
      new Set(
        eventTypes
          .map((eventType) => eventType.trim())
          .filter(Boolean),
      ),
    ).sort()
    return normalized.join(',')
  }, [eventTypes])

  return useMemo(
    () => (eventTypesKey ? eventTypesKey.split(',') : []),
    [eventTypesKey],
  )
}

export function useListSSE({
  enabled = true,
  room,
  staleKey,
  queryKey,
  eventTypes,
  getContext,
  onSafePatch,
  staleOnly = false,
  shouldHandleEvent,
}: UseListSSEOptions) {
  const queryClient = useQueryClient()
  const markStaleKey = useSSEStore((state) => state.markStaleKey)
  const clientId = useSSEStore((state) => state.clientId)
  const isStale = useSSEStore((state) => state.hasStaleKey(staleKey))
  const staleKeyRef = useRef(staleKey)
  const clientIdRef = useRef(clientId)

  const { queryKeyRef, getContextRef, onSafePatchRef, shouldHandleEventRef } = useListSSERefs({
    getContext,
    onSafePatch,
    queryKey,
    shouldHandleEvent,
  })
  useEffect(() => {
    staleKeyRef.current = staleKey
  }, [staleKey])
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  const handleEventRef = useRef<SSEEventHandler>(() => {})
  useEffect(() => {
    const runtime = {
      markStale: () => {
        markStaleKey(staleKeyRef.current)
      },
      onSafePatchRef,
      queryClient,
      queryKeyRef,
    }
    handleEventRef.current = (event) => {
      if (event.actor_client_id && event.actor_client_id === clientIdRef.current) {
        return
      }

      const payload = event.data as AnyRecord
      const itemId = toItemId(payload)
      const item = payload.item && typeof payload.item === 'object'
        ? (payload.item as AnyRecord)
        : null
      const eventType = String(event.event ?? '').toLowerCase()
      const context = getContextRef.current()

      if (shouldHandleEventRef.current && !shouldHandleEventRef.current(event, context)) {
        return
      }
      if (staleOnly) {
        runtime.markStale()
        return
      }
      if (eventType.includes('.created')) {
        handleCreatedListEvent({ context, event, item, itemId, runtime })
        return
      }
      if (eventType.includes('.deleted')) {
        handleDeletedListEvent({ event, itemId, runtime })
        return
      }
      handleUpdatedListEvent({ context, event, item, itemId, runtime })
    }
  }, [
    getContextRef,
    markStaleKey,
    onSafePatchRef,
    queryClient,
    queryKeyRef,
    staleOnly,
    shouldHandleEventRef,
  ])

  const stableEventTypes = useStableEventTypes(eventTypes)

  const handlers = useMemo<Record<string, SSEEventHandler>>(() => {
    return Object.fromEntries(
      stableEventTypes.map((eventType) => [eventType, () => {}]),
    )
  }, [stableEventTypes])

  useEffect(() => {
    stableEventTypes.forEach((eventType) => {
      handlers[eventType] = (event) => {
        handleEventRef.current(event)
      }
    })
  }, [handlers, stableEventTypes])

  const sse = useSSE({
    rooms: [room],
    handlers,
    autoConnect: enabled,
    onReconnect: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyRef.current })
    },
    onStreamStale: () => {
      markStaleKey(staleKeyRef.current)
    },
  })

  return {
    ...sse,
    isStale,
  }
}
