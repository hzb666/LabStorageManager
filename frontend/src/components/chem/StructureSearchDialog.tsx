import { useCallback, useRef, useState } from 'react'
import type { Ketcher } from 'ketcher-core'
import { Editor } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import 'ketcher-react/dist/index.css'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type {
  StructureQueryFormat,
  SubstructureSearchResponse,
} from '@/api/structureSearchApi'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { getApiErrorMessage } from '@/lib/validationSchemas'

const structServiceProvider = new StandaloneStructServiceProvider()
const DEFAULT_SEARCH_LIMIT = 100

type ExportedStructureQuery = {
  query: string
  format: StructureQueryFormat
}

export interface StructureSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onResults: (payload: SubstructureSearchResponse) => void
}

function normalizeExportedQuery(query: string | undefined): string {
  return query?.trim() ?? ''
}

async function exportStructureQuery(ketcher: Ketcher | null): Promise<ExportedStructureQuery> {
  if (!ketcher) {
    throw new Error('结构编辑器仍在加载，请稍后再试')
  }

  try {
    const smarts = normalizeExportedQuery(await ketcher.getSmarts())
    if (smarts) {
      return { query: smarts, format: 'smarts' }
    }
  } catch {
    // SMARTS 导出失败时继续用 MolBlock，避免让编辑器格式差异阻断查询。
  }

  const molblock = normalizeExportedQuery(await ketcher.getMolfile('v3000'))
  if (!molblock) {
    throw new Error('请先绘制查询结构')
  }
  return { query: molblock, format: 'molblock' }
}

function QueryOption({
  checked,
  label,
  onCheckedChange,
}: Readonly<{
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}>) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  )
}

export function StructureSearchDialog({
  open,
  onOpenChange,
  onResults,
}: Readonly<StructureSearchDialogProps>) {
  const ketcherRef = useRef<Ketcher | null>(null)
  const [useChirality, setUseChirality] = useState(false)
  const [onlyInStock, setOnlyInStock] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEditorInit = useCallback((ketcher: Ketcher) => {
    ketcherRef.current = ketcher
    setEditorReady(true)
  }, [])

  const handleEditorError = useCallback((message: string) => {
    setError(message || '结构编辑器出错')
  }, [])

  const handleSearch = useCallback(async () => {
    setError(null)
    setIsSearching(true)
    try {
      const exported = await exportStructureQuery(ketcherRef.current)
      const payload = await structureSearchAPI.searchSubstructure({
        query: exported.query,
        format: exported.format,
        limit: DEFAULT_SEARCH_LIMIT,
        use_chirality: useChirality,
        only_in_stock: onlyInStock,
      })
      onResults(payload)
      onOpenChange(false)
    } catch (searchError) {
      setError(getApiErrorMessage(searchError, '结构检索失败'))
    } finally {
      setIsSearching(false)
    }
  }, [onOpenChange, onResults, onlyInStock, useChirality])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-6xl max-h-[92vh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <DialogTitle className="mb-4">结构检索</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-4">
              <QueryOption
                checked={useChirality}
                label="区分手性"
                onCheckedChange={setUseChirality}
              />
              <QueryOption
                checked={onlyInStock}
                label="只搜有库存"
                onCheckedChange={setOnlyInStock}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="modern"
                onClick={() => onOpenChange(false)}
              >
                关闭
              </Button>
              <LoadingButton
                type="button"
                onClick={handleSearch}
                isLoading={isSearching}
                loadingText="检索中..."
                disabled={!editorReady}
              >
                子结构检索
              </LoadingButton>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {!editorReady && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              结构编辑器加载中...
            </div>
          )}

          <div className="h-[68vh] min-h-[520px] overflow-hidden rounded-md border border-border bg-background">
            <Editor
              staticResourcesUrl="/"
              structServiceProvider={structServiceProvider}
              disableMacromoleculesEditor
              errorHandler={handleEditorError}
              onInit={handleEditorInit}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default StructureSearchDialog
