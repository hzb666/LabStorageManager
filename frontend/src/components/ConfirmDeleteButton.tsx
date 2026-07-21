import React, { useCallback, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { LoadingButton, type LoadingButtonProps } from '@/components/ui/LoadingButton'

interface ConfirmDeleteButtonProps
  extends Omit<LoadingButtonProps, 'children' | 'onBlur' | 'onClick'> {
  confirmLabel?: ReactNode
  idleLabel?: ReactNode
  icon?: ReactNode
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  onConfirm: () => void | Promise<void>
  resetKey?: unknown
}

function getDefaultDeleteIcon() {
  return <Trash2 className="w-4 h-4 mr-1.5" />
}

export function ConfirmDeleteButton({
  confirmLabel = '确认删除',
  disabled,
  icon = getDefaultDeleteIcon(),
  iconClassName,
  idleLabel = '删除',
  isLoading,
  loadingText,
  onBlur,
  onConfirm,
  resetKey,
  ...buttonProps
}: Readonly<ConfirmDeleteButtonProps>) {
  const confirmScope = resetKey ?? onConfirm
  const [confirmingScope, setConfirmingScope] = useState<unknown>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const isConfirming = !disabled && confirmingScope === confirmScope
  const isBusy = Boolean(isLoading) || isDeleting

  const handleClick = useCallback(async () => {
    if (disabled || isBusy) {
      return
    }
    if (!isConfirming) {
      // confirmScope may be the onConfirm function; wrap it so React stores the
      // function value instead of invoking it as a state updater.
      setConfirmingScope(() => confirmScope)
      return
    }

    setIsDeleting(true)
    try {
      await onConfirm()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Delete failed:', error)
      }
    } finally {
      setConfirmingScope(null)
      setIsDeleting(false)
    }
  }, [confirmScope, disabled, isBusy, isConfirming, onConfirm])

  const handleBlur = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
    onBlur?.(event)
    if (isConfirming && !isBusy) {
      setConfirmingScope(null)
    }
  }, [isBusy, isConfirming, onBlur])

  const content = (
    <>
      {icon}
      {isConfirming ? confirmLabel : idleLabel}
    </>
  )

  if (isLoading !== undefined || loadingText !== undefined || iconClassName !== undefined) {
    return (
      <LoadingButton
        {...buttonProps}
        disabled={disabled || isDeleting}
        iconClassName={iconClassName}
        isLoading={isBusy}
        loadingText={loadingText}
        onBlur={handleBlur}
        onClick={() => void handleClick()}
      >
        {content}
      </LoadingButton>
    )
  }

  return (
    <Button
      {...buttonProps}
      disabled={disabled || isDeleting}
      onBlur={handleBlur}
      onClick={() => void handleClick()}
    >
      {content}
    </Button>
  )
}
