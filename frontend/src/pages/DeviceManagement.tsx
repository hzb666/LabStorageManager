/**
 * 设备管理页面
 * 用户可以查看和管理自己的登录设备
 */
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
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import StatusBadge from '@/components/ui/StatusBadge'
import { sessionAPI, type SessionInfo } from '@/api/client'
import { useAuthStore } from '@/store/useStore'
import { formatDateTime } from '@/lib/utils'
import useDialogState from '@/hooks/useDialogState'
import {
  Search,
  Laptop,
  Loader2,
  Trash2,
  RefreshCw,
  X,
  LogOut,
  Shield,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'

const columnHelper = createColumnHelper<SessionInfo>()

export default function DeviceManagement() {
  const logout = useAuthStore((state) => state.logout)
  const [data, setData] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  // Dialog state
  const [dialogState, setDialogState] = useDialogState<"kick" | "kickAll">()

  // Kick single device
  const [kickSession, setKickSession] = useState<SessionInfo | null>(null)
  const [kickLoading, setKickLoading] = useState(false)

  // Kick all devices
  const [kickAllLoading, setKickAllLoading] = useState(false)

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const response = await sessionAPI.list()
      console.log('Sessions response:', response)
      setData(response.data || [])
    } catch (error) {
      console.error('Failed to load sessions:', error)
      toast.error('加载设备列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Determine current device (first one is most recent)
  const currentDeviceId = useMemo(() => {
    if (data.length > 0) return data[0].id
    return null
  }, [data])

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
      size: 130,
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
        const isCurrent = session.id === currentDeviceId
        return <StatusBadge status={isCurrent ? 'current' : 'other'} />
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 100,
      cell: info => {
        const session = info.row.original
        const isCurrent = session.id === currentDeviceId
        
        return (
          <div className="flex items-center gap-1">
            {!isCurrent && (
              <Button
                variant="morden"
                size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="踢出设备"
                onClick={(e) => {
                  e.stopPropagation()
                  openKickModal(session)
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )
      },
    }),
  ], [currentDeviceId])

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
      fetchSessions()
      toast.success('设备已踢出')
    } catch (error) {
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
      fetchSessions()
      // Redirect to login
      logout()
      toast.success('已踢出所有其他设备，请重新登录')
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setKickAllLoading(false)
    }
  }

  // Refresh sessions
  const handleRefresh = async () => {
    try {
      await sessionAPI.refresh()
      fetchSessions()
      toast.success('会话已刷新')
    } catch {
      toast.error('刷新失败')
    }
  }

  // Close create modal
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
        <h1 className="text-3xl font-bold text-primary">设备管理</h1>
        <div className="flex gap-2">
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

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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

      {/* Devices Table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg 设备列表">
            <Laptop className="w-5 h-5" />
            设备列表 <span className="text-muted-foreground font-normal">(&thinsp;{data.length}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Loading indicator */}
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

      {/* Info note */}
      <div className="text-sm text-muted-foreground">
        <p>当前设备会显示"当前设备"标签，其他设备可以手动踢出。</p>
        <p>会话过期后会自动失效。</p>
      </div>
    </div>
  )
}
