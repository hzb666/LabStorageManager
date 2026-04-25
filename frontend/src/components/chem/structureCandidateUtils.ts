import type { PubChemCandidate } from '@/api/structureSearchApi'

export function parseStructureCandidates(value: string | null): PubChemCandidate[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is PubChemCandidate => typeof item === 'object' && item !== null,
    )
  } catch {
    return []
  }
}
