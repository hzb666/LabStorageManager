import { useCallback, useRef, useState } from 'react'

import { reagentOrderAPI, type CASOverviewResponse } from '@/api/client'
import {
  isSpecialCasValue,
  normalizeCASInputValue,
  validateAndNormalizeCASInput,
} from '@/lib/validationSchemas'

export function useReagentCasDuplicateCheck() {
  const [casWarning, setCasWarning] = useState<CASOverviewResponse | null>(null)
  const [casLoading, setCasLoading] = useState(false)
  const casRequestIdRef = useRef(0)
  const lastCheckedCasRef = useRef<string | null>(null)

  const clearCASWarning = useCallback(() => {
    casRequestIdRef.current += 1
    setCasWarning(null)
    setCasLoading(false)
    lastCheckedCasRef.current = null
  }, [])

  const handleCasValueChange = useCallback((casInput: string | null | undefined) => {
    const currentValue = normalizeCASInputValue(casInput || '')
    if (!lastCheckedCasRef.current || currentValue !== lastCheckedCasRef.current) {
      casRequestIdRef.current += 1
      setCasWarning(null)
      setCasLoading(false)
      lastCheckedCasRef.current = null
    }
  }, [])

  const checkCASWarning = useCallback(async (casInput: string, options?: { force?: boolean }) => {
    const casValidation = validateAndNormalizeCASInput(casInput || '')
    if ('error' in casValidation) {
      setCasWarning(null)
      setCasLoading(false)
      return
    }

    const normalizedCas = casValidation.normalized
    if (isSpecialCasValue(normalizedCas)) {
      setCasWarning(null)
      setCasLoading(false)
      lastCheckedCasRef.current = normalizedCas
      return
    }

    if (!options?.force && lastCheckedCasRef.current === normalizedCas) {
      return
    }

    const requestId = ++casRequestIdRef.current
    setCasLoading(true)

    try {
      const response = await reagentOrderAPI.getCASOverview(normalizedCas)
      if (requestId !== casRequestIdRef.current) {
        return
      }
      const overview = response.data
      setCasWarning(overview.has_warning ? overview : null)
      lastCheckedCasRef.current = normalizedCas
    } catch (error) {
      if (requestId === casRequestIdRef.current) {
        console.error('CAS check error:', error)
      }
    } finally {
      if (requestId === casRequestIdRef.current) {
        setCasLoading(false)
      }
    }
  }, [])

  return {
    casWarning,
    casLoading,
    checkCASWarning,
    clearCASWarning,
    handleCasValueChange,
  }
}
