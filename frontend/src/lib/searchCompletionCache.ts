import type { InlineCompletionResponse } from '@/api/client'

export interface CachedCompletion {
  scope: string
  value: InlineCompletionResponse
  expiresAt: number
}

export const COMPLETION_CACHE_TTL_MS = 60_000
const CACHE_MAX_SIZE = 200
const cache = new Map<string, CachedCompletion>()
let generation = 0

export function clearSearchCompletionCache(): void {
  cache.clear()
  generation += 1
}

export function createCompletionScope(userId: number | null, endpoint: string, field: string): string {
  return `${generation}:${JSON.stringify([userId, endpoint, field])}`
}

export function validCompletion(entry: CachedCompletion | null | undefined, scope: string): CachedCompletion | null {
  return entry && entry.scope === scope && scope.startsWith(`${generation}:`) && entry.expiresAt > Date.now()
    ? entry
    : null
}

export function getCachedCompletion(scope: string, prefix: string): CachedCompletion | null {
  const key = JSON.stringify([scope, prefix])
  const entry = validCompletion(cache.get(key), scope)
  if (!entry) cache.delete(key)
  return entry
}

export function cacheCompletion(scope: string, prefix: string, value: InlineCompletionResponse): CachedCompletion | null {
  if (!value.completion || !scope.startsWith(`${generation}:`)) return null
  const key = JSON.stringify([scope, prefix])
  const entry = { scope, value, expiresAt: Date.now() + COMPLETION_CACHE_TTL_MS }
  cache.delete(key)
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, entry)
  return entry
}
