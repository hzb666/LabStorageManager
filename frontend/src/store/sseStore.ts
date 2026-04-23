/** SSE 运行时状态仓库。 */
import { create } from 'zustand'

export interface SSEState {
  clientId: string | null
  activeClientIds: string[]
  connectionsByKey: Record<string, string>

  staleRooms: Set<string>

  registerConnection: (connectionKey: string, clientId: string) => void
  unregisterConnection: (connectionKey: string) => void
  hasActiveClientId: (clientId: string) => boolean

  markRoomStale: (room: string) => void
  clearRoomStale: (room: string) => void
  markStaleKey: (key: string) => void
  clearStaleKey: (key: string) => void
  hasStaleKey: (key: string) => boolean
  clearAllStale: () => void

  reset: () => void
}

type SSEConnectionsState = {
  activeClientIds: string[]
  clientId: string | null
  connectionsByKey: Record<string, string>
}

const initialState = {
  clientId: null,
  activeClientIds: [],
  connectionsByKey: {},
  staleRooms: new Set<string>(),
}

function deriveConnectionsState(
  connectionsByKey: Record<string, string>
): SSEConnectionsState {
  const orderedClientIds = Object.values(connectionsByKey)
  const activeClientIds = Array.from(new Set(orderedClientIds))

  return {
    activeClientIds,
    clientId: activeClientIds.length > 0 ? activeClientIds[activeClientIds.length - 1] : null,
    connectionsByKey,
  }
}

export const useSSEStore = create<SSEState>((set, get) => ({
  ...initialState,

  registerConnection: (connectionKey, clientId) =>
    set((state) => {
      const nextConnections = { ...state.connectionsByKey }
      delete nextConnections[connectionKey]
      nextConnections[connectionKey] = clientId
      return deriveConnectionsState(nextConnections)
    }),

  unregisterConnection: (connectionKey) =>
    set((state) => {
      if (!(connectionKey in state.connectionsByKey)) {
        return {}
      }
      const nextConnections = { ...state.connectionsByKey }
      delete nextConnections[connectionKey]
      return deriveConnectionsState(nextConnections)
    }),

  hasActiveClientId: (clientId) => get().activeClientIds.includes(clientId),

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

  reset: () => set(() => ({ ...initialState })),
}))
