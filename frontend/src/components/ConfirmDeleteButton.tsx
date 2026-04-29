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
  const isConfirming = !disabled && confirmingScope === confirmScope

  const handleClick = useCallback(async () => {
    if (disabled || isLoading) {
      return
    }
    if (!isConfirming) {
      setConfirmingScope(confirmScope)
      return
    }

    try {
      await onConfirm()
      setConfirmingScope(null)
    } catch (error) {
      setConfirmingScope(null)
      if (import.meta.env.DEV) {
        console.error('Delete failed:', error)
      }
    }
  }, [confirmScope, disabled, isConfirming, isLoading, onConfirm])

  const handleBlur = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
    onBlur?.(event)
    if (isConfirming && !isLoading) {
      setConfirmingScope(null)
    }
  }, [isConfirming, isLoading, onBlur])

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
        disabled={disabled}
        iconClassName={iconClassName}
        isLoading={isLoading}
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
      disabled={disabled}
      onBlur={handleBlur}
      onClick={() => void handleClick()}
    >
      {content}
    </Button>
  )
}
