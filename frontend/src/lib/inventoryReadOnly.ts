import { createContext, useContext } from 'react'

export interface InventoryReadOnlyState {
  enabled: boolean
  snapshotCreatedAt: string | null
}

export const InventoryReadOnlyContext = createContext<InventoryReadOnlyState>({
  enabled: false,
  snapshotCreatedAt: null,
})

export function useInventoryReadOnly() {
  return useContext(InventoryReadOnlyContext).enabled
}

export function useInventorySnapshotCreatedAt() {
  return useContext(InventoryReadOnlyContext).snapshotCreatedAt
}
