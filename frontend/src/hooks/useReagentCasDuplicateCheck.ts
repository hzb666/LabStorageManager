import { useCallback, useRef, useState } from 'react'

import { reagentOrderAPI, type CASOverviewResponse } from '@/api/client'
import {
  isSpecialCasValue,
  normalizeCASInputValue,
  validateAndNormalizeCASInput,
} from '@/lib/validationSchemas'

export function useReagentCasDuplicateCheck() {
  const [casWarning, setCasWarning] = useState<CASOverviewResponse | null>(null)
  const [casOverview, setCasOverview] = useState<CASOverviewResponse | null>(null)
  const [casLoading, setCasLoading] = useState(false)
  const casRequestIdRef = useRef(0)
  const lastCheckedCasRef = useRef<string | null>(null)

  const clearCASWarning = useCallback(() => {
    casRequestIdRef.current += 1
    setCasWarning(null)
    setCasOverview(null)
    setCasLoading(false)
    lastCheckedCasRef.current = null
  }, [])

  const handleCasValueChange = useCallback((casInput: string | null | undefined) => {
    const currentValue = normalizeCASInputValue(casInput || '')
    if (!lastCheckedCasRef.current || currentValue !== lastCheckedCasRef.current) {
      casRequestIdRef.current += 1
      setCasWarning(null)
      setCasOverview(null)
      setCasLoading(false)
      lastCheckedCasRef.current = null
    }
  }, [])

  const checkCASOverview = useCallback(async (
    casInput: string,
    options?: { force?: boolean },
  ): Promise<CASOverviewResponse | null | undefined> => {
    const casValidation = validateAndNormalizeCASInput(casInput || '')
    if ('error' in casValidation) {
      setCasWarning(null)
      setCasOverview(null)
      setCasLoading(false)
      return null
    }

    const normalizedCas = casValidation.normalized
    if (isSpecialCasValue(normalizedCas)) {
      setCasWarning(null)
      setCasOverview(null)
      setCasLoading(false)
      lastCheckedCasRef.current = normalizedCas
      return null
    }

    if (!options?.force && lastCheckedCasRef.current === normalizedCas) {
      return null
    }

    const requestId = ++casRequestIdRef.current
    setCasLoading(true)

    try {
      const response = await reagentOrderAPI.getCASOverview(normalizedCas)
      if (requestId !== casRequestIdRef.current) {
        return null
      }
      const overview = response.data
      setCasOverview(overview)
      setCasWarning(overview.has_warning || overview.is_common_cas ? overview : null)
      lastCheckedCasRef.current = normalizedCas
      return overview
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

  const checkCASWarning = useCallback(async (
    casInput: string,
    options?: { force?: boolean },
  ): Promise<void> => {
    await checkCASOverview(casInput, options)
  }, [checkCASOverview])

  return {
    casWarning,
    casOverview,
    casLoading,
    checkCASOverview,
    checkCASWarning,
    clearCASWarning,
    handleCasValueChange,
  }
}
