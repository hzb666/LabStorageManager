import React, { useState, useMemo, useCallback } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { userAdminAPI, authAPI } from '@/api/client'
import { toast } from '@/components/ui/Toast'
import { useAuthStore } from '@/store/useStore'
import { formatDate, cn } from '@/lib/utils'
import useDialogState from '@/hooks/useDialogState'
import * as v from 'valibot'
import { UserCreateSchema, ChangePasswordWithConfirmSchema } from '@/lib/validationSchemas'
import {
  Search,
  Users,
  Loader2,
  Trash2,
  Edit,
  UserCheck,
  X,
  UserPlus,
  Lock
} from 'lucide-react'
import { AxiosError } from 'axios'
import type { PaginationParams } from '@/api/client'

import { StatusBadge } from '@/components/ui/StatusBadge'

// 用户状态样式 - 使用 StatusBadge 组件

// 角色样式 - 使用 StatusBadge 组件

interface UserListParams extends PaginationParams {
  role?: string
  is_active?: boolean
}

interface User {
  id: number
  username: string
  full_name: string | null
  role: 'admin' | 'user'
  is_active: boolean
  created_at: string
}

const columnHelper = createColumnHelper<User>()

export function AdminUsersPage() {
  const { user: currentUser, setAuth } = useAuthStore()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // 使用 React Query 获取用户列表，配合 keepPreviousData 避免闪烁
  const { data: userData = [], isLoading } = useQuery({
    queryKey: ['adminUsers', roleFilter, statusFilter],
    queryFn: async () => {
      const params: UserListParams = {}
      if (roleFilter !== 'all') params.role = roleFilter
      if (statusFilter !== 'all') params.is_active = statusFilter === 'active'
      const response = await userAdminAPI.list(params)
      return response.data || []
    },
    placeholderData: keepPreviousData,
  })

  // 为了兼容性，保留 data 变量
  const data = userData

  // 刷新数据函数
  const refetchUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
  }, [queryClient])

  // Dialog state - 使用 useDialogState 管理 create/edit/delete 对话框
  const [dialogState, setDialogState] = useDialogState<"create" | "edit" | "delete">()

  // Create user modal
  const [createData, setCreateData] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'user' as 'admin' | 'user'
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [createLoading, setCreateLoading] = useState(false)

  // Edit user modal
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editData, setEditData] = useState({
    full_name: '',
    role: 'user' as 'admin' | 'user'
  })
  const [editLoading, setEditLoading] = useState(false)

  // Delete confirmation
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Change password modal state
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [changePasswordData, setChangePasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: ''
  })
  const [changePasswordErrors, setChangePasswordErrors] = useState<Record<string, string>>({})
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)

  // 表格列定义
  const columns = useMemo(() => [
    columnHelper.accessor('username', {
      header: '用户名',
      size: 120,
      cell: info => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('full_name', {
      header: '姓名',
      size: 120,
      cell: info => info.getValue() || '-',
    }),
    columnHelper.accessor('role', {
      header: '角色',
      size: 80,
      cell: info => (
        <StatusBadge status={info.getValue()} />
      ),
    }),
    columnHelper.accessor('is_active', {
      header: '状态',
      size: 80,
      cell: info => {
        const isActive = info.getValue()
        return <StatusBadge status={isActive ? 'active' : 'inactive'} />
      },
    }),
    columnHelper.accessor('created_at', {
      header: '创建时间',
      size: 150,
      cell: info => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 120,
      cell: info => {
        const user = info.row.original
        const isSelf = user.id === currentUser?.id
        
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="morden"
              size="sm"
              className="h-8 w-8 p-0"
              title="编辑"
              onClick={(e) => {
                e.stopPropagation()
                openEditModal(user)
              }}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            {!user.is_active && !isSelf && (
              <Button
                variant="morden"
                size="sm"
                className="h-8 w-8 p-0 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                title="激活"
                onClick={(e) => {
                  e.stopPropagation()
                  handleActivate(user.id)
                }}
              >
                <UserCheck className="w-3.5 h-3.5" />
              </Button>
            )}
            {user.is_active && !isSelf && (
              <Button
                variant="morden"
                size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="禁用"
                onClick={(e) => {
                  e.stopPropagation()
                  openDeleteModal(user)
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [currentUser])

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      globalFilter,
    },
  })

  // Create user handlers
  const validateCreateForm = useCallback((): boolean => {
    try {
      v.parse(UserCreateSchema, {
        username: createData.username,
        password: createData.password,
        full_name: createData.full_name,
        role: createData.role
      })
      setCreateErrors({})
      return true
    } catch (error) {
      if (error instanceof v.ValiError) {
        const errors: Record<string, string> = {}
        for (const issue of error.issues) {
          const field = issue.path?.[0]?.key
          if (field) {
            errors[field] = issue.message
          }
        }
        setCreateErrors(errors)
      }
      return false
    }
  }, [createData])

  const handleCreate = async () => {
    if (!validateCreateForm()) return

    setCreateLoading(true)
    try {
      await userAdminAPI.create(createData)
      setDialogState(null)
      setCreateData({ username: '', password: '', full_name: '', role: 'user' })
      refetchUsers()
      toast.success('用户创建成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '创建失败')
    } finally {
      setCreateLoading(false)
    }
  }

  // Edit user handlers
  const openEditModal = (user: User) => {
    setEditUser(user)
    setEditData({ full_name: user.full_name || '', role: user.role })
    setDialogState('edit')
  }

  const handleEdit = async () => {
    if (!editUser) return

    setEditLoading(true)
    try {
      const response = await userAdminAPI.update(editUser.id, editData)
      const updatedUser = response.data
      
      // 如果修改的是当前登录用户，需要更新全局状态
      if (editUser.id === currentUser?.id && updatedUser) {
        setAuth(updatedUser)
      }
      
      setDialogState(null)
      setEditUser(null)
      refetchUsers()
      toast.success('用户更新成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '更新失败')
    } finally {
      setEditLoading(false)
    }
  }

  // Delete/Deactivate handlers
  const openDeleteModal = (user: User) => {
    setDeleteUser(user)
    setDialogState('delete')
  }

  const handleDelete = async () => {
    if (!deleteUser) return

    setDeleteLoading(true)
    try {
      await userAdminAPI.delete(deleteUser.id)
      setDialogState(null)
      setDeleteUser(null)
      refetchUsers()
      toast.success('用户已禁用')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    } finally {
      setDeleteLoading(false)
    }
  }

  // Activate user
  const handleActivate = async (userId: number) => {
    try {
      await userAdminAPI.activate(userId)
      refetchUsers()
      toast.success('用户已启用')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  // Change password handlers
  const validateChangePasswordForm = useCallback((): boolean => {
    try {
      v.parse(ChangePasswordWithConfirmSchema, {
        old_password: changePasswordData.old_password,
        new_password: changePasswordData.new_password,
        confirm_password: changePasswordData.confirm_password
      })
      setChangePasswordErrors({})
      return true
    } catch (error) {
      if (error instanceof v.ValiError) {
        const errors: Record<string, string> = {}
        for (const issue of error.issues) {
          const field = issue.path?.[0]?.key
          if (field) {
            errors[field] = issue.message
          }
        }
        setChangePasswordErrors(errors)
      }
      return false
    }
  }, [changePasswordData])

  const handleChangePassword = async () => {
    if (!validateChangePasswordForm()) return

    setChangePasswordLoading(true)
    try {
      await authAPI.changePassword(changePasswordData.old_password, changePasswordData.new_password)
      setShowChangePasswordModal(false)
      setChangePasswordData({ old_password: '', new_password: '', confirm_password: '' })
      toast.success('密码修改成功，请重新登录')
      // 可选：自动登出
      setTimeout(() => {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }, 1500)
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '密码修改失败')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  // 关闭创建弹窗时清空表单
  const handleCreateModalClose = (open: boolean) => {
    setDialogState(open ? 'create' : null)
    if (!open) {
      setCreateData({ username: '', password: '', full_name: '', role: 'user' })
      setCreateErrors({})
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">用户管理</h1>
        <Button onClick={() => setDialogState('create')} size="lg">
          <UserPlus className="w-4 h-4 mr-1.5" />
          创建用户
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索用户名、姓名..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 pr-8 h-10 text-base w-full"
          />
          {globalFilter && (
            <button
              onClick={() => setGlobalFilter('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value)}>
          <SelectTrigger className="w-30 min-h-10">
            <SelectValue placeholder="全部角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
            <SelectItem value="user">用户</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
          <SelectTrigger className="w-30 min-h-10">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">已启用</SelectItem>
            <SelectItem value="inactive">已禁用</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
            <Users className="w-5 h-5" />
            用户列表 <span className="text-muted-foreground font-normal">(&thinsp;{data.length}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无用户数据
            </div>
          ) : (
            <div className="px-6 rounded-md overflow-auto">
              <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b-2 border-border">
                      {headerGroup.headers.map(header => (
                        <th 
                          key={header.id} 
                          className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
                          style={{ width: header.getSize() }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map(row => (
                    <tr key={row.id} className="border-b border-border hover:bg-muted/30">
                      {row.getVisibleCells().map(cell => (
                        <td 
                          key={cell.id} 
                          className="p-3 align-middle text-base"
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Modal */}
      <Dialog open={dialogState === 'create'} onOpenChange={handleCreateModalClose}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>创建用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="create_username" className={LABEL_STYLES.base}>
                用户名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_username"
                value={createData.username}
                onChange={(e) => setCreateData({ ...createData, username: e.target.value })}
                placeholder="请输入用户名"
                className={cn(INPUT_STYLES.lg, createErrors.username && 'border-destructive')}
              />
              {createErrors.username && (
                <p className="text-sm text-destructive mt-1">{createErrors.username}</p>
              )}
            </div>
            <div>
              <Label htmlFor="create_password" className={LABEL_STYLES.base}>
                密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_password"
                type="password"
                value={createData.password}
                onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                placeholder="请输入密码"
                className={cn(INPUT_STYLES.lg, createErrors.password && 'border-destructive')}
              />
              {createErrors.password && (
                <p className="text-sm text-destructive mt-1">{createErrors.password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="create_fullname" className={LABEL_STYLES.base}>
                姓名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_fullname"
                value={createData.full_name}
                onChange={(e) => setCreateData({ ...createData, full_name: e.target.value })}
                placeholder="请输入姓名"
                className={cn(INPUT_STYLES.lg, createErrors.full_name && 'border-destructive')}
              />
              {createErrors.full_name && (
                <p className="text-sm text-destructive mt-1">{createErrors.full_name}</p>
              )}
            </div>
            <div>
              <Label className={LABEL_STYLES.base}>角色</Label>
              <RadioGroup
                value={createData.role}
                onValueChange={(value) => setCreateData({ ...createData, role: value as 'admin' | 'user' })}
                className="flex gap-4 mt-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="user" id="create_role_user" />
                  <Label htmlFor="create_role_user" className="text-base cursor-pointer">用户</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="admin" id="create_role_admin" />
                  <Label htmlFor="create_role_admin" className="text-base cursor-pointer">管理员</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
              <Button variant="morden" onClick={() => handleCreateModalClose(false)} size="lg" className="flex-1">
                取消
              </Button>
              <Button onClick={handleCreate} disabled={createLoading} size="lg" className="flex-1">
                {createLoading ? '创建中...' : '创建'}
              </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Edit User Modal */}
      <Dialog open={dialogState === 'edit'} onOpenChange={(open) => setDialogState(open ? 'edit' : null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 space-y-2">
            <div>
              <Label htmlFor="edit_username" className={LABEL_STYLES.base}>用户名</Label>
              <Input
                id="edit_username"
                value={editUser?.username || ''} 
                readOnly 
                className={cn(INPUT_STYLES.lg, "bg-muted")}
              />
            </div>
            <div>
              <Label htmlFor="edit_fullname" className={LABEL_STYLES.base}>姓名</Label>
              <Input
                id="edit_fullname"
                value={editData.full_name}
                onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                placeholder="请输入姓名"
                className={INPUT_STYLES.lg}
              />
            </div>
            <div>
              <Label className={LABEL_STYLES.base}>角色</Label>
              <RadioGroup
                value={editData.role}
                onValueChange={(value) => setEditData({ ...editData, role: value as 'admin' | 'user' })}
                className="flex gap-4 mt-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="user" id="edit_role_user" />
                  <Label htmlFor="edit_role_user" className="text-base cursor-pointer">用户</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="admin" id="edit_role_admin" />
                  <Label htmlFor="edit_role_admin" className="text-base cursor-pointer">管理员</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
              {editUser?.id === currentUser?.id && (
                <Button 
                  variant="morden" 
                  onClick={() => setShowChangePasswordModal(true)} 
                  size="lg"
                  className="flex-1"
                >
                  <Lock className="w-4 h-4 mr-1.5" />
                  修改密码
                </Button>
              )}
              <Button onClick={handleEdit} disabled={editLoading} size="lg">
                {editLoading ? '保存中...' : '保存'}
              </Button>
              <Button variant="morden" onClick={() => setDialogState(null)} size="lg" className="text-base">
                取消
              </Button>
            </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={dialogState === 'delete'} onOpenChange={(open) => setDialogState(open ? 'delete' : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认禁用用户</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>确定要禁用用户 <strong>{deleteUser?.username}</strong> 吗？</p>
            <p className="text-sm text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} size="lg">
              {deleteLoading ? '处理中...' : '确认禁用'}
            </Button>
            <Button variant="morden" onClick={() => setDialogState(null)} size="lg" className="text-base">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Modal */}
      <Dialog open={showChangePasswordModal} onOpenChange={setShowChangePasswordModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">修改密码</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label htmlFor="old_password" className={LABEL_STYLES.base}>
                原密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="old_password"
                type="password"
                value={changePasswordData.old_password}
                onChange={(e) => setChangePasswordData({ ...changePasswordData, old_password: e.target.value })}
                placeholder="请输入原密码"
                className={cn(INPUT_STYLES.lg, changePasswordErrors.old_password && 'border-destructive')}
              />
              {changePasswordErrors.old_password && (
                <p className="text-sm text-destructive mt-1">{changePasswordErrors.old_password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="new_password" className={LABEL_STYLES.base}>
                新密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new_password"
                type="password"
                value={changePasswordData.new_password}
                onChange={(e) => setChangePasswordData({ ...changePasswordData, new_password: e.target.value })}
                placeholder="请输入新密码"
                className={cn(INPUT_STYLES.lg, changePasswordErrors.new_password && 'border-destructive')}
              />
              {changePasswordErrors.new_password && (
                <p className="text-sm text-destructive mt-1">{changePasswordErrors.new_password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirm_password" className={LABEL_STYLES.base}>
                确认新密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="confirm_password"
                type="password"
                value={changePasswordData.confirm_password}
                onChange={(e) => setChangePasswordData({ ...changePasswordData, confirm_password: e.target.value })}
                placeholder="请再次输入新密码"
                className={cn(INPUT_STYLES.lg, changePasswordErrors.confirm_password && 'border-destructive')}
              />
              {changePasswordErrors.confirm_password && (
                <p className="text-sm text-destructive mt-1">{changePasswordErrors.confirm_password}</p>
              )}
            </div>
            <div className="flex gap-2 pt-3 border-t">
              <Button onClick={handleChangePassword} disabled={changePasswordLoading} size="lg" className="flex-1">
                {changePasswordLoading ? '处理中...' : '确认修改'}
              </Button>
              <Button variant="morden" onClick={() => setShowChangePasswordModal(false)} size="lg" className="flex-1">
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
