// OperationLogs.tsx
/**
 * 用户操作日志页面
 * 使用 FilterTable 架构，与库存页面完全一致
 */
import { useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'

// UI 组件
import { Button } from '@/components/ui/Button'
import { FilterTable } from '@/components/ui/FilterTable'
import { StatusBadge } from '@/components/ui/StatusBadge'

// 图标
import { ArrowLeft, FileText } from 'lucide-react'

// API & 类型
import { createLogsAPI, type LogItem } from '@/api/client'
import { api } from '@/api/client'
import type { FilterAPI } from '@/hooks/useTableState'
import { safeString } from '@/lib/validationSchemas'

// 类型定义
interface LogItemData extends LogItem {
  id?: number
}

// 日志类型选项（用于筛选）
const LOG_TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'reagent_order', label: '试剂订单' },
  { value: 'consumable_order', label: '耗材订单' },
  { value: 'inventory', label: '入库记录' },
  { value: 'borrow', label: '借用记录' },
  { value: 'session', label: '登录记录' }
]

// 格式化时间
const formatTime = (time: string | null) => {
  if (!time) return '-'
  try {
    return new Date(time).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    })
  } catch {
    return time
  }
}

// 格式化日期时间（带秒）
const formatDateTime = (time: string | null) => {
  if (!time) return '-'
  try {
    return new Date(time).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Shanghai',
    })
  } catch {
    return time
  }
}

// 列配置
const columnHelper = createColumnHelper<LogItemData>()

const getLogColumns = () => [
  columnHelper.accessor('time', {
    id: 'time',
    header: '时间',
    enableSorting: false,
    size: 180,
    minSize: 150,
    cell: info => (
      <span>{formatTime(info.getValue())}</span>
    )
  }),
  columnHelper.accessor('type', {
    id: 'type',
    header: '类型',
    enableSorting: false,
    size: 100,
    minSize: 80,
    cell: info => (
      <StatusBadge status={info.getValue()} />
    )
  }),
  columnHelper.accessor('detail', {
    id: 'detail',
    header: '详情',
    enableSorting: false,
    size: 500,
    minSize: 400,
    cell: info => (
      <span>{info.getValue()}</span>
    )
  })
]

// 渲染展开行的表格（显示完整数据）
const renderExpandedTable = (fullData: Record<string, unknown>, type: string) => {
  if (!fullData) return null

  // 根据不同类型显示不同的表格内容
  switch (type) {
    case 'borrow':
      // 借用记录：显示借了多少、是否已归还、归还多少
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-4 flex-1">
          <div><span className="text-muted-foreground">物品名称：</span>{safeString(fullData.inventory_name)}</div>
          <div><span className="text-muted-foreground">CAS号：</span>{safeString(fullData.cas_number)}</div>
          <div><span className="text-muted-foreground">借用时数量：</span><span className="text-blue-600">{safeString(fullData.quantity_borrowed)} {safeString(fullData.unit)}</span></div>
          <div>
            <span className="text-muted-foreground">归还状态：</span>
            {fullData.is_returned ? (
              <span className="text-green-600">已归还 ({safeString(fullData.quantity_returned)} {safeString(fullData.unit)})</span>
            ) : (
              <span className="text-orange-600">未归还</span>
            )}
          </div>
          <div><span className="text-muted-foreground">借用时间：</span>{formatDateTime(fullData.borrow_time as string)}</div>
          <div><span className="text-muted-foreground">归还时间：</span>{fullData.return_time ? formatDateTime(fullData.return_time as string) : '-'}</div>
          <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{safeString(fullData.notes)}</div>
        </div>
      )

    case 'reagent_order':
      // 试剂订单
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 flex-1">
          <div><span className="text-muted-foreground">试剂名称：</span>{safeString(fullData.name)}</div>
          <div><span className="text-muted-foreground">CAS号：</span>{safeString(fullData.cas_number)}</div>
          <div><span className="text-muted-foreground">规格：</span>{safeString(fullData.specification)}</div>
          <div><span className="text-muted-foreground">数量：</span>{safeString(fullData.quantity)}</div>
          <div><span className="text-muted-foreground">品牌：</span>{safeString(fullData.brand)}</div>
          <div><span className="text-muted-foreground">价格：</span>{fullData.price ? `¥${safeString(fullData.price)}` : '-'}</div>
          <div><span className="text-muted-foreground">申购原因：</span>{safeString(fullData.order_reason)}</div>
          <div><span className="text-muted-foreground">状态：</span>{safeString(fullData.status)}</div>
          <div><span className="text-muted-foreground">类别：</span>{safeString(fullData.category)}</div>
          <div><span className="text-muted-foreground">创建时间：</span>{formatDateTime(fullData.created_at as string)}</div>
          <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{safeString(fullData.notes)}</div>
        </div>
      )

    case 'consumable_order':
      // 耗材订单
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 flex-1">
          <div><span className="text-muted-foreground">耗材名称：</span>{safeString(fullData.name)}</div>
          <div><span className="text-muted-foreground">规格：</span>{safeString(fullData.specification)}</div>
          <div><span className="text-muted-foreground">数量：</span>{safeString(fullData.quantity)}</div>
          <div><span className="text-muted-foreground">单位：</span>{safeString(fullData.unit)}</div>
          <div><span className="text-muted-foreground">品牌：</span>{safeString(fullData.brand)}</div>
          <div><span className="text-muted-foreground">价格：</span>{fullData.price ? `¥${safeString(fullData.price)}` : '-'}</div>
          <div><span className="text-muted-foreground">状态：</span>{safeString(fullData.status)}</div>
          <div><span className="text-muted-foreground">类别：</span>{safeString(fullData.category)}</div>
          <div><span className="text-muted-foreground">创建时间：</span>{formatDateTime(fullData.created_at as string)}</div>
          <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{safeString(fullData.notes)}</div>
        </div>
      )

    case 'inventory':
      // 入库记录
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 flex-1">
          <div><span className="text-muted-foreground">物品名称：</span>{safeString(fullData.name)}</div>
          <div><span className="text-muted-foreground">CAS号：</span>{safeString(fullData.cas_number)}</div>
          <div><span className="text-muted-foreground">入库数量：</span><span className="text-green-600">{safeString(fullData.initial_quantity)} {safeString(fullData.unit)}</span></div>
          <div><span className="text-muted-foreground">剩余数量：</span>{safeString(fullData.remaining_quantity)} {safeString(fullData.unit)}</div>
          <div><span className="text-muted-foreground">品牌：</span>{safeString(fullData.brand)}</div>
          <div><span className="text-muted-foreground">存放位置：</span>{safeString(fullData.storage_location)}</div>
          <div><span className="text-muted-foreground">状态：</span>{safeString(fullData.status)}</div>
          <div><span className="text-muted-foreground">内部编号：</span><span className="font-base">{safeString(fullData.internal_code)}</span></div>
          <div><span className="text-muted-foreground">类别：</span>{safeString(fullData.category)}</div>
          <div><span className="text-muted-foreground">创建时间：</span>{formatDateTime(fullData.created_at as string)}</div>
          <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{safeString(fullData.notes)}</div>
        </div>
      )

    case 'session':
      // 登录记录
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 flex-1">
          <div><span className="text-muted-foreground">设备名称：</span>{safeString(fullData.device_name)}</div>
          <div><span className="text-muted-foreground">设备ID：</span><span className="font-base text-sm">{safeString(fullData.device_id)}</span></div>
          <div><span className="text-muted-foreground">IP地址：</span>{safeString(fullData.ip_address)}</div>
          <div><span className="text-muted-foreground">最近IP：</span>{safeString(fullData.last_ip_address)}</div>
          <div className="col-span-2"><span className="text-muted-foreground">User-Agent：</span><span className="font-base text-sm truncate">{safeString(fullData.user_agent)}</span></div>
          <div><span className="text-muted-foreground">首次登录：</span>{formatDateTime(fullData.created_at as string)}</div>
          <div><span className="text-muted-foreground">最后活跃：</span>{formatDateTime(fullData.last_active_at as string)}</div>
          <div><span className="text-muted-foreground">过期时间：</span>{formatDateTime(fullData.expires_at as string)}</div>
        </div>
      )

    default:
      // 默认显示 JSON
      return (
        <pre className="text-sm bg-muted p-3 rounded-md overflow-x-auto">
          {JSON.stringify(fullData, null, 2)}
        </pre>
      )
  }
}

// 主组件
export default function OperationLogsPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  // 创建日志 API 实例
  const logsAPI = useMemo(() => {
    if (!token) return null
    return createLogsAPI(token)
  }, [token])

  // 使用 useQuery 获取用户名（不阻止页面显示，加载完成后更新标题）
  const { data: userInfo } = useQuery({
    queryKey: ['logs-user-info', token],
    queryFn: async () => {
      if (!token) return null
      const response = await api.get<{ username: string; user_id: number; total: number }>(`/admin/users/logs/${token}?skip=0&limit=0`)
      return response.data
    },
    enabled: !!token,
  })

  // TanStack Table 列配置
  const columns = useMemo(() => getLogColumns(), [])

  // 渲染展开行（使用 renderExpandedTable 显示完整数据）
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as LogItemData
    // 获取日志类型
    const type = item.type || 'unknown'
    // 获取完整数据
    const fullData = (item.full_data || item) as Record<string, unknown>
    
    return (
      <div className="p-4 flex flex-col md:flex-row gap-4 border-b border-border">
        {renderExpandedTable(fullData, type)}
      </div>
    )
  }, [])

  if (!token) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="morden" className="h-10" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          无效的访问令牌
        </div>
      </div>
    )
  }

  if (!logsAPI) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="morden" className="h-10" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 头部区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="morden" className="h-10" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
          <h1 className="text-3xl font-bold text-primary">
            操作日志
            {userInfo?.username ? `：${userInfo.username}` : ''}
          </h1>
        </div>
      </div>

      {/* 数据表格区域 - 使用 FilterTable */}
      <FilterTable
        api={logsAPI as FilterAPI}
        queryKey={['logs', token]}
        tableId="operation-logs"
        customColumns={columns as ColumnDef<Record<string, unknown>, unknown>[]}
        title={<><FileText className="w-5 h-5" /> 操作记录</>}
        searchPlaceholder="搜索详情..."
        statusOptions={LOG_TYPE_OPTIONS}
        defaultStatus="all"
        showFuzzySearch={false}
        searchFieldOptions={[
          { value: 'all', label: '全部' },
          { value: 'detail', label: '详情' }
        ]}
        defaultSearchField="all"
        renderExpandedRow={renderExpandedRow}
        scrollHeight="calc(100vh - 280px)"
        emptyText="暂无操作记录"
      />
    </div>
  )
}
