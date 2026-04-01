/**
 * Generic SSE hook for room-based event streams.
 *
 * Integration:
 * 1) Build event handlers in page/domain hook.
 * 2) Call useSSE({ rooms, handlers }).
 * 3) Use store stale flag to show refresh banner.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { getApiBaseUrl } from '@/lib/apiConfig'
import {
  resolveAuthNoticeByCode,
  resolveAuthNoticeByReason,
  triggerSessionInvalidation,
} from '@/lib/authSession'
import { registerSSEDisconnect, unregisterSSEDisconnect } from '@/lib/sseRuntime'
import { useSSEStore } from '@/store/sseStore'

export interface SSEEventEnvelope {
  room: string
  seq: number
  event: string
  data: Record<string, unknown>
  timestamp?: string
  actor_client_id?: string
}

export type SSEEventHandler = (event: SSEEventEnvelope) => void

export interface SSEOptions {
  rooms: string[]
  handlers: Record<string, SSEEventHandler>
  autoConnect?: boolean
  withCredentials?: boolean
  onStreamStale?: () => void
}

function markCurrentStreamStale(args: {
  markRoomStale: (room: string) => void
  onStreamStale?: () => void
  stableRooms: string[]
  room?: string
}) {
  const { markRoomStale, onStreamStale, stableRooms, room } = args
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
  es: EventSource
  incrementReconnectCount: () => void
  markRoomStale: (room: string) => void
  onStreamStale?: () => void
  openedOnceRef: MutableRefObject<boolean>
  setConnected: (clientId: string) => void
  stableRooms: string[]
}) {
  const {
    es,
    incrementReconnectCount,
    markRoomStale,
    onStreamStale,
    openedOnceRef,
    setConnected,
    stableRooms,
  } = args

  es.addEventListener('connected', (evt) => {
    try {
      const payload = JSON.parse(String(evt.data)) as { client_id?: string }
      setConnected(payload.client_id ?? 'unknown')

      if (openedOnceRef.current) {
        incrementReconnectCount()
        markCurrentStreamStale({ markRoomStale, onStreamStale, stableRooms })
      }
      openedOnceRef.current = true
    } catch {
      setConnected('unknown')
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
      const payload = JSON.parse(String(evt.data)) as { reason?: string; code?: string }
      reason = payload.reason || reason
      code = payload.code || ''
    } catch {
      // keep fallback reason
    }

    const noticeByReason = resolveAuthNoticeByReason(reason, '登录状态已失效，请重新登录')
    const notice = resolveAuthNoticeByCode(code || undefined, noticeByReason)

    disconnect()
    void triggerSessionInvalidation({ notice, skipApi: true })
  })
}

function attachBusinessEventListeners(args: {
  es: EventSource
  handlersRef: MutableRefObject<Record<string, SSEEventHandler>>
  markRoomStale: (room: string) => void
  onStreamStale?: () => void
  processSeq: (room: string, seq: number) => {
    isDuplicateOrOld: boolean
    hasGap: boolean
  }
  stableEventTypes: string[]
  stableRooms: string[]
}) {
  const {
    es,
    handlersRef,
    markRoomStale,
    onStreamStale,
    processSeq,
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
          const seqResult = processSeq(room, seq)

          if (seqResult.isDuplicateOrOld) {
            return
          }
          if (seqResult.hasGap) {
            markCurrentStreamStale({ markRoomStale, onStreamStale, stableRooms, room })
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
  onStreamStale,
}: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const openedOnceRef = useRef(false)
  const handlersRef = useRef(handlers)
  const onStreamStaleRef = useRef(onStreamStale)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    onStreamStaleRef.current = onStreamStale
  }, [onStreamStale])

  const isConnected = useSSEStore((state) => state.isConnected)
  const reconnectCount = useSSEStore((state) => state.reconnectCount)
  const setConnected = useSSEStore((state) => state.setConnected)
  const setDisconnected = useSSEStore((state) => state.setDisconnected)
  const incrementReconnectCount = useSSEStore((state) => state.incrementReconnectCount)
  const markRoomStale = useSSEStore((state) => state.markRoomStale)
  const processSeq = useSSEStore((state) => state.processSeq)

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

  const eventsUrl = useMemo(() => {
    const base = getApiBaseUrl().replace(/\/$/, '')
    const qs = new URLSearchParams({ rooms: roomsKey })
    return `${base}/events?${qs.toString()}`
  }, [roomsKey])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setDisconnected()
  }, [setDisconnected])

  const connect = useCallback(() => {
    disconnect()

    const es = new EventSource(eventsUrl, { withCredentials })
    eventSourceRef.current = es

    attachConnectedListener({
      es,
      incrementReconnectCount,
      markRoomStale,
      onStreamStale: onStreamStaleRef.current,
      openedOnceRef,
      setConnected,
      stableRooms,
    })
    attachAuthInvalidListener({
      disconnect,
      es,
    })
    attachBusinessEventListeners({
      es,
      handlersRef,
      markRoomStale,
      onStreamStale: onStreamStaleRef.current,
      processSeq,
      stableEventTypes,
      stableRooms,
    })

    es.onerror = () => {
      setDisconnected()
    }
  }, [
    disconnect,
    eventsUrl,
    stableEventTypes,
    withCredentials,
    incrementReconnectCount,
    markRoomStale,
    processSeq,
    stableRooms,
    setConnected,
    setDisconnected,
    onStreamStaleRef,
  ])

  useEffect(() => {
    registerSSEDisconnect(disconnect)
    if (autoConnect) {
      connect()
    }
    return () => {
      unregisterSSEDisconnect(disconnect)
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return {
    isConnected,
    reconnectCount,
    connect,
    disconnect,
  }
}
