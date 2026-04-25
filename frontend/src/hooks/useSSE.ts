/** 房间级事件流 SSE Hook。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { getApiBaseUrl } from '@/lib/apiConfig'
import {
  resolveAuthNoticeByCode,
  resolveAuthNoticeByReason,
  shouldSuppressAuthNoticeByReason,
  triggerSessionInvalidation,
} from '@/lib/authSession'
import { registerSSEDisconnect, unregisterSSEDisconnect } from '@/lib/sseRuntime'
import { useSSEStore } from '@/store/sseStore'

const SSE_RECONNECT_DELAY_MS = 1000

export interface SSEEventEnvelope {
  room: string
  seq: number
  event: string
  data: Record<string, unknown>
  timestamp?: string
  origin?: string
  actor_client_id?: string
}

export type SSEEventHandler = (event: SSEEventEnvelope) => void

export interface SSEOptions {
  rooms: string[]
  handlers: Record<string, SSEEventHandler>
  autoConnect?: boolean
  withCredentials?: boolean
  onReconnect?: () => void
  onStreamStale?: () => void
}

type SeqProcessResult = {
  hasGap: boolean
  isDuplicateOrOld: boolean
}

let sseConnectionCounter = 0

function createSSEConnectionKey(): string {
  sseConnectionCounter += 1
  return `sse-${sseConnectionCounter}`
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref
}

function useStableSSEConfig(args: {
  handlers: Record<string, SSEEventHandler>
  rooms: string[]
}) {
  const { handlers, rooms } = args
  const roomsKey = useMemo(() => {
    const normalized = Array.from(
      new Set(
        rooms
          .map((room) => room.trim())
          .filter(Boolean),
      ),
    ).sort()
    return normalized.join(',')
  }, [rooms])

  const stableRooms = useMemo(() => (roomsKey ? roomsKey.split(',') : []), [roomsKey])
  const eventTypesKey = useMemo(() => {
    const normalized = Array.from(
      new Set(
        Object.keys(handlers)
          .map((eventType) => eventType.trim())
          .filter(Boolean),
      ),
    ).sort()
    return normalized.join(',')
  }, [handlers])
  const stableEventTypes = useMemo(
    () => (eventTypesKey ? eventTypesKey.split(',') : []),
    [eventTypesKey],
  )

  return {
    roomsKey,
    stableEventTypes,
    stableRooms,
  }
}

function useResetRoomTracking(args: {
  lastOriginByRoomRef: MutableRefObject<Record<string, string>>
  lastSeqByRoomRef: MutableRefObject<Record<string, number>>
  roomsKey: string
}) {
  const { lastOriginByRoomRef, lastSeqByRoomRef, roomsKey } = args

  useEffect(() => {
    lastOriginByRoomRef.current = {}
    lastSeqByRoomRef.current = {}
  }, [lastOriginByRoomRef, lastSeqByRoomRef, roomsKey])
}

function buildEventsUrl(args: {
  lastSeqByRoom: Record<string, number>
  roomsKey: string
}): string {
  const { lastSeqByRoom, roomsKey } = args
  const base = getApiBaseUrl().replace(/\/$/, '')
  const qs = new URLSearchParams({ rooms: roomsKey })

  if (Object.keys(lastSeqByRoom).length > 0) {
    qs.set('last_seq_by_room', JSON.stringify(lastSeqByRoom))
  }

  return `${base}/events?${qs.toString()}`
}

function buildLastSeqSnapshot(args: {
  lastSeqByRoomRef: MutableRefObject<Record<string, number>>
  stableRooms: string[]
}): Record<string, number> {
  const { lastSeqByRoomRef, stableRooms } = args

  return stableRooms.reduce<Record<string, number>>((snapshot, room) => {
    const seq = lastSeqByRoomRef.current[room] ?? 0
    if (seq > 0) {
      snapshot[room] = seq
    }
    return snapshot
  }, {})
}

function processSeqByConnection(args: {
  lastOriginByRoomRef: MutableRefObject<Record<string, string>>
  lastSeqByRoomRef: MutableRefObject<Record<string, number>>
  origin?: string
  room: string
  seq: number
}): SeqProcessResult {
  const { lastOriginByRoomRef, lastSeqByRoomRef, origin, room, seq } = args
  const previousOrigin = lastOriginByRoomRef.current[room]
  const previousSeq = lastSeqByRoomRef.current[room] ?? 0
  const nextOrigin = typeof origin === 'string' && origin ? origin : undefined
  const originChanged = Boolean(nextOrigin && previousOrigin && nextOrigin !== previousOrigin)

  if (nextOrigin) {
    lastOriginByRoomRef.current = {
      ...lastOriginByRoomRef.current,
      [room]: nextOrigin,
    }
  }

  if (originChanged && seq <= previousSeq) {
    return {
      hasGap: true,
      isDuplicateOrOld: false,
    }
  }

  if (seq <= previousSeq) {
    return {
      hasGap: false,
      isDuplicateOrOld: true,
    }
  }

  // 只有确认是可接受的新事件后，才推进该房间的序号水位。
  lastSeqByRoomRef.current = {
    ...lastSeqByRoomRef.current,
    [room]: seq,
  }

  return {
    hasGap: previousSeq > 0 && seq > previousSeq + 1,
    isDuplicateOrOld: false,
  }
}

function markCurrentStreamStale(args: {
  markRoomStale: (room: string) => void
  onStreamStale?: () => void
  room?: string
  stableRooms: string[]
}) {
  const { markRoomStale, onStreamStale, room, stableRooms } = args
  if (onStreamStale) {
    onStreamStale()
    return
  }
  if (room) {
    markRoomStale(room)
    return
  }
  stableRooms.forEach((stableRoom) => markRoomStale(stableRoom))
}

function attachConnectedListener(args: {
  connectionKey: string
  es: EventSource
  markRoomStale: (room: string) => void
  onConnected: () => void
  onReconnect?: () => void
  onStreamStale?: () => void
  openedOnceRef: MutableRefObject<boolean>
  registerConnection: (connectionKey: string, clientId: string) => void
  setReconnectCount: Dispatch<SetStateAction<number>>
  stableRooms: string[]
}) {
  const {
    connectionKey,
    es,
    markRoomStale,
    onConnected,
    onReconnect,
    onStreamStale,
    openedOnceRef,
    registerConnection,
    setReconnectCount,
    stableRooms,
  } = args

  es.addEventListener('connected', (evt) => {
    try {
      const payload = JSON.parse(String(evt.data)) as { client_id?: string }
      registerConnection(connectionKey, payload.client_id ?? 'unknown')
      onConnected()

      if (openedOnceRef.current) {
        setReconnectCount((previousCount) => previousCount + 1)
        if (onReconnect) {
          onReconnect()
        } else {
          markCurrentStreamStale({ markRoomStale, onStreamStale, stableRooms })
        }
      }
      openedOnceRef.current = true
    } catch {
      registerConnection(connectionKey, 'unknown')
      onConnected()
    }
  })
}

function attachAuthInvalidListener(args: {
  disconnect: () => void
  es: EventSource
}) {
  const { disconnect, es } = args

  es.addEventListener('auth.invalid', (evt) => {
    let reason = 'session_revoke'
    let code = ''
    try {
      const payload = JSON.parse(String(evt.data)) as { code?: string; reason?: string }
      reason = payload.reason || reason
      code = payload.code || ''
    } catch {
      // 解析失败时沿用默认失效原因。
    }

    const notice = shouldSuppressAuthNoticeByReason(reason)
      ? ''
      : resolveAuthNoticeByCode(
        code || undefined,
        resolveAuthNoticeByReason(reason, '登录状态已失效，请重新登录'),
      )

    disconnect()
    void triggerSessionInvalidation({ notice, skipApi: true })
  })
}

function attachBusinessEventListeners(args: {
  es: EventSource
  handlersRef: MutableRefObject<Record<string, SSEEventHandler>>
  lastOriginByRoomRef: MutableRefObject<Record<string, string>>
  lastSeqByRoomRef: MutableRefObject<Record<string, number>>
  markRoomStale: (room: string) => void
  onStreamStale?: () => void
  stableEventTypes: string[]
  stableRooms: string[]
}) {
  const {
    es,
    handlersRef,
    lastOriginByRoomRef,
    lastSeqByRoomRef,
    markRoomStale,
    onStreamStale,
    stableEventTypes,
    stableRooms,
  } = args

  stableEventTypes.forEach((eventType) => {
    es.addEventListener(eventType, (evt) => {
      try {
        const payload = JSON.parse(String(evt.data)) as SSEEventEnvelope
        const room = payload.room || stableRooms[0]
        const seq = Number(payload.seq ?? 0)

        if (room && seq > 0) {
          const seqResult = processSeqByConnection({
            lastOriginByRoomRef,
            lastSeqByRoomRef,
            origin: payload.origin,
            room,
            seq,
          })

          if (seqResult.isDuplicateOrOld) {
            return
          }
          if (seqResult.hasGap) {
            markCurrentStreamStale({ markRoomStale, onStreamStale, room, stableRooms })
            return
          }
        }

        const handler = handlersRef.current[eventType]
        if (!handler) {
          return
        }
        handler(payload)
      } catch (error) {
        console.error('[SSE] event parse/handle failed:', error)
      }
    })
  })
}

export function useSSE({
  rooms,
  handlers,
  autoConnect = true,
  withCredentials = true,
  onReconnect,
  onStreamStale,
}: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const connectionKeyRef = useRef(createSSEConnectionKey())
  const openedOnceRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => undefined)
  const handlersRef = useLatestRef(handlers)
  const lastOriginByRoomRef = useRef<Record<string, string>>({})
  const lastSeqByRoomRef = useRef<Record<string, number>>({})
  const onReconnectRef = useLatestRef(onReconnect)
  const onStreamStaleRef = useLatestRef(onStreamStale)
  const autoConnectRef = useLatestRef(autoConnect)
  const disposedRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)
  const markRoomStale = useSSEStore((state) => state.markRoomStale)
  const registerConnection = useSSEStore((state) => state.registerConnection)
  const unregisterConnection = useSSEStore((state) => state.unregisterConnection)
  const { roomsKey, stableEventTypes, stableRooms } = useStableSSEConfig({
    handlers,
    rooms,
  })
  useResetRoomTracking({
    lastOriginByRoomRef,
    lastSeqByRoomRef,
    roomsKey,
  })
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      globalThis.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const closeActiveSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    unregisterConnection(connectionKeyRef.current)
  }, [unregisterConnection])
  const disconnect = useCallback(() => {
    clearReconnectTimer()
    closeActiveSource()
    setIsConnected(false)
  }, [clearReconnectTimer, closeActiveSource])

  const connect = useCallback(() => {
    clearReconnectTimer()
    closeActiveSource()
    if (!roomsKey) {
      return
    }
    const eventsUrl = buildEventsUrl({
      lastSeqByRoom: buildLastSeqSnapshot({
        lastSeqByRoomRef,
        stableRooms,
      }),
      roomsKey,
    })
    const es = new EventSource(eventsUrl, { withCredentials })
    eventSourceRef.current = es

    attachConnectedListener({
      connectionKey: connectionKeyRef.current,
      es,
      markRoomStale,
      onConnected: () => setIsConnected(true),
      onReconnect: onReconnectRef.current,
      onStreamStale: onStreamStaleRef.current,
      openedOnceRef,
      registerConnection,
      setReconnectCount,
      stableRooms,
    })
    attachAuthInvalidListener({
      disconnect,
      es,
    })
    attachBusinessEventListeners({
      es,
      handlersRef,
      lastOriginByRoomRef,
      lastSeqByRoomRef,
      markRoomStale,
      onStreamStale: onStreamStaleRef.current,
      stableEventTypes,
      stableRooms,
    })

    es.onerror = () => {
      if (eventSourceRef.current !== es) {
        return
      }

      es.close()
      eventSourceRef.current = null
      unregisterConnection(connectionKeyRef.current)
      setIsConnected(false)

      if (!autoConnectRef.current || disposedRef.current) {
        return
      }
      if (reconnectTimerRef.current !== null) {
        return
      }
      reconnectTimerRef.current = globalThis.setTimeout(() => {
        reconnectTimerRef.current = null
        if (!disposedRef.current && autoConnectRef.current) {
          connectRef.current()
        }
      }, SSE_RECONNECT_DELAY_MS)
    }
  }, [
    autoConnectRef,
    clearReconnectTimer,
    closeActiveSource,
    disconnect,
    handlersRef,
    markRoomStale,
    onReconnectRef,
    onStreamStaleRef,
    registerConnection,
    roomsKey,
    stableEventTypes,
    stableRooms,
    unregisterConnection,
    withCredentials,
  ])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    disposedRef.current = false
    registerSSEDisconnect(disconnect)
    if (autoConnect) {
      connect()
    }
    return () => {
      disposedRef.current = true
      unregisterSSEDisconnect(disconnect)
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return { connect, disconnect, isConnected, reconnectCount }
}
