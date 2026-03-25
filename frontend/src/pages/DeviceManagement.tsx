/**
 * 账户管理页面
 * 用户可以查看和管理自己的账户信息、头像、密码，以及查看和管理登录设备
 */
import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import StatusBadge from '@/components/ui/StatusBadge'
import { sessionAPI, authAPI, type SessionInfo } from '@/api/client'
import { formatDateTime } from '@/lib/utils'
import { getDeviceId } from '@/lib/deviceId'
import { type User } from '@/lib/constants'
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
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { UserEditDialog } from '@/components/UserEditDialog'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { DeviceNameSchema, type DeviceNameFormData } from '@/lib/validationSchemas'
import { defaultDeviceNameValues, getDeviceNameFormFields } from '@/lib/formConfigs'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { BaseForm } from '@/components/BaseForm'
import { SEARCH_MAX_LENGTH, TableEmptyState, TableSearchInput } from '@/components/ui/TableFilters'
import { HighlightText } from '@/components/ui/HighlightText'

/**
 * 表格列构建器，统一生成设备会话表格的列定义。
 * 存在原因是集中管理列 accessor 与渲染配置，减少重复声明并保持类型安全。
 */
const columnHelper = createColumnHelper<SessionInfo>()

/**
 * 设备相关弹窗模式类型，标识当前是踢出单个设备还是踢出全部其他设备。
 * 存在原因是用联合字面量约束状态取值，避免字符串散落导致的状态分支错误。
 */
type DeviceDialogMode = 'kick' | 'kickAll'

/**
 * 设备行操作区组件的入参定义。
 * 存在原因是明确当前行数据和操作回调契约，保证重命名/踢出按钮行为一致。
 */
interface SessionActionCellProps {
  session: SessionInfo
  currentDeviceId: string
  onRename: (session: SessionInfo) => void
  onKick: (session: SessionInfo) => void
}

/**
 * 设备列表卡片组件的入参定义。
 * 存在原因是把计数展示和表格内容作为显式依赖传入，便于容器组件解耦。
 */
interface DeviceTableCardProps {
  displayCount: string
  tableContent: ReactNode
}

/**
 * 踢出单个设备确认弹窗的入参定义。
 * 存在原因是统一弹窗开关、加载态和确认取消回调，避免弹窗行为不一致。
 */
interface KickDeviceDialogProps {
  open: boolean
  kickSession: SessionInfo | null
  kickLoading: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 踢出所有其他设备确认弹窗的入参定义。
 * 存在原因是集中声明批量踢出流程所需状态与回调，提升可维护性。
 */
interface KickAllDevicesDialogProps {
  open: boolean
  kickAllLoading: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 设备重命名弹窗的入参定义。
 * 存在原因是明确表单实例与提交动作的输入契约，防止组件调用方遗漏关键参数。
 */
interface EditDeviceNameDialogProps {
  open: boolean
  editSession: SessionInfo | null
  editForm: ReturnType<typeof useForm<DeviceNameFormData>>
  editLoading: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}

/**
 * 设备搜索状态结构定义。
 * 存在原因是统一搜索输入与过滤值的状态形状，便于自定义 Hook 对外暴露稳定接口。
 */
interface DeviceSearchState {
  inputValue: string
  globalFilter: string
  setInputValue: (value: string) => void
  setGlobalFilter: (value: string) => void
}

/**
 * 设备弹窗与操作流程状态结构定义。
 * 存在原因是集中描述踢出/重命名相关状态与方法，降低主组件对细节状态的耦合。
 */
interface DeviceDialogState {
  editSession: SessionInfo | null
  editDeviceDialogOpen: boolean
  kickSession: SessionInfo | null
  kickLoading: boolean
  editDialogOpen: boolean
  editLoading: boolean
  kickAllLoading: boolean
  setEditDialogOpen: (open: boolean) => void
  handleOpenRenameDialog: (session: SessionInfo) => void
  handleOpenKickDialog: (session: SessionInfo) => void
  handleKickDevice: () => Promise<void>
  handleKickAllDevices: () => Promise<void>
  handleKickDialogChange: (open: boolean) => void
  handleEditDeviceDialogChange: (open: boolean) => void
  handleEditDeviceName: (formData: DeviceNameFormData) => Promise<void>
}

/**
 * 设备表格展示模型定义。
 * 存在原因是统一表格展示所需的计数与内容字段，简化页面层的数据消费方式。
 */
interface DeviceTableModel {
  displayCount: string
  tableContent: ReactNode
}

/**
 * 设备管理展示层组件的入参定义。
 * 存在原因是把页面展示依赖显式化，确保主编排层与展示层职责边界清晰。
 */
interface DeviceManagementContentProps {
  inputValue: string
  displayCount: string
  tableContent: ReactNode
  dialogState: DeviceDialogMode | null
  kickSession: SessionInfo | null
  kickLoading: boolean
  kickAllLoading: boolean
  editSession: SessionInfo | null
  editDeviceDialogOpen: boolean
  editForm: ReturnType<typeof useForm<DeviceNameFormData>>
  editLoading: boolean
  editDialogOpen: boolean
  userData: User | null | undefined
  onInputChange: (value: string) => void
  onSetDialogState: (value: DeviceDialogMode | null) => void
  onRefresh: () => Promise<void>
  onKickDialogChange: (open: boolean) => void
  onKickConfirm: () => Promise<void>
  onKickAllConfirm: () => Promise<void>
  onEditDeviceDialogChange: (open: boolean) => void
  onEditDeviceSubmit: () => void
  onEditDialogOpenChange: (open: boolean) => void
  onRefetchUser: () => void
}

/**
 * 维护设备管理页的搜索输入与防抖筛选值。
 * 这个函数存在是为了把搜索状态从主页面中拆出，缩短主函数长度并保留现有交互。
 */
function useDeviceSearchState(): DeviceSearchState {
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

/**
 * 对设备列表进行排序，保证当前设备始终显示在最前面。
 * 这个函数存在是为了把排序规则从页面主体中抽离，避免主组件承担数据编排细节。
 */
function sortSessionsByCurrentDevice(data: SessionInfo[], currentDeviceId: string) {
  const current = data.filter((session) => session.device_id === currentDeviceId)
  const others = data.filter((session) => session.device_id !== currentDeviceId)
  return [...current, ...others]
}

/**
 * 计算设备列表展示计数，保持过滤后数量和总量的显示规则一致。
 * 这个函数存在是为了复用计数文案逻辑，并压缩主组件中的分支数量。
 */
function getDeviceDisplayCount(filteredCount: number, totalCount: number, hasFilter: boolean) {
  const shouldShowGrandTotal = hasFilter && totalCount > 0 && filteredCount !== totalCount
  return shouldShowGrandTotal ? `${filteredCount}/${totalCount}` : `${filteredCount}`
}

/**
 * 渲染单个设备行的操作按钮。
 * 这个函数存在是为了把表格操作区从列定义中拆出来，降低列配置噪音。
 */
function SessionActionCell({
  session,
  currentDeviceId,
  onRename,
  onKick,
}: SessionActionCellProps) {
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

/**
 * 渲染设备列表卡片容器。
 * 这个函数存在是为了把设备表格区块从页面主体中拆开，减少页面主函数长度。
 */
function DeviceTableCard({ displayCount, tableContent }: DeviceTableCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Laptop className="w-5 h-5" />
          设备列表
          <span className="text-muted-foreground font-normal">(&thinsp;{displayCount}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {tableContent}
      </CardContent>
    </Card>
  )
}

/**
 * 渲染踢出单个设备的确认弹窗。
 * 这个函数存在是为了让页面主组件只保留状态编排，而不直接承载整段弹窗结构。
 */
function KickDeviceDialog({
  open,
  kickSession,
  kickLoading,
  onOpenChange,
  onConfirm,
  onCancel,
}: KickDeviceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center mb-6">确认踢出设备</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p>确定要踢出设备 <strong>{kickSession?.device_name}</strong> 吗？</p>
          <p className="text-sm text-muted-foreground">
            IP地址：{kickSession?.ip_address}
          </p>
          <p className="text-base text-destructive">
            该设备将被迫下线，需要重新登录。
          </p>
        </div>
        <div className="flex gap-3 mt-6">
          <Button
            variant="destructive"
            className="flex-1 border border-destructive"
            onClick={onConfirm}
            disabled={kickLoading}
            size="lg"
          >
            {kickLoading ? '处理中...' : '确认踢出'}
          </Button>
          <Button variant="modern" onClick={onCancel} size="lg" className="text-base flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染踢出其他设备的确认弹窗。
 * 这个函数存在是为了复用确认交互结构，并缩短页面主组件的 JSX 长度。
 */
function KickAllDevicesDialog({
  open,
  kickAllLoading,
  onOpenChange,
  onConfirm,
  onCancel,
}: KickAllDevicesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={onConfirm}
            disabled={kickAllLoading}
            size="lg"
          >
            {kickAllLoading ? '处理中...' : '确认踢出'}
          </Button>
          <Button variant="modern" onClick={onCancel} size="lg" className="text-base flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染设备重命名弹窗。
 * 这个函数存在是为了将设备名编辑表单从主页面中抽离，避免主组件行数继续膨胀。
 */
function EditDeviceNameDialog({
  open,
  editSession,
  editForm,
  editLoading,
  onOpenChange,
  onSubmit,
}: EditDeviceNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名设备</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-base">
              当前设备：<span>{editSession?.device_name}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              IP地址：{editSession?.ip_address}
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
              onClick={() => onOpenChange(false)}
              className="flex-1"
              size="lg"
            >
              取消
            </Button>
            <LoadingButton
              onClick={onSubmit}
              isLoading={editLoading}
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

/**
 * 构建设备列表表格区域内容，保持加载态、空态和表格展示规则一致。
 * 这个函数存在是为了把大段表格 JSX 从表格模型 hook 中拆出，降低单函数行数。
 */
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
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
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

/**
 * 构建设备管理页的表格模型和展示内容。
 * 这个函数存在是为了把表格列、表实例和表格区块从主页面中抽离，降低主函数长度。
 */
function useDeviceTableModel({
  sessionData,
  globalFilter,
  isLoading,
  sorting,
  setSorting,
  setGlobalFilter,
  currentDeviceId,
  handleOpenRenameDialog,
  handleOpenKickDialog,
}: {
  sessionData: SessionInfo[]
  globalFilter: string
  isLoading: boolean
  sorting: SortingState
  setSorting: (updater: SortingState) => void
  setGlobalFilter: (value: string) => void
  currentDeviceId: string
  handleOpenRenameDialog: (session: SessionInfo) => void
  handleOpenKickDialog: (session: SessionInfo) => void
}): DeviceTableModel {
  const sortedData = useMemo(
    () => sortSessionsByCurrentDevice(sessionData, currentDeviceId),
    [sessionData, currentDeviceId]
  )

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

  const table = useReactTable({
    data: sortedData,
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

  const filteredRows = table.getRowModel().rows
  const filteredCount = filteredRows.length
  const totalCount = sortedData.length
  const hasFilter = Boolean(globalFilter)
  const displayCount = getDeviceDisplayCount(filteredCount, totalCount, hasFilter)

  const tableContent = useMemo(() => {
    return buildDeviceTableContent({
      isLoading,
      totalCount,
      filteredCount,
      globalFilter,
      hasFilter,
      table,
    })
  }, [filteredCount, globalFilter, hasFilter, isLoading, table, totalCount])

  return {
    displayCount,
    tableContent,
  }
}

/**
 * 维护设备管理页的弹窗状态和设备操作流程。
 * 这个函数存在是为了把踢出设备、重命名设备等副作用从主页面中抽离。
 */
function useDeviceDialogState(
  editForm: ReturnType<typeof useForm<DeviceNameFormData>>,
  refetchSessions: () => void,
  setDialogState: (value: DeviceDialogMode | null) => void
): DeviceDialogState {
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

/**
 * 渲染设备管理页主体结构。
 * 这个函数存在是为了把展示层从主页面中拆出，让主页面只保留状态和数据编排。
 */
function DeviceManagementContent({
  inputValue,
  displayCount,
  tableContent,
  dialogState,
  kickSession,
  kickLoading,
  kickAllLoading,
  editSession,
  editDeviceDialogOpen,
  editForm,
  editLoading,
  editDialogOpen,
  userData,
  onInputChange,
  onSetDialogState,
  onRefresh,
  onKickDialogChange,
  onKickConfirm,
  onKickAllConfirm,
  onEditDeviceDialogChange,
  onEditDeviceSubmit,
  onEditDialogOpenChange,
  onRefetchUser,
}: DeviceManagementContentProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">个人账户</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onEditDialogOpenChange(true)} size="lg" variant="modern">
            <Edit className="w-4 h-4 mr-1.5" />
            修改信息
          </Button>
          <Button onClick={onRefresh} size="lg" variant="modern">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新会话
          </Button>
          <Button onClick={() => onSetDialogState('kickAll')} size="lg" variant="destructive">
            <LogOut className="w-4 h-4 mr-1.5" />
            踢出其他设备
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <TableSearchInput
          value={inputValue}
          onChange={onInputChange}
          placeholder="搜索设备名称、IP地址..."
          inputClassName="h-10"
        />
      </div>

      <DeviceTableCard
        displayCount={displayCount}
        tableContent={tableContent}
      />

      <KickDeviceDialog
        open={dialogState === 'kick'}
        kickSession={kickSession}
        kickLoading={kickLoading}
        onOpenChange={onKickDialogChange}
        onConfirm={onKickConfirm}
        onCancel={() => onKickDialogChange(false)}
      />

      <KickAllDevicesDialog
        open={dialogState === 'kickAll'}
        kickAllLoading={kickAllLoading}
        onOpenChange={onKickDialogChange}
        onConfirm={onKickAllConfirm}
        onCancel={() => onKickDialogChange(false)}
      />

      <EditDeviceNameDialog
        open={editDeviceDialogOpen}
        editSession={editSession}
        editForm={editForm}
        editLoading={editLoading}
        onOpenChange={onEditDeviceDialogChange}
        onSubmit={onEditDeviceSubmit}
      />

      <UserEditDialog
        open={editDialogOpen}
        onOpenChange={onEditDialogOpenChange}
        user={userData || null}
        mode="profile"
        onSuccess={onRefetchUser}
      />

      <div className="text-sm text-muted-foreground">
        <p>当前设备会显示"当前设备"标签，其他设备可以手动踢出。</p>
        <p>会话过期后会自动失效。</p>
      </div>
    </div>
  )
}

/**
 * 设备管理页负责会话列表、踢出设备和重命名设备的编排。
 * 这个函数存在是为了保持账户相关行为不变的前提下，收缩页面主函数的结构复杂度。
 */
export default function DeviceManagement() {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [dialogState, setDialogState] = useDialogState<DeviceDialogMode>()
  const { inputValue, globalFilter, setInputValue, setGlobalFilter } = useDeviceSearchState()

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

  const {
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
  } = useDeviceDialogState(editForm, refetchSessions, setDialogState)

  const currentDeviceId = useMemo(() => getDeviceId(), [])
  const { displayCount, tableContent } = useDeviceTableModel({
    sessionData,
    globalFilter,
    isLoading,
    sorting,
    setSorting,
    setGlobalFilter,
    currentDeviceId,
    handleOpenRenameDialog,
    handleOpenKickDialog,
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

  return (
    <DeviceManagementContent
      inputValue={inputValue}
      displayCount={displayCount}
      tableContent={tableContent}
      dialogState={dialogState}
      kickSession={kickSession}
      kickLoading={kickLoading}
      kickAllLoading={kickAllLoading}
      editSession={editSession}
      editDeviceDialogOpen={editDeviceDialogOpen}
      editForm={editForm}
      editLoading={editLoading}
      editDialogOpen={editDialogOpen}
      userData={userData}
      onInputChange={setInputValue}
      onSetDialogState={setDialogState}
      onRefresh={handleRefresh}
      onKickDialogChange={handleKickDialogChange}
      onKickConfirm={handleKickDevice}
      onKickAllConfirm={handleKickAllDevices}
      onEditDeviceDialogChange={handleEditDeviceDialogChange}
      onEditDeviceSubmit={editForm.handleSubmit(handleEditDeviceName)}
      onEditDialogOpenChange={setEditDialogOpen}
      onRefetchUser={refetchUser}
    />
  )
}
