import React, { useState, useEffect, useMemo } from 'react'
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
  Plus,
  Trash2,
  Edit,
  UserCheck
} from 'lucide-react'
import { AxiosError } from 'axios'
import type { PaginationParams } from '@/api/client'

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

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
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
  }

  // Reload when filters change
  useEffect(() => {
    loadUsers()
  }, [roleFilter, statusFilter])

  const columns = useMemo(() => [
    columnHelper.accessor('username', {
      header: '用户名',
      cell: info => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('full_name', {
      header: '姓名',
      cell: info => info.getValue() || '-',
    }),
    columnHelper.accessor('role', {
      header: '角色',
      cell: info => (
        <span className={cn(
          'px-2 py-1 text-xs rounded-full',
          info.getValue() === 'admin' 
            ? 'bg-purple-100 text-purple-800' 
            : 'bg-blue-100 text-blue-800'
        )}>
          {info.getValue() === 'admin' ? '管理员' : '用户'}
        </span>
      ),
    }),
    columnHelper.accessor('is_active', {
      header: '状态',
      cell: info => (
        <span className={cn(
          'px-2 py-1 text-xs rounded-full',
          info.getValue() 
            ? 'bg-green-100 text-green-800' 
            : 'bg-red-100 text-red-800'
        )}>
          {info.getValue() ? '启用' : '禁用'}
        </span>
      ),
    }),
    columnHelper.accessor('created_at', {
      header: '创建时间',
      cell: info => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      cell: info => {
        const user = info.row.original
        const isSelf = user.id === currentUser?.id
        
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openEditModal(user)}
              disabled={isSelf}
            >
              <Edit className="w-3 h-3" />
            </Button>
            {!user.is_active && !isSelf && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleActivate(user.id)}
                className="text-green-600"
              >
                <UserCheck className="w-3 h-3" />
              </Button>
            )}
            {user.is_active && !isSelf && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDeleteModal(user)}
                className="text-red-600"
              >
                <Trash2 className="w-3 h-3" />
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
  const validateCreateForm = (): boolean => {
    const errors: Record<string, string> = {}
    if (!createData.username.trim()) errors.username = '用户名不能为空'
    if (createData.username.length < 3) errors.username = '用户名至少3个字符'
    if (!createData.password) errors.password = '密码不能为空'
    if (createData.password.length < 6) errors.password = '密码至少6个字符'
    setCreateErrors(errors)
    return Object.keys(errors).length === 0
  }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold title-placeholder">用户管理</h1>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          创建用户
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索用户名、姓名..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-10 px-3 border rounded-md bg-background"
            >
              <option value="all">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">用户</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 border rounded-md bg-background"
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            用户列表 ({data.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无用户数据
            </div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b bg-muted/50">
                      {headerGroup.headers.map(header => (
                        <th key={header.id} className="h-10 px-4 text-left align-middle font-medium">
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
                    <tr key={row.id} className="border-b hover:bg-muted/50">
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="p-4 align-middle">
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
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>创建用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                用户名 <span className="text-red-500">*</span>
              </label>
              <Input
                value={createData.username}
                onChange={(e) => setCreateData({ ...createData, username: e.target.value })}
                placeholder="请输入用户名"
                className={createErrors.username ? 'border-red-500' : ''}
              />
              {createErrors.username && (
                <p className="text-sm text-red-500 mt-1">{createErrors.username}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                密码 <span className="text-red-500">*</span>
              </label>
              <Input
                type="password"
                value={createData.password}
                onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                placeholder="请输入密码"
                className={createErrors.password ? 'border-red-500' : ''}
              />
              {createErrors.password && (
                <p className="text-sm text-red-500 mt-1">{createErrors.password}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">姓名</label>
              <Input
                value={createData.full_name}
                onChange={(e) => setCreateData({ ...createData, full_name: e.target.value })}
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">角色</label>
              <select
                value={createData.role}
                onChange={(e) => setCreateData({ ...createData, role: e.target.value as 'admin' | 'user' })}
                className="w-full h-10 px-3 border rounded-md bg-background"
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={handleCreate} disabled={createLoading}>
                {createLoading ? '创建中...' : '创建'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">用户名</label>
              <Input value={editUser?.username || ''} disabled className="bg-muted" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">姓名</label>
              <Input
                value={editData.full_name}
                onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">角色</label>
              <select
                value={editData.role}
                onChange={(e) => setEditData({ ...editData, role: e.target.value as 'admin' | 'user' })}
                className="w-full h-10 px-3 border rounded-md bg-background"
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={handleEdit} disabled={editLoading}>
                {editLoading ? '保存中...' : '保存'}
              </Button>
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
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
          <div className="flex gap-3">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? '处理中...' : '确认禁用'}
            </Button>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
