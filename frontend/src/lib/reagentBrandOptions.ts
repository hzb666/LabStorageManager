import { reagentBrandAPI, type ReagentBrandItem } from '@/api/client'
import type { AutocompleteOption } from '@/components/ui/AutoComplete'

export const REAGENT_BRAND_OPTIONS_LIMIT = 500
export const REAGENT_BRAND_OPTIONS_QUERY_KEY = ['reagent-brands', 'options'] as const

export function toReagentBrandOptions(brands: ReagentBrandItem[]): AutocompleteOption[] {
  return brands.map((brand) => ({ label: brand.name, value: brand.name }))
}

export function getReagentBrandOptionsQueryOptions() {
  return {
    queryKey: REAGENT_BRAND_OPTIONS_QUERY_KEY,
    queryFn: async () => {
      const response = await reagentBrandAPI.list({
        limit: REAGENT_BRAND_OPTIONS_LIMIT,
        sort_by: 'name',
        sort_order: 'asc',
      })
      return toReagentBrandOptions(response.data.data)
    },
    staleTime: 5 * 60 * 1000,
  }
}
