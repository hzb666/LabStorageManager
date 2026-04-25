import { useEffect, useMemo, useState } from 'react'

import { userAPI, type UserSearchItem } from '@/api/client'
import { Autocomplete, type AutocompleteOption } from '@/components/ui/AutoComplete'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { FormField } from '@/components/ui/FormField'
import { LoadingButton } from '@/components/ui/LoadingButton'

interface BorrowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (actualBorrowerId: number) => Promise<void>
  isSubmitting: boolean
}

type BorrowDialogContentProps = Pick<BorrowDialogProps, 'onConfirm' | 'isSubmitting'> & {
  onCancel: () => void
}

const MIN_BORROWER_SEARCH_LENGTH = 2

function toBorrowerOptions(users: UserSearchItem[]): AutocompleteOption[] {
  return users.map((user) => ({
    label: user.username ? `${user.full_name}（${user.username}）` : user.full_name,
    value: String(user.id),
  }))
}

function BorrowDialogContent({ onCancel, onConfirm, isSubmitting }: Readonly<BorrowDialogContentProps>) {
  const [keyword, setKeyword] = useState('')
  const [options, setOptions] = useState<UserSearchItem[]>([])
  const [selectedBorrower, setSelectedBorrower] = useState<UserSearchItem | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const normalized = keyword.trim()
    if (normalized.length < MIN_BORROWER_SEARCH_LENGTH) {
      return
    }

    const timer = setTimeout(async () => {
      try {
        const response = await userAPI.searchUsers(normalized)
        setOptions(response.data ?? [])
      } catch {
        setOptions([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [keyword])

  const autocompleteOptions = useMemo(() => toBorrowerOptions(options), [options])

  const handleInputChange = (value: string) => {
    setKeyword(value)
    setSelectedBorrower(null)
    setErrorMessage('')
    if (value.trim().length < MIN_BORROWER_SEARCH_LENGTH) {
      setOptions([])
    }
  }

  const handleSelectBorrower = (option: AutocompleteOption) => {
    const selected = options.find((user) => String(user.id) === option.value) ?? null
    setSelectedBorrower(selected)
    setErrorMessage('')
  }

  const handleConfirm = async () => {
    if (!selectedBorrower) {
      setErrorMessage('请从候选列表中选择真实借用人')
      return
    }

    try {
      await onConfirm(selectedBorrower.id)
    } catch {
      setErrorMessage('借用失败，请重试')
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="mb-3">选择实际借用人</DialogTitle>
      </DialogHeader>

      <div>
        <div>
          <p className="mb-4 text-base text-muted-foreground">仅支持选择系统中现有用户，不能自由输入。</p>
          <FormField label="实际借用人" required error={errorMessage}>
            <Autocomplete
              options={autocompleteOptions}
              value={keyword}
              onChange={handleInputChange}
              onSelect={handleSelectBorrower}
              placeholder="输入姓名或拼音，至少2个字符"
              minSearchLength={MIN_BORROWER_SEARCH_LENGTH}
            />
          </FormField>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="modern"
            size="lg"
            className="w-full"
            onClick={onCancel}
          >
            取消
          </Button>
          <LoadingButton
            type="button"
            size="lg"
            className="w-full"
            isLoading={isSubmitting}
            onClick={handleConfirm}
          >
            确认借用
          </LoadingButton>
        </div>
      </div>
    </DialogContent>
  )
}

export function BorrowDialog({ open, onOpenChange, onConfirm, isSubmitting }: Readonly<BorrowDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <BorrowDialogContent
          isSubmitting={isSubmitting}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  )
}
