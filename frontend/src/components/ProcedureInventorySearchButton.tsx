import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchCheck } from 'lucide-react'

import {
  procedureInventorySearchAPI,
  type ProcedureInventorySearchResponse,
} from '@/api/client'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Textarea } from '@/components/ui/Textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { saveProcedureInventorySearchResult } from '@/lib/storage/procedureInventorySearchStorage'
import { getApiErrorMessage } from '@/lib/validationSchemas'

const PROCEDURE_TEXT_MAX_CHARS = 5000
type ProcedureSubmitStage = 'idle' | 'llm' | 'pubchem' | 'opening'

const SUBMIT_STAGE_LABELS: Record<ProcedureSubmitStage, string> = {
  idle: '',
  llm: 'LLM 解析中',
  pubchem: 'PubChem 查询中',
  opening: '打开库存页',
}

export function ProcedureInventorySearchButton() {
  const state = useProcedureInventorySearch()

  return (
    <>
      <ProcedureSearchTrigger onOpen={() => state.setOpen(true)} />
      <ProcedureSearchDialog {...state} />
    </>
  )
}

function useProcedureInventorySearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<ProcedureSubmitStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const charCount = useMemo(() => text.length, [text])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setError(null)
    }
  }

  const handleTextChange = (value: string) => {
    setText(value)
    setError(null)
  }

  const handleSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('请输入实验步骤')
      return
    }
    if (trimmed.length > PROCEDURE_TEXT_MAX_CHARS) {
      setError(`最多输入 ${PROCEDURE_TEXT_MAX_CHARS} 个字符`)
      return
    }
    await submitProcedureText(trimmed)
  }

  const submitProcedureText = async (trimmed: string) => {
    setSubmitting(true)
    setError(null)
    try {
      setStage('llm')
      const extraction = await procedureInventorySearchAPI.extract(trimmed)
      if (extraction.data.rejected) {
        setError(extraction.data.message || '文本不像化学实验步骤')
        return
      }
      setStage('pubchem')
      const response = await procedureInventorySearchAPI.resolve(extraction.data)
      setStage('opening')
      handleSearchResponse(response.data)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '查询失败'))
    } finally {
      setSubmitting(false)
      setStage('idle')
    }
  }

  const handleSearchResponse = (result: ProcedureInventorySearchResponse) => {
    if (result.rejected) {
      setError(result.message || '文本不像化学实验步骤')
      return
    }
    const storageId = saveProcedureInventorySearchResult(result)
    const params = new URLSearchParams({ procedureSearchId: storageId })
    if (result.cas_query) {
      params.set('search', result.cas_query)
      params.set('field', 'cas_number')
    }
    setOpen(false)
    navigate({ pathname: '/inventory', search: `?${params.toString()}` })
  }

  return {
    open,
    text,
    submitting,
    stage,
    error,
    charCount,
    setOpen: handleOpenChange,
    setText: handleTextChange,
    handleSubmit,
  }
}

function ProcedureSearchTrigger({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 transition-colors"
          onClick={onOpen}
          aria-label="实验步骤查库存"
        >
          <SearchCheck className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>实验步骤查库存</p>
      </TooltipContent>
    </Tooltip>
  )
}

function ProcedureSearchDialog({
  open,
  text,
  submitting,
  stage,
  error,
  charCount,
  setOpen,
  setText,
  handleSubmit,
}: ReturnType<typeof useProcedureInventorySearch>) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl md:w-[760px]">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle className="mb-5">实验步骤查库存</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <ProcedureInput
            value={text}
            disabled={submitting}
            onChange={setText}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-xs text-muted-foreground">
              {charCount}/{PROCEDURE_TEXT_MAX_CHARS}
            </span>
            <div className="flex items-center justify-end gap-3">
              <SubmitStageHint stage={stage} />
              <LoadingButton
                type="button"
                size="lg"
                className="min-w-28"
                onClick={handleSubmit}
                isLoading={submitting}
                loadingText="解析中"
              >
                解析并查询
              </LoadingButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SubmitStageHint({ stage }: Readonly<{ stage: ProcedureSubmitStage }>) {
  if (stage === 'idle') {
    return null
  }
  return (
    <span className="text-sm text-muted-foreground" role="status">
      {SUBMIT_STAGE_LABELS[stage]}
    </span>
  )
}

function ProcedureInput({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: string
  disabled: boolean
  onChange: (value: string) => void
}>) {
  return (
    <div className="space-y-2">
      <label htmlFor="procedure-inventory-text" className="sr-only">
        实验步骤
      </label>
      <Textarea
        id="procedure-inventory-text"
        value={value}
        maxLength={PROCEDURE_TEXT_MAX_CHARS}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-40"
        placeholder="粘贴 SI 中的实验步骤"
      />
    </div>
  )
}
