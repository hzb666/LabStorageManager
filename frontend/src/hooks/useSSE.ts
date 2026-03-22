/**
 * Generic SSE hook for room-based event streams.
 *
 * Integration:
 * 1) Build event handlers in page/domain hook.
 * 2) Call useSSE({ rooms, handlers }).
 * 3) Use store stale flag to show refresh banner.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getApiBaseUrl } from '@/lib/apiConfig'
import { useSSEStore } from '@/store/sseStore'

export interface SSEEventEnvelope {
  room: string
  seq: number
  event: string
  data: Record<string, unknown>
  timestamp?: string
}

export type SSEEventHandler = (event: SSEEventEnvelope) => void

export interface SSEOptions {
  rooms: string[]
  handlers: Record<string, SSEEventHandler>
  autoConnect?: boolean
  withCredentials?: boolean
}

export function useSSE({
  rooms,
  handlers,
  autoConnect = true,
  withCredentials = true,
}: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const openedOnceRef = useRef(false)

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

    es.addEventListener('connected', (evt) => {
      try {
        const payload = JSON.parse(String(evt.data)) as { client_id?: string }
        setConnected(payload.client_id ?? 'unknown')

        // A successful re-open after previous open means stream recovery happened.
        if (openedOnceRef.current) {
          incrementReconnectCount()
          stableRooms.forEach((room) => markRoomStale(room))
        }
        openedOnceRef.current = true
      } catch {
        setConnected('unknown')
      }
    })

    Object.entries(handlers).forEach(([eventType, handler]) => {
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
              markRoomStale(room)
              return
            }
          }

          handler(payload)
        } catch (error) {
          console.error('[SSE] event parse/handle failed:', error)
        }
      })
    })

    es.onerror = () => {
      setDisconnected()
    }
  }, [
    disconnect,
    eventsUrl,
    withCredentials,
    handlers,
    incrementReconnectCount,
    markRoomStale,
    processSeq,
    stableRooms,
    setConnected,
    setDisconnected,
  ])

  useEffect(() => {
    if (autoConnect) {
      connect()
    }
    return () => {
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
