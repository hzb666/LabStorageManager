/**
 * 账户管理页面
 * 用户可以查看和管理自己的账户信息、头像、密码，以及查看和管理登录设备
 */
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import StatusBadge from '@/components/ui/StatusBadge'
import { sessionAPI, authAPI, type SessionInfo } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { formatDateTime } from '@/lib/utils'
import { getDeviceId } from '@/lib/deviceId'
import { type User } from '@/lib/constants'
import useDialogState from '@/hooks/useDialogState'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import {
  Search,
  Laptop,
  Loader2,
  Trash2,
  RefreshCw,
  LogOut,
  Shield,
  Edit,
  X,
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


const columnHelper = createColumnHelper<SessionInfo>()

export default function DeviceManagement() {
  const logout = useAuthStore((state) => state.logout)
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  // Dialog state - 支持 kick/kickAll
  const [dialogState, setDialogState] = useDialogState<"kick" | "kickAll">()

  // 编辑设备名称相关状态
  const [editSession, setEditSession] = useState<SessionInfo | null>(null)
  const [editDeviceDialogOpen, setEditDeviceDialogOpen] = useState(false)
  const [kickSession, setKickSession] = useState<SessionInfo | null>(null)
  const [kickLoading, setKickLoading] = useState(false)

  // 编辑用户信息弹窗状态
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const [editLoading, setEditLoading] = useState(false)

  // 设备名称表单
  const editForm = useForm<DeviceNameFormData>({
    resolver: valibotResolver(DeviceNameSchema),
    defaultValues: defaultDeviceNameValues
  })

  // Kick all devices
  const [kickAllLoading, setKickAllLoading] = useState(false)

  // ========== 用户信息相关状态 ==========
  // 使用 React Query 获取当前用户信息
  const { data: userData, refetch: refetchUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const response = await authAPI.getProfile()
      return response.data as User
    },
    enabled: true,
  })

  // 使用 React Query 获取会话数据，配合 keepPreviousData 避免闪烁
  const { data: sessionData = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await sessionAPI.list()
      return response.data || []
    },
    placeholderData: keepPreviousData,
  })

  // 为了兼容性，保留 data 变量
  const data = sessionData

  // 刷新数据函数
  const refetchSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }, [queryClient])

  // Determine current device (first one is most recent)
  const currentDeviceId = useMemo(() => {
    return getDeviceId()
  }, [])

  // Table columns
  const columns = useMemo(() => [
    columnHelper.accessor('device_name', {
      header: '设备名称',
      size: 150,
      cell: info => (
        <div className="flex items-center gap-2">
          <Laptop className="w-4 h-4 text-muted-foreground" />
          <span>{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor('ip_address', {
      header: 'IP地址',
      size: 120,
      cell: info => (
        <span className="text-base">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor('last_active_at', {
      header: '最近活跃',
      size: 150,
      cell: info => formatDateTime(info.getValue()),
    }),
    columnHelper.accessor('created_at', {
      header: '首次登录',
      size: 150,
      cell: info => formatDateTime(info.getValue()),
    }),
    columnHelper.display({
      id: 'status',
      header: '状态',
      size: 80,
      cell: info => {
        const session = info.row.original
        const isCurrent = session.device_id === currentDeviceId
        return <StatusBadge status={isCurrent ? 'current' : 'other'} />
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 140,
      cell: info => {
        const session = info.row.original
        const isCurrent = session.device_id === currentDeviceId

        return (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditSession(session)
                    editForm.setValue('device_name', session.device_name)
                    setEditDeviceDialogOpen(true)
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
                    variant="morden"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation()
                      openKickModal(session)
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
      },
    }),
  ], [currentDeviceId])

  // 排序数据：当前设备置顶
  const sortedData = useMemo((): SessionInfo[] => {
    if (!data || data.length === 0) return []
    const current = data.filter((d: SessionInfo) => d.device_id === currentDeviceId)
    const others = data.filter((d: SessionInfo) => d.device_id !== currentDeviceId)
    return [...current, ...others]
  }, [data, currentDeviceId])

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

  // ========== 设备管理相关函数 ==========
  // Kick single device handlers
  const openKickModal = (session: SessionInfo) => {
    setKickSession(session)
    setDialogState('kick')
  }

  const handleKickDevice = async () => {
    if (!kickSession) return

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
  }

  // Kick all devices handlers
  const openKickAllModal = () => {
    setDialogState('kickAll')
  }

  const handleKickAllDevices = async () => {
    setKickAllLoading(true)
    try {
      await sessionAPI.deleteAll()
      setDialogState(null)
      refetchSessions()
      // Redirect to login
      logout()
      toast.success('已踢出所有其他设备，请重新登录')
    } catch {
      toast.error('操作失败')
    } finally {
      setKickAllLoading(false)
    }
  }

  // Refresh sessions
  const handleRefresh = async () => {
    try {
      await sessionAPI.refresh()
      refetchSessions()
      toast.success('会话已刷新')
    } catch {
      toast.error('刷新失败')
    }
  }

  // 关闭弹窗
  const handleModalClose = (open: boolean) => {
    if (!open) {
      setDialogState(null)
      setKickSession(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* 标题和按钮 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">个人账户</h1>
        <div className="flex gap-2">
          <Button onClick={() => setEditDialogOpen(true)} size="lg" variant="morden">
            <Edit className="w-4 h-4 mr-1.5" />
            修改信息
          </Button>
          <Button onClick={handleRefresh} size="lg" variant="morden">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新会话
          </Button>
          <Button onClick={openKickAllModal} size="lg" variant="destructive">
            <LogOut className="w-4 h-4 mr-1.5" />
            踢出所有其他设备
          </Button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            placeholder="搜索设备名称、IP地址..."
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
      </div>

      {/* 设备列表 */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
            <Laptop className="w-5 h-5" />
            设备列表 <span className="text-muted-foreground font-normal">(&thinsp;{data.length}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无设备数据
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
      </Card>

      {/* Kick Single Device Modal */}
      <Dialog open={dialogState === 'kick'} onOpenChange={handleModalClose}>
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
            <Button variant="destructive" className="flex-1 border border-destructive" onClick={handleKickDevice} disabled={kickLoading} size="lg">
              {kickLoading ? '处理中...' : '确认踢出'}
            </Button>
            <Button variant="morden" onClick={() => setDialogState(null)} size="lg" className="text-base flex-1">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kick All Devices Modal */}
      <Dialog open={dialogState === 'kickAll'} onOpenChange={handleModalClose}>
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
            <Button variant="destructive" className="flex-1 border border-destructive" onClick={handleKickAllDevices} disabled={kickAllLoading} size="lg">
              {kickAllLoading ? '处理中...' : '确认踢出'}
            </Button>
            <Button variant="morden" onClick={() => setDialogState(null)} size="lg" className="text-base flex-1">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Device Name Dialog */}
      <Dialog
        open={editDeviceDialogOpen}
        onOpenChange={(open) => {
          setEditDeviceDialogOpen(open)
          if (!open) {
            setEditSession(null)
            editForm.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名设备</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-base">
                当前设备：<span className="font-medium">{editSession?.device_name}</span>
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
                variant="morden"
                onClick={() => setEditDeviceDialogOpen(false)}
                className="flex-1"
                size="lg"
              >
                取消
              </Button>
              <LoadingButton
                onClick={editForm.handleSubmit(async (formData) => {
                  if (!editSession) return

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
                })}
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

      {/* Edit User Modal */}
      <UserEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        user={userData || null}
        mode="profile"
        onSuccess={() => refetchUser()}
      />

      {/* Info note */}
      <div className="text-sm text-muted-foreground">
        <p>当前设备会显示"当前设备"标签，其他设备可以手动踢出。</p>
        <p>会话过期后会自动失效。</p>
      </div>
    </div>
  )
}
