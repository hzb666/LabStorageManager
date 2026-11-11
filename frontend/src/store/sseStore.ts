/** SSE 运行时状态仓库。 */
import { create } from 'zustand'

export interface SSEState {
  clientId: string | null
  activeClientIds: string[]
  connectionsByKey: Record<string, string>

  staleVersions: Record<string, number>
  staleRevision: number

  registerConnection: (connectionKey: string, clientId: string) => void
  unregisterConnection: (connectionKey: string) => void
  hasActiveClientId: (clientId: string) => boolean

  markRoomStale: (room: string) => void
  clearRoomStale: (room: string) => void
  markStaleKey: (key: string) => void
  clearStaleKey: (key: string, expectedVersion?: number) => void
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
  staleVersions: {} as Record<string, number>,
  staleRevision: 0,
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

  markRoomStale: (room) => get().markStaleKey(room),

  clearRoomStale: (room) =>
    set((state) => {
      const versions = { ...state.staleVersions }
      for (const key of Object.keys(versions)) {
        if (key === room || key.startsWith(`${room}::`)) {
          delete versions[key]
        }
      }
      return { staleVersions: versions }
    }),

  markStaleKey: (key) =>
    set((state) => ({
      staleVersions: { ...state.staleVersions, [key]: state.staleRevision + 1 },
      staleRevision: state.staleRevision + 1,
    })),

  clearStaleKey: (key, expectedVersion) =>
    set((state) => {
      if (expectedVersion !== undefined && state.staleVersions[key] !== expectedVersion) return state
      const versions = { ...state.staleVersions }
      delete versions[key]
      return { staleVersions: versions }
    }),

  hasStaleKey: (key) => Object.hasOwn(get().staleVersions, key),

  clearAllStale: () =>
    set(() => ({
      staleVersions: {},
    })),

  reset: () => set((state) => ({ ...initialState, staleRevision: state.staleRevision + 1 })),
}))
