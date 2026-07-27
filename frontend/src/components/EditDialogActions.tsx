import type { ReactNode } from 'react'

import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'

interface EditDialogActionsProps {
  mode: 'edit' | 'add'
  onCancel: () => void
  onDelete?: () => void | Promise<void>
  submitLabelEdit: string
  submitLabelAdd: string
  isSubmitting: boolean
  disableSubmit?: boolean
  leadingContent?: ReactNode
}

export function EditDialogActions({
  mode,
  onCancel,
  onDelete,
  submitLabelEdit,
  submitLabelAdd,
  isSubmitting,
  disableSubmit = false,
  leadingContent,
}: Readonly<EditDialogActionsProps>) {
  const showDelete = mode === 'edit' && onDelete
  let leadingArea: ReactNode = null

  if (showDelete || leadingContent) {
    leadingArea = (
      <div className="flex items-center gap-2 order-1">
        {showDelete ? (
          <ConfirmDeleteButton variant="destructive" size="lg" type="button" onConfirm={onDelete} />
        ) : null}
        {leadingContent}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap justify-between items-center gap-3 mt-8">
      {leadingArea}

      <div className="flex gap-2 order-2 ml-auto">
        <Button variant="modern" size="lg" type="button" onClick={onCancel}>
          取消
        </Button>
        <LoadingButton type="submit" size="lg" isLoading={isSubmitting} disabled={disableSubmit}>
          {mode === 'edit' ? submitLabelEdit : submitLabelAdd}
        </LoadingButton>
      </div>
    </div>
  )
}
