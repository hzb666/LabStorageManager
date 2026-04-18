import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import StatusBadge from '@/components/ui/StatusBadge'
import { sessionAPI, authAPI, userAdminAPI, type SessionInfo } from '@/api/client'
import { formatDateTime } from '@/lib/utils'
import { getDeviceId } from '@/lib/storage/appAuthMetaStorage'
import { UserRoles, type User } from '@/lib/constants'
import useDialogState from '@/hooks/useDialogState'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import {
  Laptop,
  Loader2,
  Trash2,
  RefreshCw,
  LogOut,
  Shield,
  Edit,
  Pencil,
  FileText,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { UserEditDialog } from '@/components/UserEditDialog'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { DeviceNameSchema, getApiErrorMessage, type DeviceNameFormData } from '@/lib/validationSchemas'
import { defaultDeviceNameValues, getDeviceNameFormFields } from '@/lib/formConfigs'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { BaseForm } from '@/components/BaseForm'
import {
  SEARCH_MAX_LENGTH,
  TableEmptyState,
  TableLoadingState,
  TableSearchInput,
} from '@/components/ui/TableFilters'
import { HighlightText } from '@/components/ui/HighlightText'
import { containsSearchText } from '@/lib/searchMatchMode'

const columnHelper = createColumnHelper<SessionInfo>()

type DeviceDialogMode = 'kick' | 'kickAll'

// 搜索输入保留原值，`globalFilter` 只在 300ms 防抖后、且不超过最大长度时更新；清空或只剩空白时立即清除过滤。
function useDeviceSearchState() {
  const [inputValue, setInputValue] = useState('')
  const [globalFilter, setGlobalFilter] = useState('')
  const normalizedInputValue = inputValue.trim()

  const handleInputValueChange = useCallback((value: string) => {
    const normalizedValue = value.trim()
    setInputValue(value)
    if (!normalizedValue) {
      setGlobalFilter('')
    }
  }, [])

  useEffect(() => {
    if (!normalizedInputValue) {
      return
    }

    const timer = setTimeout(() => {
      if (inputValue.length <= SEARCH_MAX_LENGTH) {
        setGlobalFilter(normalizedInputValue)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [inputValue, normalizedInputValue])

  return {
    inputValue,
    globalFilter,
    setInputValue: handleInputValueChange,
    setGlobalFilter,
  }
}

// 默认展示前先把当前设备对应会话放到前面，其余会话保持原有顺序。
function sortSessionsByCurrentDevice(data: SessionInfo[], currentDeviceId: string) {
  const current = data.filter((session) => session.device_id === currentDeviceId)
  const others = data.filter((session) => session.device_id !== currentDeviceId)
  return [...current, ...others]
}

function getDeviceDisplayCount(filteredCount: number, totalCount: number, hasFilter: boolean) {
  const shouldShowGrandTotal = hasFilter && totalCount > 0 && filteredCount !== totalCount
  return shouldShowGrandTotal ? `${filteredCount}/${totalCount}` : `${filteredCount}`
}

function SessionActionCell({
  session,
  currentDeviceId,
  onRename,
  onKick,
}: {
  session: SessionInfo
  currentDeviceId: string
  onRename: (session: SessionInfo) => void
  onKick: (session: SessionInfo) => void
}) {
  const isCurrent = session.device_id === currentDeviceId

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="modern"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(event) => {
              event.stopPropagation()
              onRename(session)
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>重命名</p>
        </TooltipContent>
      </Tooltip>
      {!isCurrent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="modern"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(event) => {
                event.stopPropagation()
                onKick(session)
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>踢出设备</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function DeviceTableCard({ tableModel }: { tableModel: ReturnType<typeof useDeviceTableModel> }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Laptop className="w-5 h-5" />
          设备列表
          <span className="text-muted-foreground font-normal">(&thinsp;{tableModel.displayCount}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {tableModel.tableContent}
      </CardContent>
    </Card>
  )
}

// 单设备踢出确认弹窗，依赖 `kickSession` 展示目标设备信息。
function KickDeviceDialog({
  dialogState,
  dialogs,
}: {
  dialogState: DeviceDialogMode | null
  dialogs: ReturnType<typeof useDeviceDialogState>
}) {
  return (
    <Dialog open={dialogState === 'kick'} onOpenChange={dialogs.handleKickDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center mb-6">确认踢出设备</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p>确定要踢出设备 <strong>{dialogs.kickSession?.device_name}</strong> 吗？</p>
          <p className="text-sm text-muted-foreground">
            IP地址：{dialogs.kickSession?.ip_address}
          </p>
          <p className="text-base text-destructive">
            该设备将被迫下线，需要重新登录。
          </p>
        </div>
        <div className="flex gap-3 mt-6">
          <Button
            variant="destructive"
            className="flex-1 border border-destructive"
            onClick={dialogs.handleKickDevice}
            disabled={dialogs.kickLoading}
            size="lg"
          >
            {dialogs.kickLoading ? '处理中...' : '确认踢出'}
          </Button>
          <Button variant="modern" onClick={() => dialogs.handleKickDialogChange(false)} size="lg" className="text-base flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 批量踢出确认弹窗；是否排除当前设备依赖后端 `deleteAll` 的实现语义。
function KickAllDevicesDialog({
  dialogState,
  dialogs,
}: {
  dialogState: DeviceDialogMode | null
  dialogs: ReturnType<typeof useDeviceDialogState>
}) {
  return (
    <Dialog open={dialogState === 'kickAll'} onOpenChange={dialogs.handleKickDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center mb-6">
            <Shield className="w-5 h-5 text-destructive" />
            确认踢出所有其他设备
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p>确定要踢出所有其他设备吗？</p>
          <p className="text-sm text-muted-foreground">
            除当前设备外的所有设备都将下线，需重新登录。
          </p>
          <p className="text-base text-destructive">
            此操作将清除所有其他登录会话！
          </p>
        </div>
        <div className="flex gap-3 mt-6">
          <Button
            variant="destructive"
            className="flex-1 border border-destructive"
            onClick={dialogs.handleKickAllDevices}
            disabled={dialogs.kickAllLoading}
            size="lg"
          >
            {dialogs.kickAllLoading ? '处理中...' : '确认踢出'}
          </Button>
          <Button variant="modern" onClick={() => dialogs.handleKickDialogChange(false)} size="lg" className="text-base flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 设备重命名弹窗，打开时回填当前设备名，关闭时由外层统一重置状态。
function EditDeviceNameDialog({
  dialogs,
  editForm,
  onSubmit,
}: {
  dialogs: ReturnType<typeof useDeviceDialogState>
  editForm: ReturnType<typeof useForm<DeviceNameFormData>>
  onSubmit: () => void
}) {
  return (
    <Dialog open={dialogs.editDeviceDialogOpen} onOpenChange={dialogs.handleEditDeviceDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名设备</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-base">
              当前设备：<span>{dialogs.editSession?.device_name}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              IP地址：{dialogs.editSession?.ip_address}
            </p>
          </div>

          <BaseForm
            form={editForm}
            fields={getDeviceNameFormFields()}
            layout="stack"
          />

          <div className="flex gap-3 mt-8">
            <Button
              variant="modern"
              onClick={() => dialogs.handleEditDeviceDialogChange(false)}
              className="flex-1"
              size="lg"
            >
              取消
            </Button>
            <LoadingButton
              onClick={onSubmit}
              isLoading={dialogs.editLoading}
              loadingText="处理中..."
              className="flex-1"
              size="lg"
            >
              确认修改
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 表格内容只切换三种边界：首屏加载、空态（含无数据或筛选结果为空）、正常表格。
function buildDeviceTableContent({
  isLoading,
  totalCount,
  filteredCount,
  globalFilter,
  hasFilter,
  table,
}: {
  isLoading: boolean
  totalCount: number
  filteredCount: number
  globalFilter: string
  hasFilter: boolean
  table: ReturnType<typeof useReactTable<SessionInfo>>
}) {
  if (isLoading && totalCount === 0) {
    return <TableLoadingState className="mx-6" />
  }

  if (filteredCount === 0) {
    return (
      <TableEmptyState
        searchKeyword={globalFilter}
        hasFilter={hasFilter}
        emptyText="暂无设备数据"
      />
    )
  }

  return (
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
            <tr key={row.id} className="border-b border-border hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
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
  )
}

function useDeviceTableModel({
  sessionData,
  globalFilter,
  isLoading,
  sorting,
  setSorting,
  currentDeviceId,
  handleOpenRenameDialog,
  handleOpenKickDialog,
}: {
  sessionData: SessionInfo[]
  globalFilter: string
  isLoading: boolean
  sorting: SortingState
  setSorting: (updater: SortingState | ((prev: SortingState) => SortingState)) => void
  currentDeviceId: string
  handleOpenRenameDialog: (session: SessionInfo) => void
  handleOpenKickDialog: (session: SessionInfo) => void
}) {
  // 先把当前设备置顶再交给 TanStack Table，确保过滤/排序前后“当前设备在最前”的体验一致。
  const sortedData = useMemo(
    () => sortSessionsByCurrentDevice(sessionData, currentDeviceId),
    [sessionData, currentDeviceId]
  )

  const filteredData = useMemo(() => {
    if (!globalFilter) {
      return sortedData
    }
    return sortedData.filter((session) =>
      containsSearchText(session.device_name, globalFilter) ||
      containsSearchText(session.ip_address, globalFilter)
    )
  }, [globalFilter, sortedData])

  const columns = useMemo(() => [
    columnHelper.accessor('device_name', {
      header: '设备名称',
      size: 150,
      cell: (info) => (
        <div className="flex items-center gap-2">
          <Laptop className="w-4 h-4 text-muted-foreground" />
          <span>
            <HighlightText text={info.getValue()} highlight={info.table.getState().globalFilter} />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('ip_address', {
      header: 'IP地址',
      size: 120,
      cell: (info) => (
        <span className="text-base">
          <HighlightText text={info.getValue()} highlight={info.table.getState().globalFilter} />
        </span>
      ),
    }),
    columnHelper.accessor('last_active_at', {
      header: '最近活跃',
      size: 150,
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.accessor('created_at', {
      header: '首次登录',
      size: 150,
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.display({
      id: 'status',
      header: '状态',
      size: 80,
      cell: (info) => {
        const isCurrent = info.row.original.device_id === currentDeviceId
        return <StatusBadge status={isCurrent ? 'current' : 'other'} />
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 140,
      cell: (info) => (
        <SessionActionCell
          session={info.row.original}
          currentDeviceId={currentDeviceId}
          onRename={handleOpenRenameDialog}
          onKick={handleOpenKickDialog}
        />
      ),
    }),
  ], [currentDeviceId, handleOpenKickDialog, handleOpenRenameDialog])

  // table 实例只在当前 hook 内使用，这里定点忽略编译器告警。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
      globalFilter,
    },
  })

  // displayCount 由“过滤后数量/总数”推导，和空态逻辑共用一套 hasFilter 判定口径。
  const filteredCount = filteredData.length
  const totalCount = sortedData.length
  const hasFilter = Boolean(globalFilter)
  const displayCount = getDeviceDisplayCount(filteredCount, totalCount, hasFilter)

  const tableContent = buildDeviceTableContent({
    isLoading,
    totalCount,
    filteredCount,
    globalFilter,
    hasFilter,
    table,
  })

  return {
    displayCount,
    tableContent,
  }
}

// 统一维护踢出、重命名和个人信息编辑弹窗的开关、loading、成功后刷新与关闭清理。
function useDeviceDialogState(
  editForm: ReturnType<typeof useForm<DeviceNameFormData>>,
  refetchSessions: () => void,
  setDialogState: (value: DeviceDialogMode | null) => void
) {
  const [editSession, setEditSession] = useState<SessionInfo | null>(null)
  const [editDeviceDialogOpen, setEditDeviceDialogOpen] = useState(false)
  const [kickSession, setKickSession] = useState<SessionInfo | null>(null)
  const [kickLoading, setKickLoading] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [kickAllLoading, setKickAllLoading] = useState(false)

  const handleOpenRenameDialog = useCallback((session: SessionInfo) => {
    setEditSession(session)
    editForm.setValue('device_name', session.device_name)
    setEditDeviceDialogOpen(true)
  }, [editForm])

  const handleOpenKickDialog = useCallback((session: SessionInfo) => {
    setKickSession(session)
    setDialogState('kick')
  }, [setDialogState])

  const handleKickDevice = useCallback(async () => {
    if (!kickSession) {
      return
    }

    setKickLoading(true)
    try {
      await sessionAPI.delete(kickSession.id)
      setDialogState(null)
      setKickSession(null)
      refetchSessions()
      toast.success('设备已踢出')
    } catch {
      toast.error('操作失败')
    } finally {
      setKickLoading(false)
    }
  }, [kickSession, refetchSessions, setDialogState])

  const handleKickAllDevices = useCallback(async () => {
    setKickAllLoading(true)
    try {
      // 后端会保留当前设备会话，这里只负责触发并刷新，不在前端自行过滤会话列表。
      await sessionAPI.deleteAll()
      setDialogState(null)
      refetchSessions()
      toast.success('已踢出所有其他设备')
    } catch {
      toast.error('操作失败')
    } finally {
      setKickAllLoading(false)
    }
  }, [refetchSessions, setDialogState])

  const handleKickDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogState(null)
      setKickSession(null)
    }
  }, [setDialogState])

  const handleEditDeviceDialogChange = useCallback((open: boolean) => {
    setEditDeviceDialogOpen(open)
    if (!open) {
      setEditSession(null)
      editForm.reset()
    }
  }, [editForm])

  const handleEditDeviceName = useCallback(async (formData: DeviceNameFormData) => {
    if (!editSession) {
      return
    }

    setEditLoading(true)
    try {
      await sessionAPI.update(editSession.id, { device_name: formData.device_name })
      setEditDeviceDialogOpen(false)
      refetchSessions()
      toast.success('设备名称已更新')
    } catch {
      toast.error('操作失败')
    } finally {
      setEditLoading(false)
    }
  }, [editSession, refetchSessions])

  return {
    editSession,
    editDeviceDialogOpen,
    kickSession,
    kickLoading,
    editDialogOpen,
    editLoading,
    kickAllLoading,
    setEditDialogOpen,
    handleOpenRenameDialog,
    handleOpenKickDialog,
    handleKickDevice,
    handleKickAllDevices,
    handleKickDialogChange,
    handleEditDeviceDialogChange,
    handleEditDeviceName,
  }
}

export default function DeviceManagement() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [dialogState, setDialogState] = useDialogState<DeviceDialogMode>()
  const [logsLoading, setLogsLoading] = useState(false)
  const search = useDeviceSearchState()

  const editForm = useForm<DeviceNameFormData>({
    resolver: valibotResolver(DeviceNameSchema),
    defaultValues: defaultDeviceNameValues,
  })

  const { data: userData, refetch: refetchUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const response = await authAPI.getProfile()
      return response.data as User
    },
    enabled: true,
  })

  const { data: sessionData = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await sessionAPI.list()
      return response.data || []
    },
    placeholderData: keepPreviousData,
  })

  const refetchSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }, [queryClient])

  const dialogs = useDeviceDialogState(editForm, refetchSessions, setDialogState)

  const currentDeviceId = useMemo(() => getDeviceId(), [])
  const tableModel = useDeviceTableModel({
    sessionData,
    globalFilter: search.globalFilter,
    isLoading,
    sorting,
    setSorting,
    currentDeviceId,
    handleOpenRenameDialog: dialogs.handleOpenRenameDialog,
    handleOpenKickDialog: dialogs.handleOpenKickDialog,
  })

  const handleRefresh = async () => {
    try {
      await sessionAPI.refresh()
      refetchSessions()
      toast.success('会话已刷新')
    } catch {
      toast.error('刷新失败')
    }
  }

  const canViewLogs = userData?.role === UserRoles.ADMIN || userData?.role === UserRoles.USER

  const handleViewLogs = useCallback(async () => {
    if (!userData || !canViewLogs) {
      return
    }

    setLogsLoading(true)
    try {
      const response = await userAdminAPI.generateLogsToken(userData.id)
      navigate('/logs', { state: { logsToken: response.data.token, backPath: '/devices' } })
    } catch (error) {
      toast.error(getApiErrorMessage(error, '获取日志访问失败'))
    } finally {
      setLogsLoading(false)
    }
  }, [canViewLogs, navigate, userData])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">个人账户</h1>
        <div className="flex flex-wrap gap-2">
          {canViewLogs && (
            <Button onClick={handleViewLogs} size="lg" variant="modern" disabled={logsLoading}>
              {logsLoading ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-1.5" />
              )}
              查看日志
            </Button>
          )}
          <Button onClick={() => dialogs.setEditDialogOpen(true)} size="lg" variant="modern">
            <Edit className="w-4 h-4 mr-1.5" />
            修改信息
          </Button>
          <Button onClick={handleRefresh} size="lg" variant="modern">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新会话
          </Button>
          <Button onClick={() => setDialogState('kickAll')} size="lg" variant="destructive">
            <LogOut className="w-4 h-4 mr-1.5" />
            踢出其他设备
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <TableSearchInput
          value={search.inputValue}
          onChange={search.setInputValue}
          placeholder="搜索设备名称、IP地址..."
          inputClassName="h-10"
        />
      </div>

      <DeviceTableCard tableModel={tableModel} />

      <KickDeviceDialog dialogState={dialogState} dialogs={dialogs} />

      <KickAllDevicesDialog dialogState={dialogState} dialogs={dialogs} />

      <EditDeviceNameDialog
        dialogs={dialogs}
        editForm={editForm}
        onSubmit={editForm.handleSubmit(dialogs.handleEditDeviceName)}
      />

      <UserEditDialog
        open={dialogs.editDialogOpen}
        onOpenChange={dialogs.setEditDialogOpen}
        user={userData || null}
        mode="profile"
        onSuccess={refetchUser}
      />

      <div className="text-sm text-muted-foreground">
        <p>当前设备会显示"当前设备"标签，其他设备可以手动踢出。</p>
        <p>会话过期后会自动失效。</p>
      </div>
    </div>
  )
}
