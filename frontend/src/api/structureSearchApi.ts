import { api } from '@/api/client'

export type StructureQueryFormat = 'smarts' | 'molblock' | 'smiles'

export interface StructureIndexStatus {
  version: number
  dirty: boolean
  molecule_count: number
}

export interface SubstructureSearchRequest {
  query: string
  format: StructureQueryFormat
  limit?: number
  use_chirality?: boolean
  only_in_stock?: boolean
}

export interface InventoryStructureSummary {
  cas_number: string
  item_count: number
  display_name: string | null
  english_name: string | null
  locations: string[]
  total_by_unit: Record<string, number>
}

export interface SubstructureSearchResult {
  cas_number: string
  smiles_canonical: string
  inchikey: string | null
  source: string | null
  inventory_summary: InventoryStructureSummary | null
}

export interface SubstructureSearchResponse {
  total: number
  limit: number
  elapsed_ms: number
  index: StructureIndexStatus
  results: SubstructureSearchResult[]
}

export const structureSearchAPI = {
  searchSubstructure: async (
    payload: SubstructureSearchRequest,
  ): Promise<SubstructureSearchResponse> => {
    const response = await api.post<SubstructureSearchResponse>(
      '/chem/search/substructure',
      payload,
    )
    return response.data
  },

  getIndexStatus: async (): Promise<StructureIndexStatus> => {
    const response = await api.get<StructureIndexStatus>('/chem/index/status')
    return response.data
  },

  rebuildIndex: async (): Promise<StructureIndexStatus> => {
    const response = await api.post<StructureIndexStatus>('/chem/index/rebuild')
    return response.data
  },
}
