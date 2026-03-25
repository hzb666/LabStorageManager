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

/**
 * 定义用户列表请求参数结构。
 * 这个类型存在是为了统一分页与筛选入参，避免调用接口时拼错字段。
 */
interface UserListParams extends PaginationParams {
  role?: string
  is_active?: boolean
  username?: string
  full_name?: string
}

/**
 * 约束用户管理页弹窗模式。
 * 这个类型存在是为了限制弹窗状态取值，避免使用任意字符串导致分支失效。
 */
type AdminUsersDialogMode = 'create' | 'edit' | 'delete'

/**
 * 定义筛选栏组件的入参。
 * 这个接口存在是为了明确筛选展示数据与回调契约，降低父子组件耦合风险。
 */
interface AdminUsersFiltersProps {
  inputValue: string
  roleFilter: string
  statusFilter: string
  onInputChange: (value: string) => void
  onRoleChange: (value: string) => void
  onStatusChange: (value: string) => void
}

/**
 * 定义用户表格卡片组件的入参。
 * 这个接口存在是为了集中描述列表、分页和表格实例依赖，避免 props 语义分散。
 */
interface AdminUsersTableCardProps {
  isLoading: boolean
  data: User[]
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

/**
 * 定义创建用户弹窗组件的入参。
 * 这个接口存在是为了固定创建流程所需状态与行为，保证表单与弹窗联动一致。
 */
interface CreateUserDialogProps {
  open: boolean
  form: ReturnType<typeof useForm<UserCreateFormData>>
  createLoading: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => Promise<void>
}

/**
 * 定义禁用用户弹窗组件的入参。
 * 这个接口存在是为了统一确认弹窗的数据与回调协议，避免删除链路参数漂移。
 */
interface DeleteUserDialogProps {
  open: boolean
  user: User | null
  deleteLoading: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/**
 * 描述用户管理页筛选状态 Hook 的返回结构。
 * 这个接口存在是为了把筛选状态与操作函数打包成稳定契约，便于主页面消费。
 */
interface AdminUsersFilterState {
  inputValue: string
  debouncedFilter: string
  roleFilter: string
  statusFilter: string
  currentPage: number
  pageSize: number
  setInputValue: (value: string) => void
  setRoleFilter: (value: string) => void
  setStatusFilter: (value: string) => void
  setCurrentPage: (page: number) => void
  handlePageSizeChange: (size: number) => void
}

/**
 * 描述用户管理页弹窗与 CRUD 状态 Hook 的返回结构。
 * 这个接口存在是为了明确弹窗流转和异步操作能力边界，方便主页面按需组合。
 */
interface AdminUsersDialogState {
  createForm: ReturnType<typeof useForm<UserCreateFormData>>
  createLoading: boolean
  editUser: User | null
  deleteUser: User | null
  deleteLoading: boolean
  openEditModal: (user: User) => void
  openDeleteModal: (user: User) => void
  handleActivate: (userId: number) => Promise<void>
  handleDelete: () => Promise<void>
  handleCreate: (formData: UserCreateFormData) => Promise<void>
  handleCreateDialogChange: (open: boolean) => void
  handleDeleteDialogChange: (open: boolean) => void
}

/**
 * 定义用户管理页展示层组件的入参。
 * 这个接口存在是为了收敛页面展示依赖，避免主页面 JSX 与状态编排相互缠绕。
 */
interface AdminUsersPageContentProps {
  inputValue: string
  roleFilter: string
  statusFilter: string
  isLoading: boolean
  data: User[]
  debouncedFilter: string
  hasFilter: boolean
  displayCount: string
  total: number
  currentPage: number
  totalPages: number
  pageSize: number
  table: ReturnType<typeof useReactTable<User>>
  dialogState: AdminUsersDialogMode | null
  createForm: ReturnType<typeof useForm<UserCreateFormData>>
  createLoading: boolean
  editUser: User | null
  deleteUser: User | null
  deleteLoading: boolean
  onSetDialogState: (value: AdminUsersDialogMode | null) => void
  onInputChange: (value: string) => void
  onRoleChange: (value: string) => void
  onStatusChange: (value: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onCreateDialogChange: (open: boolean) => void
  onDeleteDialogChange: (open: boolean) => void
  onCreateSubmit: () => Promise<void>
  onDeleteSubmit: () => Promise<void>
  onRefetchUsers: () => void
}

/**
 * 创建用户表格列辅助器。
 * 这个常量存在是为了复用列定义构建能力，减少手写列类型推导。
 */
const columnHelper = createColumnHelper<User>()

/**
 * 维护用户管理页的搜索、筛选和分页状态。
 * 这个函数存在是为了把页面级筛选状态从主组件中拆出，压缩主函数长度和语句数。
 */
function useAdminUsersFilterState(): AdminUsersFilterState {
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

/**
 * 构建用户列表查询参数，保持筛选条件与分页逻辑一致。
 * 这个函数存在是为了把接口参数拼装从页面主函数中抽离出来，减少重复判断。
 */
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

/**
 * 将当前登录管理员置顶，保持原有列表展示习惯不变。
 * 这个函数存在是为了把列表展示策略独立出来，避免页面主体混入数据重排细节。
 */
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

/**
 * 计算用户列表展示计数，统一过滤前后总数的显示规则。
 * 这个函数存在是为了复用计数字符串逻辑，减少页面主函数里的条件分支。
 */
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

/**
 * 维护用户管理页的创建、启用、禁用与弹窗状态。
 * 这个函数存在是为了把 CRUD 编排从主页面中抽离，避免主页面继续膨胀。
 */
function useAdminUsersDialogState(
  setDialogState: (value: AdminUsersDialogMode | null) => void,
  refetchUsers: () => void
): AdminUsersDialogState {
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

/**
 * 渲染用户管理页的筛选栏。
 * 这个函数存在是为了把搜索和筛选结构从页面主体中拆出，缩短主页面长度。
 */
function AdminUsersFilters({
  inputValue,
  roleFilter,
  statusFilter,
  onInputChange,
  onRoleChange,
  onStatusChange,
}: AdminUsersFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
      <TableSearchInput
        value={inputValue}
        onChange={onInputChange}
        placeholder="搜索用户名、姓名..."
        inputClassName="h-10"
      />
      <Select value={roleFilter} onValueChange={onRoleChange}>
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
      <Select value={statusFilter} onValueChange={onStatusChange}>
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

/**
 * 渲染用户列表卡片与分页区。
 * 这个函数存在是为了让主组件只负责数据编排，而不是直接承载整段表格 UI。
 */
function AdminUsersTableCard({
  isLoading,
  data,
  debouncedFilter,
  hasFilter,
  displayCount,
  total,
  currentPage,
  totalPages,
  pageSize,
  table,
  onPageChange,
  onPageSizeChange,
}: AdminUsersTableCardProps) {
  return (
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
                {table.getHeaderGroups().map((headerGroup) => (
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
                {table.getRowModel().rows.map((row) => (
                  <MemoizedTableRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
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
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      )}
    </Card>
  )
}

/**
 * 渲染创建用户弹窗。
 * 这个函数存在是为了把创建表单结构从主页面中拆开，并复用原有 BaseForm 方案。
 */
function CreateUserDialog({
  open,
  form,
  createLoading,
  onOpenChange,
  onSubmit,
}: CreateUserDialogProps) {
  const roleValue = form.watch('role')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建用户</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <BaseForm
            form={form}
            fields={getUserCreateFormFields()}
            layout="stack"
          />
          <div>
            <Label className="text-base">角色</Label>
            <RadioGroup
              value={roleValue}
              onValueChange={(value) => form.setValue('role', value as 'admin' | 'user' | 'public')}
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
          <Button variant="modern" onClick={() => onOpenChange(false)} size="lg" className="flex-1">
            取消
          </Button>
          <LoadingButton onClick={onSubmit} isLoading={createLoading} size="lg" className="flex-1">
            {createLoading ? '创建中...' : '创建'}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染禁用用户确认弹窗。
 * 这个函数存在是为了把禁用确认 UI 从主页面中拆开，降低主页面长度和语句数。
 */
function DeleteUserDialog({
  open,
  user,
  deleteLoading,
  onOpenChange,
  onConfirm,
}: DeleteUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认禁用用户</DialogTitle>
        </DialogHeader>
        <div className="pb-4">
          <p>确定要禁用用户 <strong>{user?.username}</strong> 吗？</p>
          <p className="text-muted-foreground mt-2">禁用后该用户将无法登录系统。</p>
        </div>
        <div className="flex mt-4 gap-2">
          <Button variant="destructive" onClick={onConfirm} disabled={deleteLoading} size="lg">
            {deleteLoading ? '处理中...' : '确认禁用'}
          </Button>
          <Button variant="modern" onClick={() => onOpenChange(false)} size="lg" className="text-base">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染用户管理页主体结构。
 * 这个函数存在是为了把主页面的展示层抽离出去，让页面主函数更聚焦于状态编排。
 */
function AdminUsersPageContent({
  inputValue,
  roleFilter,
  statusFilter,
  isLoading,
  data,
  debouncedFilter,
  hasFilter,
  displayCount,
  total,
  currentPage,
  totalPages,
  pageSize,
  table,
  dialogState,
  createForm,
  createLoading,
  editUser,
  deleteUser,
  deleteLoading,
  onSetDialogState,
  onInputChange,
  onRoleChange,
  onStatusChange,
  onPageChange,
  onPageSizeChange,
  onCreateDialogChange,
  onDeleteDialogChange,
  onCreateSubmit,
  onDeleteSubmit,
  onRefetchUsers,
}: AdminUsersPageContentProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">用户管理</h1>
        <Button onClick={() => onSetDialogState('create')} size="lg">
          <UserPlus className="w-4 h-4 mr-1.5" />
          创建用户
        </Button>
      </div>

      <AdminUsersFilters
        inputValue={inputValue}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        onInputChange={onInputChange}
        onRoleChange={onRoleChange}
        onStatusChange={onStatusChange}
      />

      <AdminUsersTableCard
        isLoading={isLoading}
        data={data}
        debouncedFilter={debouncedFilter}
        hasFilter={hasFilter}
        displayCount={displayCount}
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        table={table}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />

      <CreateUserDialog
        open={dialogState === 'create'}
        form={createForm}
        createLoading={createLoading}
        onOpenChange={onCreateDialogChange}
        onSubmit={onCreateSubmit}
      />

      <UserEditDialog
        open={dialogState === 'edit'}
        onOpenChange={(open) => onSetDialogState(open ? 'edit' : null)}
        user={editUser}
        mode="admin"
        onSuccess={onRefetchUsers}
      />

      <DeleteUserDialog
        open={dialogState === 'delete'}
        user={deleteUser}
        deleteLoading={deleteLoading}
        onOpenChange={onDeleteDialogChange}
        onConfirm={onDeleteSubmit}
      />
    </div>
  )
}

/**
 * 用户管理页负责用户查询、创建、编辑和禁用的编排。
 * 这个函数存在是为了复用现有接口与交互行为，同时降低页面主函数复杂度。
 */
export function AdminUsersPage() {
  const { user: currentUser } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [dialogState, setDialogState] = useDialogState<AdminUsersDialogMode>()
  const {
    inputValue,
    debouncedFilter,
    roleFilter,
    statusFilter,
    currentPage,
    pageSize,
    setInputValue,
    setRoleFilter,
    setStatusFilter,
    setCurrentPage,
    handlePageSizeChange,
  } = useAdminUsersFilterState()

  const { data: totalWithoutFilterData } = useQuery({
    queryKey: ['adminUsers', 'count'],
    queryFn: async () => {
      const response = await userAdminAPI.list({ skip: 0, limit: 0 })
      return response.data.total || 0
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: queryResult, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['adminUsers', roleFilter, statusFilter, debouncedFilter, currentPage, pageSize],
    queryFn: async () => {
      const response = await userAdminAPI.list(
        buildUserListParams(currentPage, pageSize, roleFilter, statusFilter, debouncedFilter)
      )
      return {
        data: response.data.data || [],
        total: response.data.total || 0,
      }
    },
    placeholderData: keepPreviousData,
  })

  const total = queryResult?.total || 0
  const totalPages = Math.ceil(total / pageSize)
  const totalWithoutFilter = totalWithoutFilterData || 0
  const hasFilter = Boolean(debouncedFilter || roleFilter !== 'all' || statusFilter !== 'all')
  const displayCount = getUserDisplayCount(total, totalWithoutFilter, hasFilter, isPlaceholderData)
  const data = useMemo(
    () => moveCurrentUserToTop(queryResult?.data || [], currentUser),
    [queryResult?.data, currentUser]
  )

  const refetchUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
  }, [queryClient])
  const {
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
  } = useAdminUsersDialogState(setDialogState, refetchUsers)

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
          currentUser={currentUser ? { ...currentUser, is_active: true } : null}
          onEdit={openEditModal}
          onViewLogs={handleViewLogs}
          onActivate={handleActivate}
          onDelete={openDeleteModal}
        />
      ),
    })

    return [...getAdminUsersTableColumns(), actionColumn] as ColumnDef<User, unknown>[]
  }, [currentUser, handleActivate, handleViewLogs, openDeleteModal, openEditModal])

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
      globalFilter: debouncedFilter,
    },
  })

  return (
    <AdminUsersPageContent
      inputValue={inputValue}
      roleFilter={roleFilter}
      statusFilter={statusFilter}
      isLoading={isLoading}
      data={data}
      debouncedFilter={debouncedFilter}
      hasFilter={hasFilter}
      displayCount={displayCount}
      total={total}
      currentPage={currentPage}
      totalPages={totalPages}
      pageSize={pageSize}
      table={table}
      dialogState={dialogState}
      createForm={createForm}
      createLoading={createLoading}
      editUser={editUser}
      deleteUser={deleteUser}
      deleteLoading={deleteLoading}
      onSetDialogState={setDialogState}
      onInputChange={setInputValue}
      onRoleChange={setRoleFilter}
      onStatusChange={setStatusFilter}
      onPageChange={setCurrentPage}
      onPageSizeChange={handlePageSizeChange}
      onCreateDialogChange={handleCreateDialogChange}
      onDeleteDialogChange={handleDeleteDialogChange}
      onCreateSubmit={createForm.handleSubmit(handleCreate)}
      onDeleteSubmit={handleDelete}
      onRefetchUsers={refetchUsers}
    />
  )
}

/**
 * 定义用户表格操作按钮组件的入参。
 * 这个接口存在是为了约束按钮行为回调签名，保证操作列行为可预测。
 */
interface ActionButtonsProps {
  user: User
  currentUser: User | null
  onEdit: (user: User) => void
  onViewLogs: (user: User) => void
  onActivate: (userId: number) => void
  onDelete: (user: User) => void
}

/**
 * 渲染用户行操作按钮，保持日志、启用和禁用行为不变。
 * 这个函数存在是为了隔离表格操作配置，避免主页面和列定义重复嵌套。
 */
const ActionButtons = React.memo(function ActionButtons({
  user,
  currentUser,
  onEdit,
  onViewLogs,
  onActivate,
  onDelete,
}: ActionButtonsProps) {
  const isSelf = user.id === currentUser?.id

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
    prevProps.currentUser?.id !== nextProps.currentUser?.id
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

/**
 * 渲染用户表格的单行内容，避免列表区重复创建整段 tr 结构。
 * 这个函数存在是为了降低表格主体 JSX 嵌套层级，并保留原有 memo 行为。
 */
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
}, (prevProps, nextProps) => prevProps.row.original === nextProps.row.original)
