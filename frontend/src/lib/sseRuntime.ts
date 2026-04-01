const sseDisconnectors = new Set<() => void>()

export const registerSSEDisconnect = (disconnect: () => void) => {
  sseDisconnectors.add(disconnect)
}

export const unregisterSSEDisconnect = (disconnect: () => void) => {
  sseDisconnectors.delete(disconnect)
}

export const disconnectAllSSEConnections = () => {
  for (const disconnect of Array.from(sseDisconnectors)) {
    try {
      disconnect()
    } catch (error) {
      console.error('SSE disconnect failed:', error)
    }
  }
}
