import React, { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { inventoryAPI } from '@/api/client'
import { toast } from '@/lib/toast'
import { normalizeApiErrorMessage } from '@/lib/validationSchemas'
import { cn } from '@/lib/utils'
import { IMPORT_TEMPLATE_COLUMNS } from '@/lib/constants'
import { 
  Upload, 
  FileSpreadsheet, 
  Loader2,
  CheckCircle,
  XCircle,
  Download,
  File,
  FileText,
  X
} from 'lucide-react'
import { AxiosError } from 'axios'

const MAX_FILE_SIZE = 2 * 1024 * 1024

interface ImportResult {
  success: boolean
  total_rows: number
  created: number
  errors_count: number
  errors: { row: number; error: string }[] | null
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = useCallback((selectedFile: File): boolean => {
    const validExtensions = ['.csv', '.xlsx', '.xls']
    const extension = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase()
    if (!validExtensions.includes(extension)) {
      toast.warning('请选择 CSV 或 Excel 文件 (.csv, .xlsx, .xls)')
      return false
    }
    // 检查文件大小
    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.warning(`文件大小不能超过 2MB，当前文件大小为 ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`)
      return false
    }
    return true
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && validateFile(selectedFile)) {
      setFile(selectedFile)
      setResult(null)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile && validateFile(droppedFile)) {
      setFile(droppedFile)
      setResult(null)
    }
  }, [validateFile])

  const handleClearFile = () => {
    setFile(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleImport = async () => {
    if (!file) return
    
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
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '导入失败'))
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = useCallback(() => {
    // Create a simple template CSV for download (with UTF-8 BOM for Excel compatibility)
    const headers = IMPORT_TEMPLATE_COLUMNS.map(c => c.name).join(',')
    const example = IMPORT_TEMPLATE_COLUMNS.map(c => {
      if (c.name === 'cas_number') return '64-17-5'
      if (c.name === 'name') return '乙醇'
      if (c.name === 'english_name') return 'Ethanol'
      if (c.name === 'alias') return '酒精'
      if (c.name === 'category') return '有机溶剂'
      if (c.name === 'brand') return 'Sigma'
      if (c.name === 'specification') return '500ml'
      if (c.name === 'remaining_quantity') return ''  // optional
      if (c.name === 'storage_location') return '2-6-6-1'
      if (c.name === 'is_hazardous') return ''  // 空白让用户选择填写 true/false/0/1
      if (c.name === 'notes') return ''
      return ''
    }).join(',')
    
    // Add UTF-8 BOM for Excel to recognize Chinese characters
    const BOM = '\uFEFF'
    const csv = BOM + headers + '\n' + example
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // Get file icon based on extension
  const getFileIcon = (fileName: string) => {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
    if (ext === '.csv') return <FileText className="w-8 h-8 text-green-500" />
    return <File className="w-8 h-8 text-blue-500" />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary card-title-placeholder">批量导入库存</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Template Info & Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              导入数据
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Template Download */}
            <div className="rounded-lg my-4">
              <div className="flex items-center justify-between mb-4">
                <h4>模板字段说明（标 <span className="text-destructive">*</span> 为必填项）</h4>
                <Button variant="morden" size="lg" onClick={downloadTemplate}>
                  <Download className="w-4 h-4 mr-2" />
                  下载模板
                </Button>
              </div>
              <div className="space-y-3 text-sm">
                {IMPORT_TEMPLATE_COLUMNS.map(col => (
                  <div key={col.name} className="flex items-start gap-3">
                    <span className="w-3 shrink-0">
                      {col.required ? (
                        <span className="text-destructive">*</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </span>
                    <span className="w-28 shrink-0 text-sm mr-10">{col.name}</span>
                    <span className="text-muted-foreground text-sm">{col.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Drag & Drop Upload Area */}
            <div>
              <label className="block text-base mb-2 mt-10">上传文件</label>
              <div
                className={cn(
                  "relative border-2 border-dashed rounded-lg p-6 transition-all duration-200 cursor-pointer",
                  "hover:border-primary hover:bg-muted/30",
                  isDragging ? "border-primary bg-primary/5" : "border-border",
                  file ? "border-primary/50 bg-primary/5" : ""
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
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
                        <span className="text-sm text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleClearFile()
                          }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground"/>
                      <div>
                        <p className="text-base">
                          点击或拖拽文件到此处上传
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          支持 .csv, .xlsx, .xls 格式
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Import Button */}
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
                <>
                  开始导入
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right Column: Result Display */}
        <Card className="lg:row-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result?.success ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : result && !result.success ? (
                <XCircle className="w-5 h-5 text-destructive" />
              ) : (
                <FileSpreadsheet className="w-5 h-5" />
              )}
              导入结果
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            {result ? (
              <div className="space-y-4">
                {/* Summary Stats */}
                <div className={cn(
                  "p-4 rounded-lg border",
                  result.success ? "bg-green-500/10 border-green-500/20" : "bg-destructive/10 border-destructive/20"
                )}>
                  <div className="flex items-center gap-2 mb-3">
                    {result.success ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    <span className={cn(
                      "font-bold",
                      result.success ? "text-green-700 dark:text-green-300" : "text-destructive"
                    )}>
                      {result.success ? '导入成功' : '导入失败'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">{result.total_rows}</div>
                      <div className="text-sm text-muted-foreground">总行数</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">{result.created}</div>
                      <div className="text-sm text-muted-foreground">成功创建</div>
                    </div>
                    <div>
                      <div className={cn(
                        "text-2xl font-bold",
                        result.errors_count > 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {result.errors_count}
                      </div>
                      <div className="text-sm text-muted-foreground">错误数</div>
                    </div>
                  </div>
                </div>

                {/* Error Details */}
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
                          {result.errors.slice(0, 50).map((err, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-4 py-2 text-sm">{err.row}</td>
                              <td className="px-4 py-2 text-destructive text-sm">{err.error}</td>
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
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <FileSpreadsheet className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm">上传文件并导入后查看结果</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
