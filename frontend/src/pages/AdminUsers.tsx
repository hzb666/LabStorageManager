import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { SortingState, ColumnDef, Cell, Row } from '@tanstack/react-table'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { userAdminAPI } from '@/api/client'
import { toast } from '@/lib/toast'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { useAuthStore } from '@/store/useStore'
// 注意这里引入了我们需要的图标
import {
  Users,
  Loader2,
  UserPlus,
  FileText,
  UserCheck,
  UserX
} from 'lucide-react'
import useDialogState from '@/hooks/useDialogState'
import { BaseForm } from '@/components/BaseForm'
import { UserEditDialog, type User } from '@/components/UserEditDialog'
import {
  UserCreateSchema,
  type UserCreateFormData,
} from '@/lib/validationSchemas'
import { defaultUserValues, getUserCreateFormFields, USER_ROLE_OPTIONS } from '@/lib/formConfigs'
import type { PaginationParams } from '@/api/client'

import { Pagination, PaginationInfo } from '@/components/ui/Pagination'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { SEARCH_MAX_LENGTH, TableEmptyState, TableSearchInput } from '@/components/ui/TableFilters'
import { getAdminUsersTableColumns } from '@/lib/tableConfigs'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

interface UserListParams extends PaginationParams {
  role?: string
  is_active?: boolean
  username?: string
  full_name?: string
}

const columnHelper = createColumnHelper<User>()

export function AdminUsersPage() {
  const { user: currentUser } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [inputValue, setInputValue] = useState('') // 仅用于输入框实时显示
  const [debouncedFilter, setDebouncedFilter] = useState('') // 用于 API 请求和表格高亮
  const normalizedInputValue = inputValue.trim()

  // 防抖 effect - 300ms 延迟
  useEffect(() => {
    if (!normalizedInputValue && debouncedFilter) {
      setDebouncedFilter('')
      return
    }

    const timer = setTimeout(() => {
      if (inputValue.length <= SEARCH_MAX_LENGTH) {
        setDebouncedFilter(normalizedInputValue)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [inputValue, normalizedInputValue, debouncedFilter])

  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // 当搜索词、角色过滤、状态过滤发生变化时，重置回第一页
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedFilter, roleFilter, statusFilter])

  // 获取不带筛选的总数（缓存5分钟）
  const { data: totalWithoutFilterData } = useQuery({
    queryKey: ['adminUsers', 'count'],
    queryFn: async () => {
      const params: UserListParams = { skip: 0, limit: 0 }
      const response = await userAdminAPI.list(params)
      return response.data.total || 0
    },
    staleTime: 5 * 60 * 1000, // 缓存5分钟
  })

  // 使用单一 React Query 获取用户列表及总数，配合 keepPreviousData 避免闪烁
  const { data: queryResult, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['adminUsers', roleFilter, statusFilter, debouncedFilter, currentPage, pageSize],
    queryFn: async () => {
      const params: UserListParams = {
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
      }
      if (roleFilter !== 'all') params.role = roleFilter
      if (statusFilter !== 'all') params.is_active = statusFilter === 'active'
      if (debouncedFilter) {
        params.username = debouncedFilter
        params.full_name = debouncedFilter
      }

      const response = await userAdminAPI.list(params)
      return {
        data: response.data.data || [],
        total: response.data.total || 0
      }
    },
    placeholderData: keepPreviousData,
  })

  // 派生出 total
  const total = queryResult?.total || 0
  const totalPages = Math.ceil(total / pageSize)
  const totalWithoutFilter = totalWithoutFilterData || 0
  
  // 判断是否有筛选条件
  const hasFilter = Boolean(debouncedFilter || roleFilter !== 'all' || statusFilter !== 'all')
  const shouldShowGrandTotal = hasFilter
    && totalWithoutFilter > 0
    && (!isPlaceholderData || total !== totalWithoutFilter)
  const displayCount = shouldShowGrandTotal ? `${total}/${totalWithoutFilter}` : `${total}`

  // 将当前管理员账户置顶显示
  const data = useMemo(() => {
    const userData = queryResult?.data || []
    if (!currentUser) return userData
    const currentUserId = currentUser.id
    const currentUserIndex = userData.findIndex((user: User) => user.id === currentUserId)
    if (currentUserIndex === -1 || currentUserIndex === 0) return userData

    // 将当前用户移到数组最前面
    const result = [...userData]
    const [currentUserItem] = result.splice(currentUserIndex, 1)
    result.unshift(currentUserItem)
    return result
  }, [queryResult, currentUser])

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
    defaultValues: defaultUserValues,
  })
  const { reset: resetCreateForm } = createForm
  const [createLoading, setCreateLoading] = useState(false)

  // 创建用户表单字段配置
  const createFormFields = getUserCreateFormFields()

  // Edit user modal
  const [editUser, setEditUser] = useState<User | null>(null)

  // Delete confirmation
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Handlers 使用 useCallback 包裹以优化传给 ActionButtons 的引用
  const openEditModal = useCallback((user: User) => {
    setEditUser(user)
    setDialogState('edit')
  }, [setDialogState])

  const openDeleteModal = useCallback((user: User) => {
    setDeleteUser(user)
    setDialogState('delete')
  }, [setDialogState])

  const handleActivate = useCallback(async (userId: number) => {
    try {
      await userAdminAPI.activate(userId)
      refetchUsers()
      toast.success('用户已启用')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '操作失败'))
    }
  }, [refetchUsers])

  const handleViewLogs = useCallback(async (user: User) => {
    try {
      const response = await userAdminAPI.generateLogsToken(user.id)
      const token = response.data.token
      navigate('/admin/logs', { state: { logsToken: token } })
    } catch {
      toast.error('获取日志访问失败')
    }
  }, [navigate])

  // 表格列定义
  const columns = useMemo(() => {
    const baseColumns = getAdminUsersTableColumns()
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 200,
      cell: (info) => {
        const row = info.row
        return (
          <ActionButtons
            user={row.original}
            currentUser={currentUser ? { ...currentUser, is_active: true } : null}
            onEdit={openEditModal}
            onViewLogs={handleViewLogs}
            onActivate={handleActivate}
            onDelete={openDeleteModal}
          />
        )
      },
    })

    return [...baseColumns, actionColumn] as ColumnDef<User, unknown>[]
  }, [currentUser, openEditModal, handleViewLogs, handleActivate, openDeleteModal])

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
      globalFilter: debouncedFilter, // 👈 核心修改：表格高亮也使用防抖后的值
    },
  })

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
      toast.error(getApiErrorMessage(error, '操作失败'))
    } finally {
      setDeleteLoading(false)
    }
  }

  // Create user handlers
  const handleCreate = createForm.handleSubmit(async (formData) => {
    const userData = {
      ...formData,
      role: formData.role || 'user' as const,
    }
    setCreateLoading(true)
    try {
      await userAdminAPI.create(userData)
      setDialogState(null)
      resetCreateForm(defaultUserValues)
      refetchUsers()
      toast.success('用户创建成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '创建失败'))
    } finally {
      setCreateLoading(false)
    }
  })

  // 关闭创建弹窗时清空表单
  const handleCreateModalClose = (open: boolean) => {
    setDialogState(open ? 'create' : null)
    if (!open) {
      resetCreateForm(defaultUserValues)
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
        <TableSearchInput
          value={inputValue}
          onChange={setInputValue}
          placeholder="搜索用户名、姓名..."
          inputClassName="h-10"
        />
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value)}>
          <SelectTrigger className="w-30 min-h-10">
            <SelectValue placeholder="全部角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
            <SelectItem value="user">用户</SelectItem>
            <SelectItem value="public">公用</SelectItem>
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
            用户列表 
            <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && data.length === 0 && (
            <TableEmptyState
              searchKeyword={debouncedFilter}
              hasFilter={hasFilter}
              emptyText="没有符合条件的用户"
            />
          )}
          {data.length > 0 && (
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
                    <MemoizedTableRow key={row.id} row={row} />
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
                onValueChange={(value) => createForm.setValue('role', value as 'admin' | 'user' | 'public')}
                className="flex gap-4 mt-2"
              >
                {USER_ROLE_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={option.value} id={`create_role_${option.value}`} />
                    <Label htmlFor={`create_role_${option.value}`} className="text-base cursor-pointer">{option.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
          <div className="flex gap-3 mt-8">
            <Button variant="modern" onClick={() => handleCreateModalClose(false)} size="lg" className="flex-1">
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
          <div className="pb-4">
            <p>确定要禁用用户 <strong>{deleteUser?.username}</strong> 吗？</p>
            <p className="text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
          </div>
          <div className="flex mt-4 gap-2">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} size="lg">
              {deleteLoading ? '处理中...' : '确认禁用'}
            </Button>
            <Button variant="modern" onClick={() => setDialogState(null)} size="lg" className="text-base">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================================
// 表格操作按钮组件 - 从主组件中提取出来，避免重复定义
// ============================================================================

interface ActionButtonsProps {
  user: User;
  currentUser: User | null;
  onEdit: (user: User) => void;
  onViewLogs: (user: User) => void;
  onActivate: (userId: number) => void;
  onDelete: (user: User) => void;
}

const ActionButtons = React.memo(function ActionButtons({
  user,
  currentUser,
  onEdit,
  onViewLogs,
  onActivate,
  onDelete
}: ActionButtonsProps) {
  const isSelf = user.id === currentUser?.id;

  const actions = useMemo(() => {
    return [
      {
        id: 'logs',
        label: '查看日志',
        icon: <FileText className="size-4" />,
        variant: 'modern' as const,
        className: 'text-blue-600/90 hover:text-blue-700 dark:text-blue-400/70 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
        onClick: () => onViewLogs(user)
      },
      {
        id: 'activate',
        label: '激活',
        icon: <UserCheck className="size-4" />,
        variant: 'modern' as const,
        className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
        showWhen: (u: User) => !u.is_active, 
        disableWhen: () => isSelf,           // 是自己账号时禁用
        onClick: () => onActivate(user.id)
      },
      {
        id: 'deactivate',
        label: '禁用',
        icon: <UserX className="size-4" />,
        variant: 'modern' as const,
        className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
        showWhen: (u: User) => u.is_active,  
        disableWhen: () => isSelf,           // 是自己账号时禁用
        onClick: () => onDelete(user)
      }
    ]
  }, [isSelf, user, onViewLogs, onActivate, onDelete])

  return (
    <TableActionButtonsMemo
      item={user}
      actions={actions}
      showEdit={true}
      disableEdit={isSelf} // 禁用编辑自己的功能
      onEdit={onEdit}
    />
  )
}, (prevProps, nextProps) => {
  if (
    prevProps.onEdit !== nextProps.onEdit ||
    prevProps.onViewLogs !== nextProps.onViewLogs ||
    prevProps.onActivate !== nextProps.onActivate ||
    prevProps.onDelete !== nextProps.onDelete ||
    prevProps.currentUser?.id !== nextProps.currentUser?.id
  ) {
    return false;
  }

  const prevUser = prevProps.user as unknown as Record<string, unknown>
  const nextUser = nextProps.user as unknown as Record<string, unknown>

  if (prevUser === nextUser) return true

  const prevKeys = Object.keys(prevUser)
  const nextKeys = Object.keys(nextUser)
  if (prevKeys.length !== nextKeys.length) return false

  return prevKeys.every((key) => prevUser[key] === nextUser[key])
})

const MemoizedTableRow = React.memo(({ row }: { row: Row<User> }) => {
  return (
    <tr className="border-b border-border hover:bg-muted/30">
      {row.getVisibleCells().map((cell: Cell<User, unknown>) => (
        <td
          key={cell.id}
          className="p-3 align-middle text-base"
          style={{ width: cell.column.getSize() }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  )
}, (prevProps, nextProps) => {
  // 当整行数据没有变化时阻止重渲染
  return prevProps.row.original === nextProps.row.original
})
