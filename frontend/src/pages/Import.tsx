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

/**
 * 定义单个导入文件允许的最大体积。
 * 存在原因：上传校验和错误提示都依赖同一阈值，集中定义能避免魔法数字散落。
 */
const MAX_FILE_SIZE = 2 * 1024 * 1024

/**
 * 定义当前导入页支持的文件扩展名白名单。
 * 存在原因：点击上传和拖拽上传需要共用同一套文件类型判断规则。
 */
const IMPORT_FILE_EXTENSIONS = ['.csv', '.xlsx', '.xls']

/**
 * 描述导入接口返回的结果结构。
 * 存在原因：结果面板、成功提示和错误列表都依赖这一响应形态，单独定义便于约束使用方。
 */
interface ImportResult {
  success: boolean
  total_rows: number
  created: number
  errors_count: number
  errors: { row: number; error: string }[] | null
}

/**
 * 描述模板说明区组件的入参。
 * 存在原因：模板下载动作被拆到独立展示块中，需要显式声明它只依赖下载回调。
 */
type ImportTemplateSectionProps = Readonly<{
  onDownloadTemplate: () => void
}>

/**
 * 描述文件拖拽上传区组件的入参。
 * 存在原因：上传区同时承载文件展示、拖拽交互和清空动作，独立接口能避免页面主体混乱。
 */
type ImportFileDropzoneProps = Readonly<{
  file: File | null
  isDragging: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onOpenFileDialog: () => void
  onClearFile: () => void
}>

/**
 * 描述导入结果面板组件的入参。
 * 存在原因：结果区只依赖导入结果本身，单独建模后能保持展示组件职责单一。
 */
type ImportResultPanelProps = Readonly<{
  result: ImportResult | null
}>

/**
 * 解析模板下载接口返回的 Blob 错误体。
 * 存在原因：模板下载接口返回二进制流，失败时需要兼容 Blob/JSON 两种错误形态。
 */
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

/**
 * 校验导入文件后缀是否合法。
 * 存在原因：上传入口支持拖拽与点击两种来源，需要共用同一份后缀规则。
 */
function isSupportedImportFile(fileName: string): boolean {
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  return IMPORT_FILE_EXTENSIONS.includes(extension)
}

/**
 * 格式化文件大小文本。
 * 存在原因：上传区和已选文件摘要都需要展示统一的大小文案。
 */
function formatFileSize(fileSize: number): string {
  return `${(fileSize / 1024).toFixed(1)} KB`
}

/**
 * 根据文件扩展名返回对应图标。
 * 存在原因：让上传区的文件摘要逻辑与页面主体解耦。
 */
function getFileIcon(fileName: string): ReactNode {
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  if (extension === '.csv') {
    return <FileText className="w-8 h-8 text-green-500" />
  }
  return <File className="w-8 h-8 text-blue-500" />
}

/**
 * 根据导入结果生成标题图标。
 * 存在原因：避免在结果面板头部继续堆叠嵌套条件渲染。
 */
function getResultTitleIcon(result: ImportResult | null): ReactNode {
  if (result?.success) {
    return <CheckCircle className="w-5 h-5 text-green-500" />
  }
  if (result && !result.success) {
    return <XCircle className="w-5 h-5 text-destructive" />
  }
  return <FileSpreadsheet className="w-5 h-5" />
}

/**
 * 根据导入结果生成状态区图标。
 * 存在原因：让结果摘要区只依赖单一状态入口，而不是重复判断 success。
 */
function getResultStatusIcon(success: boolean): ReactNode {
  if (success) {
    return <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
  }
  return <XCircle className="w-5 h-5 text-destructive" />
}

/**
 * 根据导入结果生成摘要区配色。
 * 存在原因：结果展示区同时复用背景、边框和标题颜色，集中封装更稳。
 */
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

/**
 * 根据拖拽态和选中文件态计算上传区样式。
 * 存在原因：把上传区的样式分支从 JSX 中提取成命名逻辑，降低主页面复杂度。
 */
function getDropzoneClassName(isDragging: boolean, hasFile: boolean): string {
  return cn(
    'relative border-2 border-dashed rounded-lg p-6 transition-all duration-200 cursor-pointer',
    'hover:border-primary hover:bg-muted/30',
    isDragging ? 'border-primary bg-primary/5' : 'border-border',
    hasFile ? 'border-primary/50 bg-primary/5' : ''
  )
}

/**
 * 触发模板文件下载。
 * 存在原因：模板下载和库存导入都在当前页面，下载逻辑独立后更易复用错误处理。
 */
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

/**
 * 渲染模板字段说明区。
 * 存在原因：模板说明是稳定展示块，独立后能显著缩短页面主组件长度。
 */
function ImportTemplateSection({
  onDownloadTemplate,
}: ImportTemplateSectionProps) {
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

/**
 * 渲染文件上传区。
 * 存在原因：拖拽上传区内部的交互与展示较多，拆出后页面主体只保留状态编排。
 */
function ImportFileDropzone({
  file,
  isDragging,
  fileInputRef,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenFileDialog,
  onClearFile,
}: ImportFileDropzoneProps) {
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

/**
 * 渲染导入结果区。
 * 存在原因：结果展示包含摘要、错误表格和空态，独立后能避免主页面继续膨胀。
 */
function ImportResultPanel({
  result,
}: ImportResultPanelProps) {
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

/**
 * 组织库存批量导入页面的模板下载、文件上传和结果展示。
 * 存在原因：当前页面是导入热点页，主组件应退回到状态编排层而不是承载全部展示细节。
 */
export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * 校验文件类型与大小，并保持原有错误提示文案。
   * 存在原因：拖拽与点击选择都会进入这条链路，需要统一校验规则。
   */
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

  /**
   * 接管文件选择后的状态写入。
   * 存在原因：无论来自文件选择框还是拖拽，都需要统一重置旧导入结果。
   */
  const applySelectedFile = useCallback((selectedFile: File | null) => {
    if (!selectedFile || !validateFile(selectedFile)) {
      return
    }

    setFile(selectedFile)
    setResult(null)
  }, [validateFile])

  /**
   * 处理文件选择框变更。
   * 存在原因：把 DOM 事件和文件处理逻辑解耦，降低主组件复杂度。
   */
  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    applySelectedFile(event.target.files?.[0] ?? null)
  }, [applySelectedFile])

  /**
   * 处理拖拽进入上传区。
   * 存在原因：保持拖拽高亮态与浏览器默认行为隔离。
   */
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  /**
   * 处理拖拽离开上传区。
   * 存在原因：让拖拽态在离开时及时回退，避免残留高亮样式。
   */
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }, [])

  /**
   * 处理拖拽释放文件。
   * 存在原因：拖拽上传和点击上传共享同一套文件写入逻辑。
   */
  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    applySelectedFile(event.dataTransfer.files?.[0] ?? null)
  }, [applySelectedFile])

  /**
   * 清空当前文件选择和导入结果。
   * 存在原因：允许用户在不刷新页面的前提下重新选择文件。
   */
  const handleClearFile = useCallback(() => {
    setFile(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  /**
   * 提交当前文件到导入接口。
   * 存在原因：导入成功与失败都需要统一复位 loading 态并保留原有提示。
   */
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
      if (response.data.success) {
        toast.success(`导入成功！共 ${response.data.created} 条记录`)
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, '导入失败'))
    } finally {
      setImporting(false)
    }
  }, [file])

  /**
   * 下载导入模板，并兼容 Blob 错误体解析。
   * 存在原因：模板下载是导入页的核心辅助动作，需要单独管理频控与错误提示。
   */
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
              file={file}
              isDragging={isDragging}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onOpenFileDialog={() => fileInputRef.current?.click()}
              onClearFile={handleClearFile}
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
