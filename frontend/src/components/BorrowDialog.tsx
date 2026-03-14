import { useEffect, useMemo, useState } from 'react'

import { userAPI, type UserSearchItem } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { LoadingButton } from '@/components/ui/LoadingButton'

interface BorrowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (actualBorrowerId: number) => Promise<void>
  isSubmitting: boolean
}

export function BorrowDialog({ open, onOpenChange, onConfirm, isSubmitting }: Readonly<BorrowDialogProps>) {
  const [keyword, setKeyword] = useState('')
  const [options, setOptions] = useState<UserSearchItem[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserSearchItem | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!open) {
      setKeyword('')
      setOptions([])
      setSelectedUser(null)
      setErrorMessage('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const normalized = keyword.trim()
    if (normalized.length < 2) {
      setOptions([])
      setLoadingOptions(false)
      return
    }

    const timer = setTimeout(async () => {
      setLoadingOptions(true)
      try {
        const response = await userAPI.searchUsers(normalized)
        setOptions(response.data ?? [])
      } catch {
        setOptions([])
      } finally {
        setLoadingOptions(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [keyword, open])

  const showOptions = useMemo(() => {
    const normalized = keyword.trim()
    return normalized.length >= 2 && options.length > 0
  }, [keyword, options])

  const handleInputChange = (value: string) => {
    setKeyword(value)
    setErrorMessage('')
    if (!selectedUser) return
    if (value.trim() !== selectedUser.full_name) {
      setSelectedUser(null)
    }
  }

  const handleSelect = (user: UserSearchItem) => {
    setSelectedUser(user)
    setKeyword(user.full_name)
    setErrorMessage('')
  }

  const handleConfirm = async () => {
    if (!selectedUser || keyword.trim() !== selectedUser?.full_name) {
      setErrorMessage('请从候选列表中选择真实借用人')
      return
    }
    await onConfirm(selectedUser.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>选择实际借用人</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Input
              value={keyword}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="输入姓名或拼音，至少2个字符"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">仅支持选择系统中现有用户，不能自由输入。</p>
          </div>

          {loadingOptions && (
            <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              正在搜索用户...
            </div>
          )}

          {showOptions && !loadingOptions && (
            <div className="max-h-48 overflow-auto rounded-md border border-border">
              {options.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                  onClick={() => handleSelect(user)}
                >
                  {user.full_name}
                </button>
              ))}
            </div>
          )}

          {!!errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="morden" className="flex-1" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <LoadingButton className="flex-1" isLoading={isSubmitting} onClick={handleConfirm}>
              确认借用
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
