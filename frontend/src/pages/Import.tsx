import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import {
  CheckCircle,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'

import { inventoryAPI } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { IMPORT_TEMPLATE_COLUMNS } from '@/lib/constants'
import { toast } from '@/lib/toast'
import { refreshDashboardAfterMutation } from '@/lib/dashboardUtils'
import { getApiErrorMessage, normalizeApiErrorMessage } from '@/lib/validationSchemas'
import { cn } from '@/lib/utils'

// 单文件大小上限为 `2 MB`，超限时 toast 会展示当前文件的 MB 大小。
const MAX_FILE_SIZE = 2 * 1024 * 1024

// `.csv /.xlsx /.xls` 是上传白名单，拖拽校验和 `input accept` 共用这组扩展名。
const IMPORT_FILE_EXTENSIONS = ['.csv', '.xlsx', '.xls']

// 结果面板和成功提示都依赖这组字段，错误明细按 `row + error` 展示。
type ImportStage = 'preview' | 'confirm'

interface ImportPreviewItem {
  row: number
  cas_number: string
  name: string
  brand: string | null
  category: string | null
  specification: string
  remaining_quantity: number | null
  storage_location: string | null
}

interface ImportResult {
  success: boolean
  total_rows: number
  valid_rows: number
  created: number
  errors_count: number
  errors: { row: number; error: string }[] | null
  preview_items?: ImportPreviewItem[] | null
  preview_token?: string | null
}

// 模板下载失败时接口可能返回 Blob；若文本可解析为 JSON，则优先读取其中的 `detail`。
async function parseBlobErrorDetail(error: AxiosError): Promise<unknown> {
  const responseData = error.response?.data
  if (!responseData) {
    return undefined
  }

  if (responseData instanceof Blob) {
    try {
      const text = await responseData.text()
      if (!text.trim()) {
        return undefined
      }
      const parsed = JSON.parse(text) as { detail?: unknown }
      return parsed.detail ?? text
    } catch {
      return undefined
    }
  }

  if (typeof responseData === 'object' && responseData !== null && 'detail' in responseData) {
    return (responseData as { detail?: unknown }).detail
  }

  return undefined
}

// 拖拽上传和点击上传共用同一份扩展名白名单。
function isSupportedImportFile(fileName: string): boolean {
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  return IMPORT_FILE_EXTENSIONS.includes(extension)
}

function formatFileSize(fileSize: number): string {
  return `${(fileSize / 1024).toFixed(1)} KB`
}

function getFileIcon(fileName: string): ReactNode {
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  if (extension === '.csv') {
    return <FileText className="w-8 h-8 text-green-500" />
  }
  return <File className="w-8 h-8 text-blue-500" />
}

function getResultTitleIcon(result: ImportResult | null): ReactNode {
  if (result?.success) {
    return <CheckCircle className="w-5 h-5 text-green-500" />
  }
  if (result && !result.success) {
    return <XCircle className="w-5 h-5 text-destructive" />
  }
  return <FileSpreadsheet className="w-5 h-5" />
}

function getResultStatusIcon(success: boolean): ReactNode {
  if (success) {
    return <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
  }
  return <XCircle className="w-5 h-5 text-destructive" />
}

function getResultTone(success: boolean): { container: string; title: string } {
  if (success) {
    return {
      container: 'bg-green-500/10 border-green-500/20',
      title: 'text-green-700 dark:text-green-300',
    }
  }

  return {
    container: 'bg-destructive/10 border-destructive/20',
    title: 'text-destructive',
  }
}

function getResultHeadline(stage: ImportStage, success: boolean): string {
  if (stage === 'preview') {
    return success ? '预览通过' : '预览发现错误'
  }
  return success ? '导入成功' : '导入失败'
}

function getResultPrimaryLabel(stage: ImportStage): string {
  return stage === 'preview' ? '可导入' : '成功创建'
}

function getResultPrimaryValue(stage: ImportStage, result: ImportResult): number {
  return stage === 'preview' ? result.valid_rows : result.created
}

function getEmptyResultHint(stage: ImportStage | null): string {
  if (stage === 'preview') {
    return '文件已完成预览校验，可在这里查看结果'
  }
  if (stage === 'confirm') {
    return '文件已完成导入，可在这里查看结果'
  }
  return '上传文件并先执行预览校验'
}

function buildImportFormData(file: File): FormData {
  const formData = new FormData()
  formData.append('file', file)
  return formData
}

// 拖入时显示高亮态；已有文件时显示弱高亮，提示当前存在待导入文件。
function getDropzoneClassName(isDragging: boolean, hasFile: boolean): string {
  return cn(
    'relative border-2 border-dashed rounded-lg p-6 transition-all duration-200 cursor-pointer',
    'hover:border-primary hover:bg-muted/30',
    isDragging ? 'border-primary bg-primary/5' : 'border-border',
    hasFile ? 'border-primary/50 bg-primary/5' : ''
  )
}

function downloadTemplateBlob(data: BlobPart): void {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = globalThis.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'inventory_import_template.xlsx'
  document.body.appendChild(anchor)
  anchor.click()
  globalThis.URL.revokeObjectURL(url)
  document.body.removeChild(anchor)
}

function ImportTemplateSection({
  onDownloadTemplate,
}: Readonly<{
  onDownloadTemplate: () => void
}>) {
  return (
    <div className="rounded-lg my-4">
      <div className="flex items-center justify-between mb-4">
        <h4>模板字段说明（标 <span className="text-destructive">*</span> 为必填项）</h4>
        <Button variant="modern" size="lg" onClick={onDownloadTemplate}>
          <Download className="w-4 h-4 mr-2" />
          下载模板
        </Button>
      </div>
      <div className="space-y-3 text-sm">
        {IMPORT_TEMPLATE_COLUMNS.map((column) => (
          <div key={column.name} className="flex items-start gap-3">
            <span className="w-3 shrink-0">
              {column.required ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </span>
            <span className="w-28 shrink-0 text-sm mr-10">{column.name}</span>
            <span className="text-muted-foreground text-sm">{column.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImportFileDropzone({
  upload,
}: Readonly<{
  upload: {
    file: File | null
    isDragging: boolean
    fileInputRef: React.RefObject<HTMLInputElement | null>
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
    onDragOver: (event: DragEvent<HTMLDivElement>) => void
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
    onOpenFileDialog: () => void
    onClearFile: () => void
  }
}>) {
  const {
    file,
    isDragging,
    fileInputRef,
    onFileChange,
    onDragOver,
    onDragLeave,
    onDrop,
    onOpenFileDialog,
    onClearFile,
  } = upload

  return (
    <div>
      <label className="block text-base mb-2 mt-10">上传文件</label>
      <div
        className={getDropzoneClassName(isDragging, Boolean(file))}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onOpenFileDialog}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={onFileChange}
          className="hidden"
        />
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          {file ? (
            <>
              <div className="flex items-center gap-2">
                {getFileIcon(file.name)}
                <span className="text-sm truncate max-w-50">{file.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{formatFileSize(file.size)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation()
                    onClearFile()
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-muted-foreground" />
              <div>
                <p className="text-base">点击或拖拽文件到此处上传</p>
                <p className="text-sm text-muted-foreground mt-1">支持 .csv, .xlsx, .xls 格式</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ImportPreviewTable({
  previewItems,
}: Readonly<{
  previewItems: ImportPreviewItem[]
}>) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted/50 px-4 py-2 border-b">
        <h4>待入库预览</h4>
      </div>
      <div className="max-h-75 overflow-y-auto">
        <table className="w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left text-muted-foreground w-16">行号</th>
              <th className="px-4 py-2 text-left text-muted-foreground">CAS</th>
              <th className="px-4 py-2 text-left text-muted-foreground">名称</th>
              <th className="px-4 py-2 text-left text-muted-foreground">品牌</th>
              <th className="px-4 py-2 text-left text-muted-foreground">分类</th>
              <th className="px-4 py-2 text-left text-muted-foreground">剩余量</th>
              <th className="px-4 py-2 text-left text-muted-foreground">规格</th>
              <th className="px-4 py-2 text-left text-muted-foreground">位置</th>
            </tr>
          </thead>
          <tbody>
            {previewItems.slice(0, 50).map((item) => (
              <tr key={`${item.row}-${item.cas_number}-${item.name}`} className="border-t border-border">
                <td className="px-4 py-2 text-sm">{item.row}</td>
                <td className="px-4 py-2 text-sm">{item.cas_number}</td>
                <td className="px-4 py-2 text-sm">{item.name}</td>
                <td className="px-4 py-2 text-sm">{item.brand ?? '-'}</td>
                <td className="px-4 py-2 text-sm">{item.category ?? '-'}</td>
                <td className="px-4 py-2 text-sm">{item.remaining_quantity ?? '-'}</td>
                <td className="px-4 py-2 text-sm">{item.specification}</td>
                <td className="px-4 py-2 text-sm">{item.storage_location ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {previewItems.length > 50 && (
          <div className="px-4 py-2 text-center text-sm text-muted-foreground bg-muted/30">
            ... 还有 {previewItems.length - 50} 条待入库记录
          </div>
        )}
      </div>
    </div>
  )
}

function ImportErrorPanel({
  errors,
}: Readonly<{
  errors: { row: number; error: string }[]
}>) {
  return (
    <div className="border border-destructive rounded-lg overflow-hidden">
      <div className="bg-destructive/10 px-4 py-2 border-b border-destructive/20">
        <h4 className="text-destructive">错误详情</h4>
      </div>
      <div className="max-h-75 overflow-y-auto">
        <table className="w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left text-muted-foreground w-16">行号</th>
              <th className="px-4 py-2 text-left text-muted-foreground">错误信息</th>
            </tr>
          </thead>
          <tbody>
            {errors.slice(0, 50).map((errorItem, index) => (
              <tr key={index} className="border-t border-border">
                <td className="px-4 py-2 text-sm">{errorItem.row}</td>
                <td className="px-4 py-2 text-destructive text-sm">{errorItem.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.length > 50 && (
          <div className="px-4 py-2 text-center text-sm text-muted-foreground bg-muted/30">
            ... 还有 {errors.length - 50} 条错误
          </div>
        )}
      </div>
    </div>
  )
}

function ImportResultMessage({
  stage,
  success,
  errorsCount,
}: Readonly<{
  stage: ImportStage
  success: boolean
  errorsCount: number
}>) {
  if (!success || errorsCount !== 0) {
    return null
  }

  if (stage === 'preview') {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        预览校验通过，请点击“确认导入”后再真正写入库存
      </div>
    )
  }

  return (
    <div className="text-center py-4 text-sm text-muted-foreground">
      所有数据已成功导入到库存系统
    </div>
  )
}

// 结果摘要固定展示 `total_rows / created / errors_count`；错误明细最多展示前 50 条。
function ImportResultPanel({
  result,
  stage,
}: Readonly<{
  result: ImportResult | null
  stage: ImportStage | null
}>) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <FileSpreadsheet className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">{getEmptyResultHint(stage)}</p>
      </div>
    )
  }

  const resolvedStage = stage ?? 'preview'
  const tone = getResultTone(result.success)

  return (
    <div className="space-y-4">
      <div className={cn('p-4 rounded-lg border', tone.container)}>
        <div className="flex items-center gap-2 mb-3">
          {getResultStatusIcon(result.success)}
          <span className={cn('font-bold', tone.title)}>
            {getResultHeadline(resolvedStage, result.success)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{result.total_rows}</div>
            <div className="text-sm text-muted-foreground">总行数</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {getResultPrimaryValue(resolvedStage, result)}
            </div>
            <div className="text-sm text-muted-foreground">{getResultPrimaryLabel(resolvedStage)}</div>
          </div>
          <div>
            <div
              className={cn(
                'text-2xl font-bold',
                result.errors_count > 0 ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {result.errors_count}
            </div>
            <div className="text-sm text-muted-foreground">错误数</div>
          </div>
        </div>
      </div>

      {resolvedStage === 'preview' && result.preview_items && result.preview_items.length > 0 && (
        <ImportPreviewTable previewItems={result.preview_items} />
      )}

      {result.errors && result.errors.length > 0 && (
        <ImportErrorPanel errors={result.errors} />
      )}

      <ImportResultMessage
        stage={resolvedStage}
        success={result.success}
        errorsCount={result.errors_count}
      />
    </div>
  )
}

function ImportActionButtons({
  file,
  submittingStage,
  resultStage,
  resultSuccess,
  onPreview,
  onConfirm,
}: Readonly<{
  file: File | null
  submittingStage: ImportStage | null
  resultStage: ImportStage | null
  resultSuccess: boolean
  onPreview: () => void
  onConfirm: () => void
}>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Button
        onClick={onPreview}
        disabled={!file || submittingStage !== null}
        className="w-full"
        size="lg"
      >
        {submittingStage === 'preview' ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            预览校验中...
          </>
        ) : (
          <>先预览校验</>
        )}
      </Button>
      <Button
        onClick={onConfirm}
        disabled={!file || submittingStage !== null || resultStage !== 'preview' || !resultSuccess}
        className="w-full"
        size="lg"
      >
        {submittingStage === 'confirm' ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            导入中...
          </>
        ) : (
          <>确认导入</>
        )}
      </Button>
    </div>
  )
}

function ImportFormCard({
  upload,
  onDownloadTemplate,
  file,
  submittingStage,
  resultStage,
  resultSuccess,
  onPreview,
  onConfirm,
}: Readonly<{
  upload: {
    file: File | null
    isDragging: boolean
    fileInputRef: React.RefObject<HTMLInputElement | null>
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
    onDragOver: (event: DragEvent<HTMLDivElement>) => void
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
    onOpenFileDialog: () => void
    onClearFile: () => void
  }
  onDownloadTemplate: () => void
  file: File | null
  submittingStage: ImportStage | null
  resultStage: ImportStage | null
  resultSuccess: boolean
  onPreview: () => void
  onConfirm: () => void
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5" />
          导入数据
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ImportTemplateSection onDownloadTemplate={onDownloadTemplate} />
        <ImportFileDropzone upload={upload} />
        <ImportActionButtons
          file={file}
          submittingStage={submittingStage}
          resultStage={resultStage}
          resultSuccess={resultSuccess}
          onPreview={onPreview}
          onConfirm={onConfirm}
        />
      </CardContent>
    </Card>
  )
}

function ImportResultCard({
  result,
  resultStage,
}: Readonly<{
  result: ImportResult | null
  resultStage: ImportStage | null
}>) {
  return (
    <Card className="lg:row-span-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {getResultTitleIcon(result)}
          {resultStage === 'preview' ? '预览结果' : '导入结果'}
        </CardTitle>
      </CardHeader>
      <CardContent className="mt-4">
        <ImportResultPanel result={result} stage={resultStage} />
      </CardContent>
    </Card>
  )
}

// 导入页主组件只负责模板下载、文件上传和结果展示的状态编排。
export function ImportPage() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [submittingStage, setSubmittingStage] = useState<ImportStage | null>(null)
  const [resultStage, setResultStage] = useState<ImportStage | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [previewToken, setPreviewToken] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = useCallback((selectedFile: File): boolean => {
    if (!isSupportedImportFile(selectedFile.name)) {
      toast.warning('请选择 CSV 或 Excel 文件 (.csv, .xlsx, .xls)')
      return false
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.warning(
        `文件大小不能超过 2MB，当前文件大小为 ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`
      )
      return false
    }

    return true
  }, [])

  const applySelectedFile = useCallback((selectedFile: File | null) => {
    if (!selectedFile || !validateFile(selectedFile)) {
      return
    }

    setFile(selectedFile)
    setResult(null)
    setResultStage(null)
    setPreviewToken(null)
  }, [validateFile])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    applySelectedFile(event.target.files?.[0] ?? null)
  }, [applySelectedFile])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    applySelectedFile(event.dataTransfer.files?.[0] ?? null)
  }, [applySelectedFile])

  const handleClearFile = useCallback(() => {
    setFile(null)
    setResult(null)
    setResultStage(null)
    setPreviewToken(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handlePreview = useCallback(async () => {
    if (!file) {
      return
    }

    setSubmittingStage('preview')
    setResult(null)
    setResultStage(null)
    setPreviewToken(null)

    try {
      const response = await inventoryAPI.previewImportExcel(buildImportFormData(file))
      setResult(response.data)
      setResultStage('preview')
      setPreviewToken(response.data.preview_token ?? null)
      if (response.data.success) {
        toast.success(`预览通过，可导入 ${response.data.valid_rows} 条记录`)
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, '预览校验失败'))
    } finally {
      setSubmittingStage(null)
    }
  }, [file])

  const handleConfirmImport = useCallback(async () => {
    if (!previewToken) {
      return
    }

    setSubmittingStage('confirm')

    try {
      const response = await inventoryAPI.confirmImportExcel(previewToken)
      setResult(response.data)
      setResultStage('confirm')
      setPreviewToken(null)
      if (response.data.success) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['inventory'] }),
          refreshDashboardAfterMutation(queryClient),
        ])
        toast.success(`导入成功！共 ${response.data.created} 条记录`)
      }
    } catch (error) {
      setPreviewToken(null)
      toast.error(getApiErrorMessage(error, '导入失败'))
    } finally {
      setSubmittingStage(null)
    }
  }, [previewToken, queryClient])

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const response = await inventoryAPI.downloadTemplate()
      downloadTemplateBlob(response.data)
    } catch (error) {
      const axiosError = error as AxiosError
      if (axiosError.response?.status === 429) {
        toast.error('下载过于频繁，请 2 秒后重试')
        return
      }

      const errorDetail = await parseBlobErrorDetail(axiosError)
      toast.error(normalizeApiErrorMessage(errorDetail, '下载模板失败'))
    }
  }, [])

  const upload = {
    file,
    isDragging,
    fileInputRef,
    onFileChange: handleFileChange,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onOpenFileDialog: () => fileInputRef.current?.click(),
    onClearFile: handleClearFile,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">批量导入库存</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ImportFormCard
          upload={upload}
          onDownloadTemplate={handleDownloadTemplate}
          file={file}
          submittingStage={submittingStage}
          resultStage={resultStage}
          resultSuccess={Boolean(result?.success) && Boolean(previewToken)}
          onPreview={handlePreview}
          onConfirm={handleConfirmImport}
        />
        <ImportResultCard result={result} resultStage={resultStage} />
      </div>
    </div>
  )
}
