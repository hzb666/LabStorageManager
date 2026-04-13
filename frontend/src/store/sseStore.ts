/** SSE 运行时状态仓库。 */
import { create } from 'zustand'

export type SeqProcessResult = {
  isDuplicateOrOld: boolean
  hasGap: boolean
  previousSeq: number
}

export interface SSEState {
  isConnected: boolean
  clientId: string | null
  reconnectCount: number
  lastConnectedAt: number | null

  // 按房间记录序号，便于检查事件连续性。
  lastSeqByRoom: Record<string, number>
  staleRooms: Set<string>

  setConnected: (clientId: string) => void
  setDisconnected: () => void
  incrementReconnectCount: () => void

  markRoomStale: (room: string) => void
  clearRoomStale: (room: string) => void
  markStaleKey: (key: string) => void
  clearStaleKey: (key: string) => void
  hasStaleKey: (key: string) => boolean
  clearAllStale: () => void

  processSeq: (room: string, seq: number) => SeqProcessResult
  reset: () => void
}

const initialState = {
  isConnected: false,
  clientId: null,
  reconnectCount: 0,
  lastConnectedAt: null,
  lastSeqByRoom: {},
  staleRooms: new Set<string>(),
}

export const useSSEStore = create<SSEState>((set, get) => ({
  ...initialState,

  setConnected: (clientId) =>
    set(() => ({
      isConnected: true,
      clientId,
      lastConnectedAt: Date.now(),
    })),

  setDisconnected: () =>
    set(() => ({
      isConnected: false,
    })),

  incrementReconnectCount: () =>
    set((state) => ({
      reconnectCount: state.reconnectCount + 1,
    })),

  markRoomStale: (room) =>
    set((state) => ({
      staleRooms: new Set([...state.staleRooms, room]),
    })),

  clearRoomStale: (room) =>
    set((state) => {
      const next = new Set(state.staleRooms)
      for (const key of state.staleRooms) {
        if (key === room || key.startsWith(`${room}::`)) {
          next.delete(key)
        }
      }
      return { staleRooms: next }
    }),

  markStaleKey: (key) =>
    set((state) => ({
      staleRooms: new Set([...state.staleRooms, key]),
    })),

  clearStaleKey: (key) =>
    set((state) => {
      const next = new Set(state.staleRooms)
      next.delete(key)
      return { staleRooms: next }
    }),

  hasStaleKey: (key) => get().staleRooms.has(key),

  clearAllStale: () =>
    set(() => ({
      staleRooms: new Set<string>(),
    })),

  processSeq: (room, seq) => {
    const prev = get().lastSeqByRoom[room] ?? 0

    // 忽略重复事件和旧事件。
    if (seq <= prev) {
      return {
        isDuplicateOrOld: true,
        hasGap: false,
        previousSeq: prev,
      }
    }

    const hasGap = prev > 0 && seq > prev + 1
    set((state) => ({
      lastSeqByRoom: {
        ...state.lastSeqByRoom,
        [room]: seq,
      },
    }))

    return {
      isDuplicateOrOld: false,
      hasGap,
      previousSeq: prev,
    }
  },

  reset: () => set(() => ({ ...initialState })),
}))
