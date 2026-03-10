import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table'
import type { SortingState, ColumnDef } from '@tanstack/react-table'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { userAdminAPI } from '@/api/client'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/store/useStore'
import { formatDate } from '@/lib/utils'
import useDialogState from '@/hooks/useDialogState'
import { BaseForm, type FieldSchema } from '@/components/BaseForm'
import { UserEditDialog, type User } from '@/components/UserEditDialog'
import {
  UserCreateSchema,
  type UserCreateFormData,
} from '@/lib/validationSchemas'
import {
  Search,
  Users,
  Loader2,
  Trash2,
  Edit,
  UserCheck,
  X,
  UserPlus,
  FileText,
} from 'lucide-react'
import { AxiosError } from 'axios'
import type { PaginationParams } from '@/api/client'

import { Pagination, PaginationInfo } from '@/components/ui/Pagination'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { TableEmptyState } from '@/components/ui/TableFilters'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import { getAdminUsersTableColumns } from '@/lib/tableConfigs'

interface UserListParams extends PaginationParams {
  role?: string
  is_active?: boolean
  username?: string
}

const columnHelper = createColumnHelper<User>()

export function AdminUsersPage() {
  const { user: currentUser } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  // 防抖搜索
  const [debouncedFilter, setDebouncedFilter] = useState('')

  // 防抖 effect - 300ms 延迟
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilter(globalFilter)
    }, 300)
    return () => clearTimeout(timer)
  }, [globalFilter])

  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // 当搜索词、角色过滤、状态过滤发生变化时，重置回第一页
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedFilter, roleFilter, statusFilter])

  // 使用单一 React Query 获取用户列表及总数，配合 keepPreviousData 避免闪烁
  const { data: queryResult, isLoading } = useQuery({
    queryKey: ['adminUsers', roleFilter, statusFilter, debouncedFilter, currentPage, pageSize],
    queryFn: async () => {
      const params: UserListParams = {
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
      }
      if (roleFilter !== 'all') params.role = roleFilter
      if (statusFilter !== 'all') params.is_active = statusFilter === 'active'
      if (debouncedFilter) params.username = debouncedFilter

      const response = await userAdminAPI.list(params)
      return {
        data: response.data.data || [],
        total: response.data.total || 0
      }
    },
    placeholderData: keepPreviousData,
  })

  // 派生出 userData 和 total
  const userData = queryResult?.data || []
  const total = queryResult?.total || 0
  const totalPages = Math.ceil(total / pageSize)

  // 判断是否有筛选条件
  const hasFilter = Boolean(debouncedFilter || roleFilter !== 'all' || statusFilter !== 'active')

  // 将当前管理员账户置顶显示
  const data = useMemo(() => {
    if (!currentUser) return userData
    const currentUserId = currentUser.id
    const currentUserIndex = userData.findIndex((user: User) => user.id === currentUserId)
    if (currentUserIndex === -1 || currentUserIndex === 0) return userData

    // 将当前用户移到数组最前面
    const result = [...userData]
    const [currentUserItem] = result.splice(currentUserIndex, 1)
    result.unshift(currentUserItem)
    return result
  }, [userData, currentUser])

  // 刷新数据函数
  const refetchUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
  }, [queryClient])

  // 分页变化处理
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1) // 重置到第一页
  }

  // Dialog state - 使用 useDialogState 管理 create/edit/delete 对话框
  const [dialogState, setDialogState] = useDialogState<"create" | "edit" | "delete">()

  // 创建用户表单 - 使用 useForm + BaseForm
  const createForm = useForm<UserCreateFormData>({
    resolver: valibotResolver(UserCreateSchema),
    defaultValues: {
      username: '',
      password: '',
      full_name: '',
      role: 'user',
    },
  })
  const { reset: resetCreateForm } = createForm
  const [createLoading, setCreateLoading] = useState(false)

  // 创建用户表单字段配置（不包含角色，角色单独用 RadioGroup 渲染）
  const createFormFields: FieldSchema<UserCreateFormData>[] = [
    { name: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
    { name: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' },
    { name: 'full_name', label: '姓名', type: 'input', required: true, placeholder: '请输入姓名' },
  ]

  // Edit user modal
  const [editUser, setEditUser] = useState<User | null>(null)

  // Delete confirmation
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // 表格列定义 - 使用 tableConfigs 中的基础列 + 页面特定的操作列
  const columns = useMemo(() => {
    const baseColumns = getAdminUsersTableColumns()

    // 追加页面特定的操作列
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 200,
      cell: info => {
        const user = info.row.original
        const isSelf = user.id === currentUser?.id

        return (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={isSelf}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isSelf) {
                      return // 显示tooltip即可
                    }
                    openEditModal(user)
                  }}
                >
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isSelf ? '请到账户管理页面修改自己的信息' : '编辑'}</p>
              </TooltipContent>
            </Tooltip>
            {/* 查看日志按钮 - 所有用户都可以查看日志 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0 text-indigo-600 hover:text-indigo-700
           dark:text-indigo-400 dark:hover:text-indigo-300"
                  onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const response = await userAdminAPI.generateLogsToken(user.id)
                      const token = response.data.token
                      navigate(`/admin/logs/${token}`)
                    } catch {
                      toast.error('获取日志访问失败')
                    }
                  }}
                >
                  <FileText className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>查看日志</p>
              </TooltipContent>
            </Tooltip>
            {!user.is_active && !isSelf && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="morden"
                    size="sm"
                    className="h-8 w-8 p-0 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleActivate(user.id)
                    }}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>激活</p>
                </TooltipContent>
              </Tooltip>
            )}
            {user.is_active && !isSelf && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="morden"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation()
                      openDeleteModal(user)
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>禁用</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )
      },
    })

    return [...baseColumns, actionColumn] as ColumnDef<Record<string, unknown>, unknown>[]
  }, [currentUser, navigate])

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

  // 打开编辑弹窗
  const openEditModal = (user: User) => {
    setEditUser(user)
    setDialogState('edit')
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

  // Create user handlers - 使用 react-hook-form 的 handleSubmit
  const handleCreate = createForm.handleSubmit(async (formData) => {
    // 确保 role 始终有值
    const userData = {
      ...formData,
      role: formData.role || 'user' as const,
    }
    setCreateLoading(true)
    try {
      await userAdminAPI.create(userData)
      setDialogState(null)
      resetCreateForm({ username: '', password: '', full_name: '', role: 'user' })
      refetchUsers()
      toast.success('用户创建成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(axiosError.response?.data?.detail || '创建失败')
    } finally {
      setCreateLoading(false)
    }
  })

  // 关闭创建弹窗时清空表单
  const handleCreateModalClose = (open: boolean) => {
    setDialogState(open ? 'create' : null)
    if (!open) {
      resetCreateForm({ username: '', password: '', full_name: '', role: 'user' })
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
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
            <SelectValue placeholder="已启用" />
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
            用户列表 <span className="text-muted-foreground font-normal">(&thinsp;{total}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <TableEmptyState
              searchKeyword={debouncedFilter}
              hasFilter={hasFilter}
              emptyText="没有符合条件的用户"
            />
          ) : (
            <div className="px-6 rounded-md overflow-auto">
              <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b-2 border-border">
                      {headerGroup.headers.map(header => (
                        <th
                          key={header.id}
                          className="h-11 px-3 font-bold text-foreground text-left align-middle text-base"
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
        {/* 分页组件 - 数据大于20条时显示 */}
        {total > 20 && (
          <div className="flex items-center justify-between px-6 py-4 mt-2">
            <PaginationInfo
              currentPage={currentPage}
              pageSize={pageSize}
              total={total}
            />
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </Card>

      {/* Create User Modal */}
      <Dialog open={dialogState === 'create'} onOpenChange={handleCreateModalClose}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>创建用户</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {/* 使用 BaseForm 统一表单字段 */}
            <BaseForm
              form={createForm}
              fields={createFormFields}
              layout="stack"
            />
            {/* 角色选择 - 使用 RadioGroup */}
            <div>
              <Label className="text-base">角色</Label>
              <RadioGroup
                value={createForm.watch('role')}
                onValueChange={(value) => createForm.setValue('role', value as 'admin' | 'user')}
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
          <div className="flex gap-3 mt-8">
            <Button variant="morden" onClick={() => handleCreateModalClose(false)} size="lg" className="flex-1">
              取消
            </Button>
            <LoadingButton onClick={handleCreate} isLoading={createLoading} size="lg" className="flex-1">
              {createLoading ? '创建中...' : '创建'}
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <UserEditDialog
        open={dialogState === 'edit'}
        onOpenChange={(open) => setDialogState(open ? 'edit' : null)}
        user={editUser}
        mode="admin"
        onSuccess={() => refetchUsers()}
      />

      {/* Delete Confirmation Modal */}
      <Dialog open={dialogState === 'delete'} onOpenChange={(open) => setDialogState(open ? 'delete' : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认禁用用户</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>确定要禁用用户 <strong>{deleteUser?.username}</strong> 吗？</p>
            <p className="text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
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
    </div>
  )
}