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
import {
  Users,
  Loader2,
  UserPlus,
  FileText,
  UserCheck,
  UserX,
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

// 用户列表请求共用分页、关键字、角色和状态筛选字段。
interface UserListParams extends PaginationParams {
  role?: string
  is_active?: boolean
  username?: string
  full_name?: string
}

// 弹窗状态只允许 `create / edit / delete` 三种模式。
type AdminUsersDialogMode = 'create' | 'edit' | 'delete'

// 为用户表格列定义保留字段级类型推导。
const columnHelper = createColumnHelper<User>()

// 统一管理搜索输入、防抖筛选和分页重置。
function useAdminUsersFilterState() {
  const [inputValue, setInputValue] = useState('')
  const [debouncedFilter, setDebouncedFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const normalizedInputValue = inputValue.trim()

  const handleInputValueChange = useCallback((value: string) => {
    const normalizedValue = value.trim()
    setInputValue(value)
    if (!normalizedValue) {
      setDebouncedFilter('')
      setCurrentPage(1)
    }
  }, [])

  useEffect(() => {
    if (!normalizedInputValue) {
      return
    }

    const timer = setTimeout(() => {
      if (inputValue.length <= SEARCH_MAX_LENGTH) {
        setDebouncedFilter(normalizedInputValue)
        setCurrentPage(1)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [inputValue, normalizedInputValue])

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size)
    setCurrentPage(1)
  }, [])

  const handleRoleFilterChange = useCallback((value: string) => {
    setRoleFilter(value)
    setCurrentPage(1)
  }, [])

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value)
    setCurrentPage(1)
  }, [])

  return {
    inputValue,
    debouncedFilter,
    roleFilter,
    statusFilter,
    currentPage,
    pageSize,
    setInputValue: handleInputValueChange,
    setRoleFilter: handleRoleFilterChange,
    setStatusFilter: handleStatusFilterChange,
    setCurrentPage,
    handlePageSizeChange,
  }
}

// 查询参数会裁掉空筛选项，避免把“全部”状态继续传给接口。
function buildUserListParams(
  currentPage: number,
  pageSize: number,
  roleFilter: string,
  statusFilter: string,
  debouncedFilter: string
): UserListParams {
  const params: UserListParams = {
    skip: (currentPage - 1) * pageSize,
    limit: pageSize,
  }

  if (roleFilter !== 'all') {
    params.role = roleFilter
  }

  if (statusFilter !== 'all') {
    params.is_active = statusFilter === 'active'
  }

  if (debouncedFilter) {
    params.username = debouncedFilter
    params.full_name = debouncedFilter
  }

  return params
}

// 当前登录管理员固定显示在列表顶部，其余用户保持原有顺序。
function moveCurrentUserToTop(userData: User[], currentUser: User | null | undefined) {
  if (!currentUser) {
    return userData
  }

  const currentUserIndex = userData.findIndex((user) => user.id === currentUser.id)
  if (currentUserIndex <= 0) {
    return userData
  }

  const result = [...userData]
  const [currentUserItem] = result.splice(currentUserIndex, 1)
  result.unshift(currentUserItem)
  return result
}

// 存在筛选、总数可用且不是占位数据时显示“当前 / 总计”；其余场景只显示当前总数。
function getUserDisplayCount(
  total: number,
  totalWithoutFilter: number,
  hasFilter: boolean,
  isPlaceholderData: boolean
) {
  const shouldShowGrandTotal =
    hasFilter &&
    totalWithoutFilter > 0 &&
    (!isPlaceholderData || total !== totalWithoutFilter)

  return shouldShowGrandTotal ? `${total}/${totalWithoutFilter}` : `${total}`
}

// 集中管理用户创建、启用/禁用和弹窗状态，提交成功后统一刷新列表。
function useAdminUsersDialogState(
  setDialogState: (value: AdminUsersDialogMode | null) => void,
  refetchUsers: () => void
) {
  const createForm = useForm<UserCreateFormData>({
    resolver: valibotResolver(UserCreateSchema),
    defaultValues: defaultUserValues,
  })
  const { reset: resetCreateForm } = createForm
  const [createLoading, setCreateLoading] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

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

  const handleDelete = useCallback(async () => {
    if (!deleteUser) {
      return
    }

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
  }, [deleteUser, refetchUsers, setDialogState])

  const handleCreate = useCallback(async (formData: UserCreateFormData) => {
    setCreateLoading(true)
    try {
      await userAdminAPI.create({
        ...formData,
        role: formData.role || 'user',
      })
      setDialogState(null)
      resetCreateForm(defaultUserValues)
      refetchUsers()
      toast.success('用户创建成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '创建失败'))
    } finally {
      setCreateLoading(false)
    }
  }, [refetchUsers, resetCreateForm, setDialogState])

  const handleCreateDialogChange = useCallback((open: boolean) => {
    setDialogState(open ? 'create' : null)
    if (!open) {
      resetCreateForm(defaultUserValues)
    }
  }, [resetCreateForm, setDialogState])

  const handleDeleteDialogChange = useCallback((open: boolean) => {
    setDialogState(open ? 'delete' : null)
    if (!open) {
      setDeleteUser(null)
    }
  }, [setDialogState])

  return {
    createForm,
    createLoading,
    editUser,
    deleteUser,
    deleteLoading,
    openEditModal,
    openDeleteModal,
    handleActivate,
    handleDelete,
    handleCreate,
    handleCreateDialogChange,
    handleDeleteDialogChange,
  }
}

// 筛选栏同时驱动关键字、角色和状态三个过滤维度。
function AdminUsersFilters({
  filters,
}: {
  filters: ReturnType<typeof useAdminUsersFilterState>
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
      <TableSearchInput
        value={filters.inputValue}
        onChange={filters.setInputValue}
        placeholder="搜索用户名、姓名..."
        inputClassName="h-10"
      />
      <Select value={filters.roleFilter} onValueChange={filters.setRoleFilter}>
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
      <Select value={filters.statusFilter} onValueChange={filters.setStatusFilter}>
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
  )
}

// 表格卡片统一承载加载态、空态、列表和分页切换。
function AdminUsersTableCard({
  tableState,
}: {
  tableState: {
    isLoading: boolean
    rowCount: number
    debouncedFilter: string
    hasFilter: boolean
    displayCount: string
    total: number
    currentPage: number
    totalPages: number
    pageSize: number
    table: ReturnType<typeof useReactTable<User>>
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
  }
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Users className="w-5 h-5" />
          用户列表
          <span className="text-muted-foreground font-normal">(&thinsp;{tableState.displayCount}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {tableState.isLoading && tableState.rowCount === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!tableState.isLoading && tableState.rowCount === 0 && (
          <TableEmptyState
            searchKeyword={tableState.debouncedFilter}
            hasFilter={tableState.hasFilter}
            emptyText="没有符合条件的用户"
          />
        )}
        {tableState.rowCount > 0 && (
          <div className="px-6 rounded-md overflow-auto">
            <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
              <thead>
                {tableState.table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b-2 border-border">
                    {headerGroup.headers.map((header) => (
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
                {tableState.table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {tableState.total > 20 && (
        <div className="flex items-center justify-between px-6 py-4 mt-2">
          <PaginationInfo
            currentPage={tableState.currentPage}
            pageSize={tableState.pageSize}
            total={tableState.total}
          />
          <Pagination
            currentPage={tableState.currentPage}
            totalPages={tableState.totalPages}
            pageSize={tableState.pageSize}
            onPageChange={tableState.onPageChange}
            onPageSizeChange={tableState.onPageSizeChange}
          />
        </div>
      )}
    </Card>
  )
}

// 创建弹窗复用 `BaseForm`，字段和校验继续沿用原有创建用户流程。
function CreateUserDialog({
  open,
  dialogs,
  onSubmit,
}: {
  open: boolean
  dialogs: ReturnType<typeof useAdminUsersDialogState>
  onSubmit: () => Promise<void>
}) {
  const roleValue = dialogs.createForm.watch('role')

  return (
    <Dialog open={open} onOpenChange={dialogs.handleCreateDialogChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建用户</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <BaseForm
            form={dialogs.createForm}
            fields={getUserCreateFormFields()}
            layout="stack"
          />
          <div>
            <Label className="text-base">角色</Label>
            <RadioGroup
              value={roleValue}
              onValueChange={(value) => dialogs.createForm.setValue('role', value as 'admin' | 'user' | 'public')}
              className="flex gap-4 mt-2"
            >
              {USER_ROLE_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.value} id={`create_role_${option.value}`} />
                  <Label htmlFor={`create_role_${option.value}`} className="text-base cursor-pointer">
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
        <div className="flex gap-3 mt-8">
          <Button variant="modern" onClick={() => dialogs.handleCreateDialogChange(false)} size="lg" className="flex-1">
            取消
          </Button>
          <LoadingButton onClick={onSubmit} isLoading={dialogs.createLoading} size="lg" className="flex-1">
            {dialogs.createLoading ? '创建中...' : '创建'}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 禁用确认弹窗只展示目标用户名，并复用原有确认文案和提交动作。
function DeleteUserDialog({
  open,
  dialogs,
}: {
  open: boolean
  dialogs: ReturnType<typeof useAdminUsersDialogState>
}) {
  return (
    <Dialog open={open} onOpenChange={dialogs.handleDeleteDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认禁用用户</DialogTitle>
        </DialogHeader>
        <div className="pb-4">
          <p>确定要禁用用户 <strong>{dialogs.deleteUser?.username}</strong> 吗？</p>
          <p className="text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
        </div>
        <div className="flex mt-4 gap-2">
          <Button variant="destructive" onClick={dialogs.handleDelete} disabled={dialogs.deleteLoading} size="lg">
            {dialogs.deleteLoading ? '处理中...' : '确认禁用'}
          </Button>
          <Button variant="modern" onClick={() => dialogs.handleDeleteDialogChange(false)} size="lg" className="text-base">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 页头只负责标题和“添加用户”入口，不承载筛选或表格状态。
function AdminUsersHeader({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 className="text-3xl font-bold text-primary">用户管理</h1>
      <Button onClick={onCreate} size="lg">
        <UserPlus className="w-4 h-4 mr-1.5" />
        创建用户
      </Button>
    </div>
  )
}

// 用户管理页主组件只编排查询、创建、编辑、禁用和日志跳转流程。
export function AdminUsersPage() {
  const { user: currentUser } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [dialogState, setDialogState] = useDialogState<AdminUsersDialogMode>()
  const filters = useAdminUsersFilterState()

  const { data: totalWithoutFilterData } = useQuery({
    queryKey: ['adminUsers', 'count'],
    queryFn: async () => {
      // limit=0 只拿 total，用于筛选态下展示“当前/总计”而不重复请求整页数据。
      const response = await userAdminAPI.list({ skip: 0, limit: 0 })
      return response.data.total || 0
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: queryResult, isLoading, isPlaceholderData } = useQuery({
    // 把分页与筛选条件全部纳入 queryKey，避免不同筛选态之间缓存串页。
    queryKey: ['adminUsers', filters.roleFilter, filters.statusFilter, filters.debouncedFilter, filters.currentPage, filters.pageSize],
    queryFn: async () => {
      const response = await userAdminAPI.list(
        buildUserListParams(
          filters.currentPage,
          filters.pageSize,
          filters.roleFilter,
          filters.statusFilter,
          filters.debouncedFilter
        )
      )
      return {
        data: response.data.data || [],
        total: response.data.total || 0,
      }
    },
    placeholderData: keepPreviousData,
  })

  const total = queryResult?.total || 0
  const totalPages = Math.ceil(total / filters.pageSize)
  const totalWithoutFilter = totalWithoutFilterData || 0
  const hasFilter = Boolean(
    filters.debouncedFilter || filters.roleFilter !== 'all' || filters.statusFilter !== 'all'
  )
  const displayCount = getUserDisplayCount(total, totalWithoutFilter, hasFilter, isPlaceholderData)
  const data = useMemo(
    () => moveCurrentUserToTop(queryResult?.data || [], currentUser),
    [queryResult?.data, currentUser]
  )

  const refetchUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
  }, [queryClient])
  const dialogs = useAdminUsersDialogState(setDialogState, refetchUsers)

  const handleViewLogs = useCallback(async (user: User) => {
    try {
      const response = await userAdminAPI.generateLogsToken(user.id)
      navigate('/admin/logs', { state: { logsToken: response.data.token } })
    } catch {
      toast.error('获取日志访问失败')
    }
  }, [navigate])

  const columns = useMemo(() => {
    const actionColumn = columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 200,
      cell: (info) => (
        <ActionButtons
          user={info.row.original}
          currentUserId={currentUser?.id}
          onEdit={dialogs.openEditModal}
          onViewLogs={handleViewLogs}
          onActivate={dialogs.handleActivate}
          onDelete={dialogs.openDeleteModal}
        />
      ),
    })

    return [...getAdminUsersTableColumns(), actionColumn] as ColumnDef<User, unknown>[]
  }, [currentUser, dialogs.handleActivate, dialogs.openDeleteModal, dialogs.openEditModal, handleViewLogs])

  // 这里不会把 table 实例再交给 memo comparator 缓存，按项目约定定点忽略编译器告警。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
      globalFilter: filters.debouncedFilter,
    },
  })

  return (
    <div className="space-y-6">
      <AdminUsersHeader onCreate={() => setDialogState('create')} />

      <AdminUsersFilters filters={filters} />

      <AdminUsersTableCard
        tableState={{
          isLoading,
          rowCount: data.length,
          debouncedFilter: filters.debouncedFilter,
          hasFilter,
          displayCount,
          total,
          currentPage: filters.currentPage,
          totalPages,
          pageSize: filters.pageSize,
          table,
          onPageChange: filters.setCurrentPage,
          onPageSizeChange: filters.handlePageSizeChange,
        }}
      />

      <CreateUserDialog
        open={dialogState === 'create'}
        dialogs={dialogs}
        onSubmit={dialogs.createForm.handleSubmit(dialogs.handleCreate)}
      />

      <UserEditDialog
        open={dialogState === 'edit'}
        onOpenChange={(open) => setDialogState(open ? 'edit' : null)}
        user={dialogs.editUser}
        mode="admin"
        onSuccess={refetchUsers}
      />

      <DeleteUserDialog open={dialogState === 'delete'} dialogs={dialogs} />
    </div>
  )
}

// 行操作继续保留编辑、日志、启用和禁用入口，并按当前用户和目标状态控制可用性。
const ActionButtons = React.memo(function ActionButtons({
  user,
  currentUserId,
  onEdit,
  onViewLogs,
  onActivate,
  onDelete,
}: {
  user: User
  currentUserId?: number
  onEdit: (user: User) => void
  onViewLogs: (user: User) => void
  onActivate: (userId: number) => void
  onDelete: (user: User) => void
}) {
  const isSelf = user.id === currentUserId

  // 自身账号禁止启用/禁用，避免管理员误把自己踢出可登录状态。
  const actions = useMemo(() => [
    {
      id: 'logs',
      label: '查看日志',
      icon: <FileText className="size-4" />,
      variant: 'modern' as const,
      className: 'text-blue-600/90 hover:text-blue-700 dark:text-blue-400/70 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
      onClick: () => onViewLogs(user),
    },
    {
      id: 'activate',
      label: '激活',
      icon: <UserCheck className="size-4" />,
      variant: 'modern' as const,
      className: 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-950',
      showWhen: (currentItem: User) => !currentItem.is_active,
      disableWhen: () => isSelf,
      onClick: () => onActivate(user.id),
    },
    {
      id: 'deactivate',
      label: '禁用',
      icon: <UserX className="size-4" />,
      variant: 'modern' as const,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      showWhen: (currentItem: User) => currentItem.is_active,
      disableWhen: () => isSelf,
      onClick: () => onDelete(user),
    },
  ], [isSelf, onActivate, onDelete, onViewLogs, user])

  return (
    <TableActionButtonsMemo
      item={user}
      actions={actions}
      showEdit={true}
      disableEdit={isSelf}
      onEdit={onEdit}
    />
  )
}, (prevProps, nextProps) => {
  if (
    prevProps.onEdit !== nextProps.onEdit ||
    prevProps.onViewLogs !== nextProps.onViewLogs ||
    prevProps.onActivate !== nextProps.onActivate ||
    prevProps.onDelete !== nextProps.onDelete ||
    prevProps.currentUserId !== nextProps.currentUserId
  ) {
    return false
  }

  const prevUser = prevProps.user as unknown as Record<string, unknown>
  const nextUser = nextProps.user as unknown as Record<string, unknown>
  if (prevUser === nextUser) {
    return true
  }

  const prevKeys = Object.keys(prevUser)
  const nextKeys = Object.keys(nextUser)
  if (prevKeys.length !== nextKeys.length) {
    return false
  }

  return prevKeys.every((key) => prevUser[key] === nextUser[key])
})

// 行渲染依赖 TanStack Table 的运行时上下文，不能只按 `row.original` 做 memo。
function TableRow({ row }: { row: Row<User> }) {
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
}
