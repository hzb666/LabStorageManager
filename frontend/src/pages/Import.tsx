import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { inventoryAPI } from '@/api/client'
import { cn, formatDateTime } from '@/lib/utils'
import { 
  Upload, 
  FileSpreadsheet, 
  Loader2,
  CheckCircle,
  XCircle,
  Download
} from 'lucide-react'

interface ImportTemplate {
  columns: { name: string; required: boolean; description: string }[]
}

interface ImportResult {
  success: boolean
  total_rows: number
  created: number
  errors_count: number
  errors: { row: number; message: string }[] | null
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [template, setTemplate] = useState<ImportTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    loadTemplate()
  }, [])

  const loadTemplate = async () => {
    try {
      const response = await inventoryAPI.getImportTemplate()
      setTemplate(response.data)
    } catch (error) {
      console.error('Failed to load template:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
        alert('请选择 Excel 文件 (.xlsx, .xls)')
        return
      }
      setFile(selectedFile)
      setResult(null)
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
        alert(`导入成功！共 ${response.data.created} 条记录`)
      }
    } catch (error: any) {
      alert(error.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    if (!template) return
    
    // Create a simple template CSV for download (with UTF-8 BOM for Excel compatibility)
    const headers = template.columns.map(c => c.name).join(',')
    const example = template.columns.map(c => {
      if (c.name === 'cas_number') return '64-17-5'
      if (c.name === 'name') return '乙醇'
      if (c.name === 'english_name') return 'Ethanol'
      if (c.name === 'alias') return '酒精'
      if (c.name === 'category') return '有机溶剂'
      if (c.name === 'brand') return 'Sigma'
      if (c.name === 'specification') return '500ml'
      if (c.name === 'initial_quantity') return '10'
      if (c.name === 'is_hazardous') return 'false'
      if (c.name === 'price') return '150.00'
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
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">批量导入库存</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Excel 导入
          </CardTitle>
          <CardDescription>
            上传 Excel 文件批量导入库存记录
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Template Info */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : template && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">模板字段说明</h4>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="w-4 h-4 mr-2" />
                  下载模板
                </Button>
              </div>
              <div className="grid gap-2 text-sm">
                {template.columns.map(col => (
                  <div key={col.name} className="flex items-start gap-3">
                    <span className="w-5 flex-shrink-0">
                      {col.required ? (
                        <span className="text-red-500">*</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </span>
                    <span className="font-mono w-32 flex-shrink-0">{col.name}</span>
                    <span className="text-muted-foreground">{col.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">选择文件</label>
            <div className="flex items-center gap-4">
              <Button
                variant="default"
                onClick={() => document.getElementById('file-input')?.click()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Upload className="w-4 h-4 mr-2" />
                选择 CSV 文件
              </Button>
              <input
                id="file-input"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {file && (
                <span className="text-sm text-muted-foreground truncate max-w-xs">
                  {file.name}
                </span>
              )}
            </div>
          </div>

          {/* Import Button */}
          <Button 
            onClick={handleImport} 
            disabled={!file || importing}
            className="w-full"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                开始导入
              </>
            )}
          </Button>

          {/* Result */}
          {result && (
            <div className={cn(
              'p-4 rounded-lg',
              result.success ? 'bg-green-50' : 'bg-red-50'
            )}>
              <div className="flex items-center gap-2 mb-3">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                <span className={cn(
                  'font-medium',
                  result.success ? 'text-green-700' : 'text-red-700'
                )}>
                  {result.success ? '导入完成' : '导入失败'}
                </span>
              </div>
              <div className="grid gap-1 text-sm">
                <div>总行数: {result.total_rows}</div>
                <div>成功创建: {result.created}</div>
                {result.errors_count > 0 && (
                  <div className="text-red-600">错误数: {result.errors_count}</div>
                )}
              </div>
              {result.errors && result.errors.length > 0 && (
                <div className="mt-3 pt-3 border-t border-red-200">
                  <div className="text-sm font-medium text-red-700 mb-2">错误详情:</div>
                  <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                    {result.errors.slice(0, 20).map((err, i) => (
                      <div key={i} className="text-red-600">
                        行 {err.row}: {err.message}
                      </div>
                    ))}
                    {result.errors.length > 20 && (
                      <div className="text-red-600">
                        ... 还有 {result.errors.length - 20} 条错误
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
