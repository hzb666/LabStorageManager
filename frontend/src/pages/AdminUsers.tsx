import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { userAdminAPI } from '@/api/client'
import { toast } from '@/components/ui/toast'
import { useAuthStore } from '@/store/useStore'
import { formatDate, cn } from '@/lib/utils'
import {
  Search,
  Users,
  Loader2,
  Trash2,
  Edit,
  UserCheck,
  X,
  UserPlus
} from 'lucide-react'
import { AxiosError } from 'axios'
import type { PaginationParams } from '@/api/client'

// 用户状态样式
const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  inactive: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

// 角色样式
const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  user: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

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
  const currentUser = useAuthStore((state) => state.user)
  const [data, setData] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Create user modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createData, setCreateData] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'user' as 'admin' | 'user'
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [createLoading, setCreateLoading] = useState(false)

  // Edit user modal
  const [showEditModal, setShowEditModal] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editData, setEditData] = useState({
    full_name: '',
    role: 'user' as 'admin' | 'user'
  })
  const [editLoading, setEditLoading] = useState(false)

  // Delete confirmation
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // 使用 useCallback 优化 loadUsers 函数
  const loadUsers = useCallback(async () => {
    try {
      const params: UserListParams = {}
      if (roleFilter !== 'all') params.role = roleFilter
      if (statusFilter !== 'all') params.is_active = statusFilter === 'active'
      
      const response = await userAdminAPI.list(params)
      setData(response.data || [])
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }, [roleFilter, statusFilter])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  // 表格列定义
  const columns = useMemo(() => [
    columnHelper.accessor('username', {
      header: '用户名',
      size: 120,
      cell: info => <span className="font-medium">{info.getValue()}</span>,
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
        <span className={cn(
          'px-2.5 py-1 text-xs rounded-full font-medium whitespace-nowrap',
          ROLE_STYLES[info.getValue()] || 'bg-muted'
        )}>
          {info.getValue() === 'admin' ? '管理员' : '用户'}
        </span>
      ),
    }),
    columnHelper.accessor('is_active', {
      header: '状态',
      size: 80,
      cell: info => (
        <span className={cn(
          'px-2.5 py-1 text-xs rounded-full font-medium whitespace-nowrap',
          info.getValue() 
            ? STATUS_STYLES.active 
            : STATUS_STYLES.inactive
        )}>
          {info.getValue() ? '启用' : '禁用'}
        </span>
      ),
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
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              title="编辑"
              onClick={(e) => {
                e.stopPropagation()
                openEditModal(user)
              }}
              disabled={isSelf}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            {!user.is_active && !isSelf && (
              <Button
                variant="outline"
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
                variant="outline"
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
    const errors: Record<string, string> = {}
    if (!createData.username.trim()) errors.username = '用户名不能为空'
    if (createData.username.length < 3) errors.username = '用户名至少3个字符'
    if (!createData.password) errors.password = '密码不能为空'
    if (createData.password.length < 6) errors.password = '密码至少6个字符'
    setCreateErrors(errors)
    return Object.keys(errors).length === 0
  }, [createData])

  const handleCreate = async () => {
    if (!validateCreateForm()) return

    setCreateLoading(true)
    try {
      await userAdminAPI.create(createData)
      setShowCreateModal(false)
      setCreateData({ username: '', password: '', full_name: '', role: 'user' })
      loadUsers()
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
    setShowEditModal(true)
  }

  const handleEdit = async () => {
    if (!editUser) return

    setEditLoading(true)
    try {
      await userAdminAPI.update(editUser.id, editData)
      setShowEditModal(false)
      setEditUser(null)
      loadUsers()
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
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
    if (!deleteUser) return

    setDeleteLoading(true)
    try {
      await userAdminAPI.delete(deleteUser.id)
      setShowDeleteModal(false)
      setDeleteUser(null)
      loadUsers()
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
      loadUsers()
      toast.success('用户已启用')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '操作失败')
    }
  }

  // 关闭创建弹窗时清空表单
  const handleCreateModalClose = (open: boolean) => {
    setShowCreateModal(open)
    if (!open) {
      setCreateData({ username: '', password: '', full_name: '', role: 'user' })
      setCreateErrors({})
    }
  }

  return (
    <div className="space-y-6">
      {/* 标题和按钮 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">用户管理</h1>
        <Button onClick={() => setShowCreateModal(true)}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          创建用户
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索用户名、姓名..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm w-full"
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
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-9 px-3 pr-8 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.5rem center',
                backgroundSize: '1rem'
              }}
            >
              <option value="all">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">用户</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 pr-8 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.5rem center',
                backgroundSize: '1rem'
              }}
            >
              <option value="all">全部状态</option>
              <option value="active">已启用</option>
              <option value="inactive">已禁用</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="w-5 h-5" />
            用户列表 <span className="text-muted-foreground font-normal">({data.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* 有数据时在角落显示加载指示器 */}
          {loading && data.length > 0 && (
            <div className="flex justify-end mb-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>加载中...</span>
              </div>
            </div>
          )}
          {loading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无用户数据
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full min-w-[500px]" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b bg-muted/30">
                      {headerGroup.headers.map(header => (
                        <th 
                          key={header.id} 
                          className="h-11 px-3 font-semibold text-foreground text-left align-middle text-sm"
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
                    <tr key={row.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      {row.getVisibleCells().map(cell => (
                        <td 
                          key={cell.id} 
                          className="p-3 align-middle text-sm"
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
      <Dialog open={showCreateModal} onOpenChange={handleCreateModalClose}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">创建用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label htmlFor="create_username" className="mb-1.5 block">
                用户名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_username"
                value={createData.username}
                onChange={(e) => setCreateData({ ...createData, username: e.target.value })}
                placeholder="请输入用户名"
                className={cn("h-9", createErrors.username && 'border-destructive')}
              />
              {createErrors.username && (
                <p className="text-xs text-destructive mt-1">{createErrors.username}</p>
              )}
            </div>
            <div>
              <Label htmlFor="create_password" className="mb-1.5 block">
                密码 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_password"
                type="password"
                value={createData.password}
                onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                placeholder="请输入密码"
                className={cn("h-9", createErrors.password && 'border-destructive')}
              />
              {createErrors.password && (
                <p className="text-xs text-destructive mt-1">{createErrors.password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="create_fullname" className="mb-1.5 block">姓名</Label>
              <Input
                id="create_fullname"
                value={createData.full_name}
                onChange={(e) => setCreateData({ ...createData, full_name: e.target.value })}
                placeholder="请输入姓名"
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="create_role" className="mb-1.5 block">角色</Label>
              <select
                id="create_role"
                value={createData.role}
                onChange={(e) => setCreateData({ ...createData, role: e.target.value as 'admin' | 'user' })}
                className="w-full h-9 px-3 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0.5rem center',
                  backgroundSize: '1rem'
                }}
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="flex gap-2 pt-3 border-t">
              <Button onClick={handleCreate} disabled={createLoading} size="sm">
                {createLoading ? '创建中...' : '创建'}
              </Button>
              <Button variant="outline" onClick={() => handleCreateModalClose(false)} size="sm">
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">编辑用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label htmlFor="edit_username" className="mb-1.5 block">用户名</Label>
              <Input
                id="edit_username"
                value={editUser?.username || ''} 
                disabled 
                className="h-9 bg-muted"
              />
            </div>
            <div>
              <Label htmlFor="edit_fullname" className="mb-1.5 block">姓名</Label>
              <Input
                id="edit_fullname"
                value={editData.full_name}
                onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                placeholder="请输入姓名"
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="edit_role" className="mb-1.5 block">角色</Label>
              <select
                id="edit_role"
                value={editData.role}
                onChange={(e) => setEditData({ ...editData, role: e.target.value as 'admin' | 'user' })}
                className="w-full h-9 px-3 text-sm border rounded-md bg-background appearance-none cursor-pointer hover:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0.5rem center',
                  backgroundSize: '1rem'
                }}
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="flex gap-2 pt-3 border-t">
              <Button onClick={handleEdit} disabled={editLoading} size="sm">
                {editLoading ? '保存中...' : '保存'}
              </Button>
              <Button variant="outline" onClick={() => setShowEditModal(false)} size="sm">
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认禁用用户</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>确定要禁用用户 <strong>{deleteUser?.username}</strong> 吗？</p>
            <p className="text-sm text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} size="sm">
              {deleteLoading ? '处理中...' : '确认禁用'}
            </Button>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} size="sm">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
