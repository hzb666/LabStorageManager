import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'

interface EditDialogActionsProps {
  mode: 'edit' | 'add'
  onCancel: () => void
  onDelete?: () => void | Promise<void>
  deleteConfirm?: boolean
  submitLabelEdit: string
  submitLabelAdd: string
  isSubmitting: boolean
  leadingContent?: ReactNode
}

export function EditDialogActions({
  mode,
  onCancel,
  onDelete,
  deleteConfirm = false,
  submitLabelEdit,
  submitLabelAdd,
  isSubmitting,
  leadingContent,
}: Readonly<EditDialogActionsProps>) {
  const showDelete = mode === 'edit' && onDelete

  return (
    <div className="flex flex-wrap justify-between items-center gap-3 mt-8">
      {showDelete ? (
        <div className="flex items-center gap-2 order-1">
          <Button variant="destructive" size="lg" type="button" onClick={() => void onDelete()}>
            <Trash2 className="w-4 h-4 mr-1.5" />
            {deleteConfirm ? '确认删除' : '删除'}
          </Button>
        </div>
      ) : leadingContent ? (
        <div className="order-1">{leadingContent}</div>
      ) : null}

      <div className="flex gap-2 order-2 ml-auto">
        <Button variant="modern" size="lg" type="button" onClick={onCancel}>
          取消
        </Button>
        <LoadingButton type="submit" size="lg" isLoading={isSubmitting}>
          {mode === 'edit' ? submitLabelEdit : submitLabelAdd}
        </LoadingButton>
      </div>
    </div>
  )
}
