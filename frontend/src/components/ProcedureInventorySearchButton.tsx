import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useSubmissionState } from '@/hooks/useSubmissionState'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { saveProcedureInventorySearchResult } from '@/lib/storage/procedureInventorySearchStorage'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/store/useStore'

const PROCEDURE_TEXT_MAX_CHARS = 5000
type ProcedureSubmitStage = 'idle' | 'llm' | 'pubchem'

const SUBMIT_STAGE_LABELS: Record<ProcedureSubmitStage, string> = {
  idle: '',
  llm: 'LLM 解析中',
  pubchem: 'PubChem 查询中',
}

export function ProcedureInventorySearchButton() {
  const currentUser = useAuthStore((store) => store.user)

  if (!currentUser || currentUser.role === 'public') {
    return null
  }

  return <ProcedureSearchAction key={currentUser.id} userId={currentUser.id} />
}

function ProcedureSearchAction({ userId }: Readonly<{ userId: number }>) {
  const state = useProcedureInventorySearch(userId)
  return (
    <>
      <ProcedureSearchTrigger hasResult={state.hasResult} submitting={state.submitting} onOpen={() => state.setOpen(true)} />
      <ProcedureSearchDialog {...state} />
    </>
  )
}

function useProcedureInventorySearch(userId: number) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useSubmissionState()
  const [stage, setStage] = useState<ProcedureSubmitStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pendingResult, setPendingResult] = useState<ProcedureInventorySearchResponse | null>(null)
  const openRef = useRef(false)
  const mounted = useRef(true)
  const charCount = useMemo(() => text.length, [text])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const isCurrentRequest = () => mounted.current && useAuthStore.getState().user?.id === userId

  const showError = (message: string) => {
    setError(message)
    if (!openRef.current) toast.error(message)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isCurrentRequest()) return
    if (nextOpen && pendingResult) {
      setPendingResult(null)
      openResult(pendingResult)
      return
    }
    openRef.current = nextOpen
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
    if (!isCurrentRequest() || !setSubmitting(true)) return
    setError(null)
    try {
      setStage('llm')
      const extraction = await procedureInventorySearchAPI.extract(trimmed)
      if (!isCurrentRequest()) return
      if (extraction.data.rejected) {
        showError(extraction.data.message || '文本不像化学实验步骤')
        return
      }
      setStage('pubchem')
      const response = await procedureInventorySearchAPI.resolve(extraction.data)
      if (!isCurrentRequest()) return
      handleSearchResponse(response.data)
    } catch (requestError) {
      if (isCurrentRequest()) showError(getApiErrorMessage(requestError, '查询失败'))
    } finally {
      if (mounted.current) {
        setSubmitting(false)
        setStage('idle')
      }
    }
  }

  const handleSearchResponse = (result: ProcedureInventorySearchResponse) => {
    if (result.rejected) {
      showError(result.message || '文本不像化学实验步骤')
      return
    }
    if (openRef.current) {
      openResult(result)
    } else {
      setPendingResult(result)
      toast.success('实验步骤查库存已完成，再次点击按钮查看结果')
    }
  }

  const openResult = (result: ProcedureInventorySearchResponse) => {
    const storageId = saveProcedureInventorySearchResult(result, userId)
    const params = new URLSearchParams()
    if (storageId) {
      params.set('procedureSearchId', storageId)
    }
    if (result.cas_query) {
      params.set('search', result.cas_query)
      params.set('field', 'cas_number')
    }
    openRef.current = false
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
    hasResult: pendingResult !== null,
    setOpen: handleOpenChange,
    setText: handleTextChange,
    handleSubmit,
  }
}

function ProcedureSearchTrigger({ hasResult, submitting, onOpen }: Readonly<{
  hasResult: boolean
  submitting: boolean
  onOpen: () => void
}>) {
  let description = hasResult ? '查询已完成，点击查看结果' : '实验步骤查库存'
  if (submitting) description = '正在查询，点击查看进度'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 transition-colors"
          onClick={onOpen}
          aria-label="实验步骤查库存"
          aria-description={description}
        >
          <span className="relative inline-flex">
            <SearchCheck className="size-5" />
            {(submitting || hasResult) && (
              <span
                aria-hidden="true"
                data-query-state={submitting ? 'loading' : 'ready'}
                className={`pointer-events-none absolute -right-1.5 -top-1.5 size-2.5 rounded-full border-2 border-background ${submitting ? 'bg-blue-500' : 'bg-green-600 dark:bg-green-500'}`}
              />
            )}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{description}</p>
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
