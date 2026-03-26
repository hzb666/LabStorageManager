import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
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
import { getApiErrorMessage, normalizeApiErrorMessage } from '@/lib/validationSchemas'
import { cn } from '@/lib/utils'

// 单文件大小上限为 `2 MB`，超限时 toast 会展示当前文件的 MB 大小。
const MAX_FILE_SIZE = 2 * 1024 * 1024

// `.csv /.xlsx /.xls` 是上传白名单，拖拽校验和 `input accept` 共用这组扩展名。
const IMPORT_FILE_EXTENSIONS = ['.csv', '.xlsx', '.xls']

// 结果面板和成功提示都依赖这组字段，错误明细按 `row + error` 展示。
interface ImportResult {
  success: boolean
  total_rows: number
  created: number
  errors_count: number
  errors: { row: number; error: string }[] | null
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

// 拖入时显示高亮态；已有文件时保留弱高亮，提示当前已有待导入文件。
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

// 结果摘要固定展示 `total_rows / created / errors_count`；错误明细最多展示前 50 条。
function ImportResultPanel({
  result,
}: Readonly<{
  result: ImportResult | null
}>) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <FileSpreadsheet className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">上传文件并导入后查看结果</p>
      </div>
    )
  }

  const tone = getResultTone(result.success)

  return (
    <div className="space-y-4">
      <div className={cn('p-4 rounded-lg border', tone.container)}>
        <div className="flex items-center gap-2 mb-3">
          {getResultStatusIcon(result.success)}
          <span className={cn('font-bold', tone.title)}>
            {result.success ? '导入成功' : '导入失败'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{result.total_rows}</div>
            <div className="text-sm text-muted-foreground">总行数</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {result.created}
            </div>
            <div className="text-sm text-muted-foreground">成功创建</div>
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

      {result.errors && result.errors.length > 0 && (
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
                {result.errors.slice(0, 50).map((errorItem, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-4 py-2 text-sm">{errorItem.row}</td>
                    <td className="px-4 py-2 text-destructive text-sm">{errorItem.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.errors.length > 50 && (
              <div className="px-4 py-2 text-center text-sm text-muted-foreground bg-muted/30">
                ... 还有 {result.errors.length - 50} 条错误
              </div>
            )}
          </div>
        </div>
      )}

      {result.success && result.errors_count === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          所有数据已成功导入到库存系统
        </div>
      )}
    </div>
  )
}

// 导入页主组件只负责模板下载、文件上传和结果展示的状态编排。
export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 拖拽与点击选择共用同一套大小和扩展名校验规则。
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

  // 文件来自点击或拖拽都走同一条状态写入链路，并在选中新文件时清空旧导入结果。
  const applySelectedFile = useCallback((selectedFile: File | null) => {
    if (!selectedFile || !validateFile(selectedFile)) {
      return
    }

    setFile(selectedFile)
    setResult(null)
  }, [validateFile])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    applySelectedFile(event.target.files?.[0] ?? null)
  }, [applySelectedFile])

  // `preventDefault()` 允许 drop，并在拖入时切换上传区高亮态。
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  // 拖拽离开时取消高亮，避免上传区残留拖拽态样式。
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }, [])

  // 放下文件后取消高亮，并沿用与点击上传相同的文件选择和校验流程。
  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    applySelectedFile(event.dataTransfer.files?.[0] ?? null)
  }, [applySelectedFile])

  // 清空当前文件、导入结果和原生 file input 值，允许用户重新选择同名文件。
  const handleClearFile = useCallback(() => {
    setFile(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // 导入开始前先清空旧结果；无论成功还是失败都在 `finally` 里复位 loading。
  const handleImport = useCallback(async () => {
    if (!file) {
      return
    }

    setImporting(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await inventoryAPI.importExcel(formData)
      setResult(response.data)
      // 只在后端明确 success 时弹成功提示，避免“部分失败”被误认为完全导入成功。
      if (response.data.success) {
        toast.success(`导入成功！共 ${response.data.created} 条记录`)
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, '导入失败'))
    } finally {
      setImporting(false)
    }
  }, [file])

  // 模板下载接口返回 `429` 时固定提示“2 秒后重试”，其余失败走 Blob / JSON 兼容解析。
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
  // 上传区参数打包后统一透传，减少 JSX 中重复的事件线缆。
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              导入数据
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ImportTemplateSection onDownloadTemplate={handleDownloadTemplate} />
            <ImportFileDropzone
              upload={upload}
            />
            <Button
              onClick={handleImport}
              disabled={!file || importing}
              className="w-full"
              size="lg"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导入中...
                </>
              ) : (
                <>开始导入</>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:row-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {getResultTitleIcon(result)}
              导入结果
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            <ImportResultPanel result={result} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
