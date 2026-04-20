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

export type CompoundStructureStatus =
  | 'pending'
  | 'resolved'
  | 'ambiguous'
  | 'not_found'
  | 'unsupported'
  | 'invalid_cas'
  | 'error'

export interface CompoundStructureCache {
  id?: number
  cas_number: string
  smiles_canonical: string | null
  smiles_isomeric: string | null
  molblock: string | null
  inchikey: string | null
  molecular_formula: string | null
  molecular_weight: number | null
  source: string | null
  source_id: string | null
  source_url: string | null
  status: CompoundStructureStatus
  confidence: number
  candidate_count: number
  candidates_json: string | null
  error_message: string | null
  manually_verified: boolean
  last_resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface ResolveCasPayload {
  cas_number: string
  force?: boolean
  overwrite_manual?: boolean
}

export interface ManualStructurePayload {
  molblock: string
}

export interface ConfirmPubChemPayload {
  cid: number
  overwrite_manual?: boolean
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

  getCache: async (casNumber: string): Promise<CompoundStructureCache | null> => {
    const response = await api.get<CompoundStructureCache | null>(
      `/chem/structures/cache/${encodeURIComponent(casNumber)}`,
    )
    return response.data
  },

  resolveCas: async (payload: ResolveCasPayload): Promise<CompoundStructureCache> => {
    const response = await api.post<CompoundStructureCache>(
      '/chem/structures/resolve-cas',
      payload,
    )
    return response.data
  },

  saveManualStructure: async (
    casNumber: string,
    payload: ManualStructurePayload,
  ): Promise<CompoundStructureCache> => {
    const response = await api.put<CompoundStructureCache>(
      `/chem/structures/cache/${encodeURIComponent(casNumber)}/manual`,
      payload,
    )
    return response.data
  },

  confirmPubChemCandidate: async (
    casNumber: string,
    payload: ConfirmPubChemPayload,
  ): Promise<CompoundStructureCache> => {
    const response = await api.post<CompoundStructureCache>(
      `/chem/structures/cache/${encodeURIComponent(casNumber)}/confirm-pubchem`,
      payload,
    )
    return response.data
  },
}
