import { useCallback, useRef, useState } from 'react'

import { toast } from '@/lib/toast'
import { exportAndDownload } from '@/lib/utils'
import { getApiErrorMessageAsync } from '@/lib/validationSchemas'

type ExportApiCall = Parameters<typeof exportAndDownload>[0]

interface UseExportDownloadOptions {
  apiCall: ExportApiCall
  filePrefix: string
}

/** 统一导出、中文错误提示与重复点击保护。 */
export function useExportDownload({ apiCall, filePrefix }: UseExportDownloadOptions) {
  const [isExporting, setIsExporting] = useState(false)
  const isExportingRef = useRef(false)

  const handleExport = useCallback(async () => {
    if (isExportingRef.current) return

    isExportingRef.current = true
    setIsExporting(true)
    try {
      await exportAndDownload(apiCall, filePrefix)
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, '导出失败'))
    } finally {
      isExportingRef.current = false
      setIsExporting(false)
    }
  }, [apiCall, filePrefix])

  return { handleExport, isExporting }
}
