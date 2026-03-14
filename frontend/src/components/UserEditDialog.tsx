import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { Loader2, Lock, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { cn, getFullImageUrl } from '@/lib/utils'
import { UserUpdateSchema, ChangePasswordWithConfirmSchema } from '@/lib/validationSchemas'
import { UserRoles } from '@/lib/constants'
import type { UserUpdateFormData, ChangePasswordFormData } from '@/lib/validationSchemas'
import { userAdminAPI, authAPI } from '@/api/client'

// 用户类型定义
export interface User {
  id: number
  username: string
  full_name: string | null
  role: 'admin' | 'user' | 'public'
  is_active: boolean
  created_at: string
  avatar_url?: string
}
import { useAuthStore } from '@/store/useStore'
import { useRememberedUser } from '@/hooks/useRememberedUser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { BaseForm } from '@/components/BaseForm'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { AxiosError } from 'axios'
import { getUserEditFormFields, USER_ROLE_OPTIONS } from '@/lib/formConfigs'

export interface UserEditDialogProps {
  /** 弹窗显示状态 */
  open: boolean
  /** 弹窗状态变化 */
  onOpenChange: (open: boolean) => void
  /** 要编辑的用户 */
  user: User | null
  /** 模式：admin 显示角色选择，profile 隐藏 */
  mode: 'admin' | 'profile'
  /** 成功保存回调 */
  onSuccess?: () => void
}

// 允许的图片类型
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE_MB = 5

export function UserEditDialog({
  open,
  onOpenChange,
  user,
  mode,
  onSuccess,
}: UserEditDialogProps) {
  const { user: currentUser, setAuth } = useAuthStore()
  const { rememberedUser, updateRememberedUser } = useRememberedUser()

  // 编辑表单
  const editForm = useForm<UserUpdateFormData>({
    resolver: valibotResolver(UserUpdateSchema),
    defaultValues: {
      username: '',
      full_name: '',
      role: 'user',
    },
  })

  // 密码表单
  const passwordForm = useForm<ChangePasswordFormData>({
    resolver: valibotResolver(ChangePasswordWithConfirmSchema),
    defaultValues: {
      old_password: '',
      new_password: '',
      confirm_password: '',
    },
  })

  // 状态
  const [isEditingPassword, setIsEditingPassword] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)

  // 头像相关状态
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>('')
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState<string>('')
  const [avatarImageLoaded, setAvatarImageLoaded] = useState(false)

  // 初始化表单数据
  useEffect(() => {
    if (open && user) {
      editForm.reset({
        username: user.username,
        full_name: user.full_name || '',
        role: user.role,
      })
      passwordForm.reset({ old_password: '', new_password: '', confirm_password: '' })
      setIsEditingPassword(false)
      setAvatarFile(null)
      setAvatarPreview(user.avatar_url ? getFullImageUrl(user.avatar_url) : '')
      setOriginalAvatarUrl(user.avatar_url ? getFullImageUrl(user.avatar_url) : '')
      setAvatarImageLoaded(false)
    }
  }, [open, user, editForm, passwordForm])

  // 清理 Object URL
  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview)
      }
    }
  }, [avatarPreview])

  // 关闭弹窗时清理状态
  const handleClose = useCallback(() => {
    onOpenChange(false)
    setIsEditingPassword(false)
    setAvatarFile(null)
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    setAvatarPreview('')
    setOriginalAvatarUrl('')
    setAvatarImageLoaded(false)
    editForm.reset()
    passwordForm.reset()
  }, [onOpenChange, avatarPreview, editForm, passwordForm])

  // 头像文件变化处理
  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 文件类型验证
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('仅支持 JPG、PNG、GIF、WebP 格式的图片')
      e.target.value = ''
      return
    }

    // 文件大小验证
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`图片大小不能超过 ${MAX_SIZE_MB}MB`)
      e.target.value = ''
      return
    }

    // 释放旧的 blob URL
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }

    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    setAvatarImageLoaded(true)
    e.target.value = ''
  }, [avatarPreview])

  // 删除头像
  const handleAvatarDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAvatarFile(null)
    setAvatarPreview('')
    // 注意：不清空 originalAvatarUrl，这样保存时才能判断被删除
    const fileInput = document.getElementById('avatar-upload') as HTMLInputElement
    if (fileInput) fileInput.value = ''
  }, [])

  // 保存用户信息
  const handleSave = async () => {
    const isValid = await editForm.trigger()
    if (!isValid) return

    const formData = editForm.getValues()
    if (!user) return

    setEditLoading(true)
    try {
      // 处理头像
      const wasAvatarDeleted = originalAvatarUrl && !avatarPreview && !avatarFile

      if (wasAvatarDeleted) {
        try {
          await userAdminAPI.deleteAvatar(user.id)
        } catch {
          toast.error('头像删除失败')
          setEditLoading(false)
          return
        }
      } else if (avatarFile) {
        setAvatarLoading(true)
        try {
          const response = await userAdminAPI.uploadAvatar(user.id, avatarFile)
          const newAvatarUrl = response.data.avatar_url
          setAvatarPreview(newAvatarUrl)

          // 更新 rememberedUser
          if (rememberedUser && rememberedUser.userId === user.id) {
            updateRememberedUser({ avatar_url: newAvatarUrl })
          }
        } catch (error) {
          const axiosError = error as AxiosError<{ detail?: string }>
          const errorMsg = axiosError.response?.data?.detail || '头像上传失败'
          if (errorMsg.includes('Invalid image type')) {
            toast.error('不支持该图像格式')
          } else if (errorMsg.includes('Image size exceeds')) {
            toast.error('图片大小超过限制')
          } else {
            toast.error(errorMsg)
          }
          setAvatarLoading(false)
          setEditLoading(false)
          return
        }
        setAvatarLoading(false)
      }

      // 更新用户信息
      const response = await userAdminAPI.update(user.id, {
        username: formData.username,
        full_name: formData.full_name,
        role: formData.role,
      })
      const updatedUser = response.data

      // 用户名变更需要重新登录
      if (user.username !== formData.username) {
        toast.success('用户名已更新，请重新登录')
        handleClose()
        localStorage.clear()
        try {
          await authAPI.logout()
        } catch { /* ignore */ }
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
        setEditLoading(false)
        return
      }

      // 更新 rememberedUser
      if (rememberedUser && rememberedUser.userId === user.id) {
        updateRememberedUser({ full_name: formData.full_name })
      }

      // 更新当前用户全局状态
      if (user.id === currentUser?.id && updatedUser) {
        setAuth(updatedUser)
      }

      onSuccess?.()
      handleClose()
      toast.success(mode === 'admin' ? '用户更新成功' : '信息更新成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '更新失败')
    } finally {
      setEditLoading(false)
    }
  }

  // 修改密码
  const handleChangePassword = passwordForm.handleSubmit(async (formData) => {
    const oldPassword = String(formData.old_password || '')
    const newPassword = String(formData.new_password || '')
    const isSelf = user?.id === currentUser?.id
    const isTargetAdmin = user?.role === UserRoles.ADMIN

    // 修改自己或管理员需要原密码
    if (isSelf || isTargetAdmin) {
      if (!oldPassword) {
        passwordForm.setError('old_password', { type: 'manual', message: '请输入原密码' })
        return
      }
    }

    setChangePasswordLoading(true)
    try {
      if (user?.id === currentUser?.id) {
        await authAPI.changePassword(oldPassword, newPassword)
        handleClose()
        toast.success('密码修改成功，请重新登录')
        setTimeout(() => {
          useAuthStore.getState().logout()
          window.location.href = '/login'
        }, 1500)
      } else {
        const adminOldPassword = user?.role === UserRoles.ADMIN ? oldPassword : undefined
        await userAdminAPI.resetPassword(user!.id, newPassword, adminOldPassword)
        setIsEditingPassword(false)
        passwordForm.reset({ old_password: '', new_password: '', confirm_password: '' })
        toast.success('密码重置成功')
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string | { msg: string } }>
      const detail = axiosError.response?.data?.detail
      let errorMsg = ''
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (detail && 'msg' in detail) {
        errorMsg = (detail as { msg: string }).msg
      } else {
        errorMsg = '密码修改失败'
      }

      if (errorMsg === '原密码错误') {
        passwordForm.setError('old_password', { type: 'manual', message: '原密码错误' })
      } else if (errorMsg === '新密码不能与原密码相同') {
        passwordForm.setError('new_password', { type: 'manual', message: '新密码不能与原密码相同' })
      } else if (errorMsg.includes('Password must be at least') || errorMsg.includes('至少')) {
        passwordForm.setError('new_password', { type: 'manual', message: '密码至少6个字符' })
      } else if (errorMsg.includes('password') && errorMsg.includes('match')) {
        passwordForm.setError('confirm_password', { type: 'manual', message: '两次输入的密码不一致' })
      } else {
        toast.error(errorMsg)
      }
    } finally {
      setChangePasswordLoading(false)
    }
  })

  const isTitlePassword = isEditingPassword
  const showRoleSelector = mode === 'admin'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={cn(!isTitlePassword && "mb-4")}>{isTitlePassword ? '修改密码' : (mode === 'admin' ? '编辑用户' : '编辑个人信息')}</DialogTitle>
        </DialogHeader>

        {isEditingPassword ? (
          <>
            <div className="grid space-y-4">
              {/* 原密码 - 修改自己或管理员时显示 */}
              {(user?.id === currentUser?.id || user?.role === UserRoles.ADMIN) && (
                <BaseForm
                  form={passwordForm}
                  fields={[{ name: 'old_password', label: '原密码', type: 'password', required: true, placeholder: '请输入原密码' }]}
                  layout="stack"
                />
              )}
              <BaseForm
                form={passwordForm}
                fields={[
                  { name: 'new_password', label: '新密码', type: 'password', required: true, placeholder: '请输入新密码' },
                  { name: 'confirm_password', label: '确认新密码', type: 'password', required: true, placeholder: '请再次输入新密码' },
                ]}
                layout="stack"
                />
            </div>
            <div key="password-actions" className="flex gap-3 mt-8">
              <Button variant="morden" onClick={() => setIsEditingPassword(false)} size="lg" className="flex-1">
                返回
              </Button>
              <Button onClick={handleChangePassword} disabled={changePasswordLoading} size="lg" className="flex-1">
                {changePasswordLoading ? '处理中...' : '确认修改'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 space-y-2">
              {/* Avatar Upload */}
              <div className="flex flex-col items-center gap-3 mb-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="relative group">
                      <input
                        type="file"
                        id="avatar-upload"
                        accept={ALLOWED_TYPES.join(',')}
                        className="hidden"
                        disabled={avatarLoading}
                        onChange={handleAvatarChange}
                      />
                      <Label htmlFor="avatar-upload" className="cursor-pointer block">
                        <div className="relative h-20 w-20">
                          <Avatar className="h-20 w-20 transition-colors">
                            <AvatarImage
                              src={avatarPreview || undefined}
                              alt={user?.username}
                              className="object-cover"
                              onLoad={() => setAvatarImageLoaded(true)}
                              onError={() => setAvatarImageLoaded(false)}
                            />
                            <AvatarFallback className="text-2xl">
                              {(avatarLoading || !avatarImageLoaded) && avatarPreview ? '...' : user?.username?.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-gray-600/50 dark:bg-gray-800/60 rounded-full border-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer">
                            {avatarLoading ? (
                              <Loader2 className="w-8 h-8 text-white animate-spin" />
                            ) : (
                              <span className="text-white text-3xl drop-shadow-md">+</span>
                            )}
                          </div>
                          {/* Delete button */}
                          {avatarPreview && !avatarLoading && (
                            <button
                              type="button"
                              onClick={handleAvatarDelete}
                              className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/70"
                            >
                              <X className="size-3.5 stroke-3" />
                            </button>
                          )}
                        </div>
                      </Label>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>点击上传头像</p>
                    <p>图片应小于 {MAX_SIZE_MB}MB</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* 使用 BaseForm 统一表单字段 */}
              <BaseForm
                form={editForm}
                fields={getUserEditFormFields()}
                layout="stack"
              />

              {/* 角色选择 - 仅 admin 模式显示 */}
              {showRoleSelector && (
                <div>
                  <Label className="text-base">角色</Label>
                  <RadioGroup
                    value={editForm.watch('role')}
                    onValueChange={(value) => editForm.setValue('role', value as 'admin' | 'user' | 'public')}
                    className="flex gap-4 mt-2"
                  >
                    {USER_ROLE_OPTIONS.map((option) => (
                      <div key={option.value} className="flex items-center space-x-2">
                        <RadioGroupItem value={option.value} id={`edit_role_${option.value}`} />
                        <Label htmlFor={`edit_role_${option.value}`} className="text-base cursor-pointer">{option.label}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </div>

            <div key="edit-actions" className="flex gap-2 mt-6">
              <Button
                variant="morden"
                onClick={() => {
                  setIsEditingPassword(true)
                  passwordForm.reset({ old_password: '', new_password: '', confirm_password: '' })
                }}
                size="lg"
                className="flex-3"
              >
                <Lock className="w-4 h-4 mr-1.5" />
                修改密码
              </Button>
              <Button variant="morden" onClick={handleClose} size="lg" className="flex-1">
                取消
              </Button>
              <LoadingButton onClick={handleSave} isLoading={editLoading} size="lg" className="flex-1">
                保存
              </LoadingButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
