import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'

import { procedureInventorySearchAPI, type ProcedureInventorySearchResponse } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { buildProcedureReportHtml, buildProcedureReportRequest } from '@/lib/procedureReport'
import { copyProcedureReportFonts, copyProcedureReportTheme, initializeProcedureReport } from '@/lib/procedureReportRuntime'
import reportStyles from '@/lib/procedureReport.css?inline'
import { toast } from '@/lib/toast'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { useAuthStore } from '@/store/useStore'

function showReport(preview: Window, html: string) {
  preview.document.open()
  preview.document.write(html)
  preview.document.close()
  copyProcedureReportTheme(document, preview.document)
  copyProcedureReportFonts(document, preview.document)
  initializeProcedureReport(preview)
}

export function ProcedureInventoryReportButton({
  result,
}: Readonly<{ result: ProcedureInventorySearchResponse }>) {
  const [preparing, setPreparing] = useState(false)
  const user = useAuthStore(state => state.user)

  const handleExport = async () => {
    // Open during the click so browsers do not block a popup after the data request.
    const preview = window.open('', '_blank')
    if (!preview) {
      toast.error('请允许弹出窗口后重试导出实验报告')
      return
    }
    preview.opener = null
    preview.document.title = '正在准备实验报告'
    preview.document.body.textContent = '正在准备实验报告，获取库存与分子式…'
    setPreparing(true)
    try {
      const { data } = await procedureInventorySearchAPI.report(buildProcedureReportRequest(result))
      if (preview.closed) return
      const html = buildProcedureReportHtml({
        result,
        report: data,
        author: user?.full_name || user?.username || '',
      }, reportStyles)
      showReport(preview, html)
    } catch (error) {
      if (!preview.closed) preview.close()
      toast.error(getApiErrorMessage(error, '实验报告准备失败，请重试'))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Button type="button" variant="modern" size="lg" className="shrink-0" onClick={handleExport} disabled={preparing} aria-busy={preparing}>
      {preparing ? <Loader2 className="size-4 -ml-0.5 mr-1.5 animate-spin" /> : <FileDown className="size-4 -ml-0.5 mr-1.5" />}
      {preparing ? '准备报告中' : '导出实验报告'}
    </Button>
  )
}
