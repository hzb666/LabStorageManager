export const SEARCH_MATCH_MODES = {
  CONTAINS: 'contains',
  EXACT: 'exact',
} as const

export type SearchMatchMode = (typeof SEARCH_MATCH_MODES)[keyof typeof SEARCH_MATCH_MODES]

export const DEFAULT_SEARCH_MATCH_MODE: SearchMatchMode = SEARCH_MATCH_MODES.CONTAINS

const LOOSE_SEARCH_CHARS = ['-', ' ', '\u00A0', '\u2002', '\u2003', '\u2009', '\u200C', '\u200D', '_']
const SEGMENTED_SEARCH_MAX_TERMS = 8

export function normalizeSearchText(value: unknown, fuzzy = false): string {
  if (value === null || value === undefined) {
    return ''
  }

  const text = String(value).trim().toLowerCase()
  if (!fuzzy) {
    return text
  }
  return LOOSE_SEARCH_CHARS.reduce(
    (current, char) => current.split(char).join(''),
    text,
  )
}

export function matchesSearchText(
  value: unknown,
  keyword: string,
  matchMode: SearchMatchMode,
  fuzzy = false,
): boolean {
  const normalizedValue = normalizeSearchText(value, fuzzy)
  const normalizedKeyword = normalizeSearchText(keyword, fuzzy)
  if (!normalizedKeyword) {
    return true
  }

  if (matchMode === SEARCH_MATCH_MODES.EXACT) {
    return normalizedValue === normalizedKeyword
  }
  return normalizedValue.includes(normalizedKeyword)
}

export function containsSearchText(value: unknown, keyword: string, fuzzy = false): boolean {
  return matchesSearchText(value, keyword, SEARCH_MATCH_MODES.CONTAINS, fuzzy)
}

export function splitAndSearchTerms(keyword: string): string[] {
  return keyword
    .split('&&')
    .map((term) => term.trim())
    .filter(Boolean)
}

export function splitSegmentedSearchTerms(keyword: string): string[] {
  const trimmedKeyword = keyword.trim()
  if (!trimmedKeyword.includes(' ') || trimmedKeyword.includes('&&')) {
    return []
  }

  const terms: string[] = []
  const normalizedTerms = new Set<string>()
  for (const term of trimmedKeyword.split(/ +/)) {
    const normalizedTerm = term.toLowerCase()
    if (!term || normalizedTerms.has(normalizedTerm)) {
      continue
    }
    terms.push(term)
    normalizedTerms.add(normalizedTerm)
  }

  return terms.length > 1 && terms.length <= SEGMENTED_SEARCH_MAX_TERMS ? terms : []
}
