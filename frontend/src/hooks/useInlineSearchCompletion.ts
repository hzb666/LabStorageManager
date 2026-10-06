import { useCallback, useEffect, useState } from 'react'
import { searchCompletionAPI } from '@/api/client'
import type { InlineCompletionResponse } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { useInventoryReadOnly } from '@/lib/inventoryReadOnly'
import {
  cacheCompletion, createCompletionScope, getCachedCompletion, validCompletion,
  type CachedCompletion,
} from '@/lib/searchCompletionCache'

interface UseInlineSearchCompletionOptions {
  endpoint: string
  field: string
  value: string
  enabled: boolean
  debounceMs?: number
  minLength?: number
}

interface UseInlineSearchCompletionResult {
  completion: InlineCompletionResponse | null
  hidden: boolean
  onAccept: () => string
  onDismiss: () => void
  submitFeedback: (accepted: boolean) => void
}

const ALL_SEARCH_FIELD = 'all'

function getCompletionForPrefix(
  value: InlineCompletionResponse | null | undefined,
  normalizedPrefix: string,
  prefixLength: number,
): InlineCompletionResponse | null {
  if (!value?.completion) {
    return null
  }

  if (!value.completion.toLowerCase().startsWith(normalizedPrefix)) {
    return null
  }

  return {
    ...value,
    suffix: value.completion.slice(prefixLength),
  }
}

export function useInlineSearchCompletion({
  endpoint,
  field,
  value,
  enabled,
  debounceMs = 200,
  minLength = 1,
}: UseInlineSearchCompletionOptions): UseInlineSearchCompletionResult {
  const inventoryReadOnly = useInventoryReadOnly()
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? null : null)
  const [completionState, setCompletionState] = useState<{ entry: CachedCompletion | null }>({ entry: null })
  const [hiddenForKey, setHiddenForKey] = useState<string | null>(null)

  const trimmed = value.trim()
  const normalizedPrefix = trimmed.toLowerCase()
  const hasSegmentSpace = value.includes(' ')
  const isActive = userId !== null && enabled && field === ALL_SEARCH_FIELD && !hasSegmentSpace
  const scope = createCompletionScope(userId, endpoint, field)
  const candidate = getCachedCompletion(scope, normalizedPrefix) ?? validCompletion(completionState.entry, scope)
  const completion = isActive && normalizedPrefix.length >= minLength
    ? getCompletionForPrefix(candidate?.value, normalizedPrefix, trimmed.length)
    : null
  const dismissalKey = JSON.stringify([scope, value])
  const hidden = hiddenForKey === dismissalKey

  useEffect(() => {
    if (!candidate || !isActive) return
    const timer = setTimeout(() => setCompletionState({ entry: null }), Math.max(0, candidate.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [candidate, isActive])

  useEffect(() => {
    if (!isActive || trimmed.length < minLength || completion?.completion) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchCompletionAPI.getInline({
        endpoint,
        field,
        q: trimmed,
      }, controller.signal)
        .then((res) => {
          if (controller.signal.aborted || scope !== createCompletionScope(userId, endpoint, field)) return
          setCompletionState({ entry: cacheCompletion(scope, normalizedPrefix, res.data) })
        })
        .catch(() => {})
    }, debounceMs)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [scope, completion?.completion, debounceMs, endpoint, field, isActive, minLength, normalizedPrefix, trimmed, userId])

  const onAccept = useCallback(() => {
    if (!completion?.completion || !validCompletion(candidate, scope)) return value
    setHiddenForKey(dismissalKey)
    return completion.completion
  }, [candidate, completion, dismissalKey, scope, value])

  const onDismiss = useCallback(() => {
    setHiddenForKey(dismissalKey)
  }, [dismissalKey])

  const submitFeedback = useCallback((accepted: boolean) => {
    if (inventoryReadOnly || !isActive || !completion?.completion || !validCompletion(candidate, scope)) return
    searchCompletionAPI.submitFeedback({
      endpoint,
      field,
      query: completion.completion,
      accepted,
    }).catch(() => {})
  }, [candidate, completion, endpoint, field, isActive, inventoryReadOnly, scope])

  return { completion, hidden, onAccept, onDismiss, submitFeedback }
}
