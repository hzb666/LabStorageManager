import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchCompletionAPI } from '@/api/client'
import type { InlineCompletionResponse } from '@/api/client'

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

const COMPLETION_CACHE = new Map<string, InlineCompletionResponse>()
const CACHE_MAX_SIZE = 200
const ALL_SEARCH_FIELD = 'all'

function buildCacheKey(endpoint: string, field: string, normalizedPrefix: string): string {
  return `${endpoint}:${field}:${normalizedPrefix}`
}

function getCached(key: string): InlineCompletionResponse | undefined {
  return COMPLETION_CACHE.get(key)
}

function setCache(key: string, value: InlineCompletionResponse): void {
  if (COMPLETION_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = COMPLETION_CACHE.keys().next().value
    if (firstKey !== undefined) {
      COMPLETION_CACHE.delete(firstKey)
    }
  }
  COMPLETION_CACHE.set(key, value)
}

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
  debounceMs = 120,
  minLength = 1,
}: UseInlineSearchCompletionOptions): UseInlineSearchCompletionResult {
  const [completionState, setCompletionState] = useState<InlineCompletionResponse | null>(null)
  const [hiddenForValue, setHiddenForValue] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmed = value.trim()
  const normalizedPrefix = trimmed.toLowerCase()
  const isActive = enabled && field === ALL_SEARCH_FIELD
  const cacheKey = buildCacheKey(endpoint, field, normalizedPrefix)
  const completion = useMemo(() => {
    if (!isActive || normalizedPrefix.length < minLength) {
      return null
    }

    const cached = getCompletionForPrefix(
      getCached(cacheKey),
      normalizedPrefix,
      trimmed.length,
    )

    return cached ?? getCompletionForPrefix(
      completionState,
      normalizedPrefix,
      trimmed.length,
    )
  }, [cacheKey, completionState, isActive, minLength, normalizedPrefix, trimmed.length])
  const hidden = hiddenForValue === value

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (!isActive || trimmed.length < minLength) {
      abortRef.current?.abort()
      return
    }

    // 当前补全覆盖输入时跳过请求
    if (completion?.completion || getCached(cacheKey)) {
      return
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      searchCompletionAPI.getInline({
        endpoint,
        field,
        q: trimmed,
      })
        .then((res) => {
          if (controller.signal.aborted) return
          setCache(cacheKey, res.data)
          setCompletionState(res.data)
        })
        .catch(() => {})
    }, debounceMs)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [cacheKey, completion, debounceMs, endpoint, field, isActive, minLength, trimmed])

  const onAccept = useCallback(() => {
    if (!completion?.completion) return value
    setHiddenForValue(value)
    return completion.completion
  }, [completion, value])

  const onDismiss = useCallback(() => {
    setHiddenForValue(value)
  }, [value])

  const submitFeedback = useCallback((accepted: boolean) => {
    if (!isActive || !completion?.completion) return
    searchCompletionAPI.submitFeedback({
      endpoint,
      field,
      query: completion.completion,
      accepted,
    }).catch(() => {})
  }, [completion, endpoint, field, isActive])

  return { completion, hidden, onAccept, onDismiss, submitFeedback }
}
