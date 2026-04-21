import { useCallback, useEffect, useRef, useState } from 'react'
import type { Ketcher } from 'ketcher-core'
import { Loader2 } from 'lucide-react'

import { structureSearchAPI } from '@/api/structureSearchApi'
import type { CompoundStructureCache } from '@/api/structureSearchApi'
import { KetcherEditor } from '@/components/chem/KetcherEditor'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { getApiErrorMessage } from '@/lib/validationSchemas'

const EDITOR_MOUNT_DELAY_MS = 80

export interface StructureManualEditDialogProps {
  open: boolean
  casNumber: string
  initialMolblock?: string | null
  onOpenChange: (open: boolean) => void
  onSaved: (cache: CompoundStructureCache) => void
}

function normalizeMolblock(value: string | undefined): string {
  return value?.trim() ?? ''
}

function useDeferredEditorMount(open: boolean, mountKey: string): boolean {
  const [mountedKey, setMountedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined

    let timeoutId: number | undefined
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => setMountedKey(mountKey), EDITOR_MOUNT_DELAY_MS)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [mountKey, open])

  return open && mountedKey === mountKey
}

export function StructureManualEditDialog({
  open,
  casNumber,
  initialMolblock,
  onOpenChange,
  onSaved,
}: Readonly<StructureManualEditDialogProps>) {
  const ketcherRef = useRef<Ketcher | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shouldMountEditor = useDeferredEditorMount(open, casNumber)

  const handleEditorInit = useCallback((ketcher: Ketcher) => {
    ketcherRef.current = ketcher
    setError(null)
    setEditorReady(true)
    if (initialMolblock) {
      ketcher.setMolecule(initialMolblock).catch(() => {
        setError('已有结构载入失败，请重新绘制')
      })
    }
  }, [initialMolblock])

  const handleEditorError = useCallback((message: string) => {
    setError(message || '结构编辑器出错')
  }, [])

  const handleSave = useCallback(async () => {
    setError(null)
    setSaving(true)
    try {
      const molblock = normalizeMolblock(await ketcherRef.current?.getMolfile('v3000'))
      if (!molblock) {
        setError('请先绘制结构')
        return
      }
      const cache = await structureSearchAPI.saveManualStructure(casNumber, { molblock })
      onSaved(cache)
      onOpenChange(false)
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, '结构保存失败'))
    } finally {
      setSaving(false)
    }
  }, [casNumber, onOpenChange, onSaved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-6xl max-h-[92vh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <DialogTitle className="mb-4">手工确认结构</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-muted-foreground">CAS：{casNumber}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="modern"
                size="lg"
                className="min-w-24 text-center"
                onClick={() => onOpenChange(false)}
              >
                关闭
              </Button>
              <LoadingButton
                type="button"
                size="lg"
                className="min-w-32 text-center"
                onClick={handleSave}
                isLoading={saving}
                loadingText="保存中..."
                disabled={!editorReady || !shouldMountEditor}
              >
                保存结构
              </LoadingButton>
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="relative h-[68vh] min-h-[520px] overflow-hidden rounded-md border border-border bg-background">
            {(!shouldMountEditor || !editorReady) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" />
                结构编辑器加载中...
              </div>
            )}
            {shouldMountEditor && (
              <KetcherEditor
                key={`manual-structure-editor-${casNumber}`}
                onError={handleEditorError}
                onInit={handleEditorInit}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default StructureManualEditDialog
