export const SEARCH_INPUT_MAX_LENGTH = 1000
export const SEARCH_QUERY_MAX_LENGTH = 20_000

export function getEffectiveSearchMaxLength(value: string, field: string): number {
  return field === 'cas_number' && value.includes('&&')
    ? SEARCH_QUERY_MAX_LENGTH
    : SEARCH_INPUT_MAX_LENGTH
}
