/** 用户操作日志页面。 */
import { useMemo, useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { FilterTable } from '@/components/ui/FilterTable'
import { HighlightText } from '@/components/ui/HighlightText'
import { StatusBadge } from '@/components/ui/StatusBadge'

// 图标
import { ArrowLeft, FileText } from 'lucide-react'

// API & 类型
import { createLogsAPI, type LogItem } from '@/api/client'
import { api } from '@/api/client'
import { OperationLogExpandedRow } from '@/components/OperationLogExpandedRow'
import {
  getLogTypeBadgeMeta,
  LOG_TYPE_OPTIONS,
  SEARCH_LOG_TYPE_OPTION,
} from '@/components/operation-logs/logTypeMeta'
import { getOperationLogDetailText } from '@/components/operation-logs/logSummaryText'
import type { FilterAPI } from '@/hooks/useTableState'
import { formatDateTime } from '@/lib/utils'

// 类型定义
interface LogItemData extends LogItem {
  id?: number
}

const getLogSummary = (item: LogItemData) => {
  return getOperationLogDetailText(item)
}

const LOG_SEARCH_FIELD_OPTIONS = [{ value: 'all', label: '全部' }]

function LogTypeBadge({ type }: Readonly<{ type: string }>) {
  const meta = getLogTypeBadgeMeta(type)
  return <StatusBadge status={meta.label} color={meta.color} />
}

function SearchLogsToggle({
  checked,
  onCheckedChange,
}: Readonly<{
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}>) {
  return (
    <label className="flex h-10 items-center gap-2 whitespace-nowrap px-1 text-base">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>显示搜索日志</span>
    </label>
  )
}

// 格式化时间
const formatTime = (time: string | null) => {
  if (!time) return '-'
  try {
    return formatDateTime(time)
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
      <LogTypeBadge type={info.getValue()} />
    )
  }),
  columnHelper.accessor('detail', {
    id: 'detail',
    header: '详情',
    enableSorting: false,
    size: 500,
    minSize: 400,
    cell: info => (
      <HighlightText
        text={getLogSummary(info.row.original)}
        highlight={info.table.getState().globalFilter}
        matchMode={info.table.options.meta?.matchMode}
      />
    )
  })
]

// 主组件
export default function OperationLogsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [includeSearchLogs, setIncludeSearchLogs] = useState(false)

  const locationState = location.state as { logsToken?: string; backPath?: string } | null
  const stateTokenRaw = locationState?.logsToken
  const stateToken = typeof stateTokenRaw === 'string' ? stateTokenRaw.trim() : ''
  const fallbackBackPath = location.pathname.startsWith('/admin') ? '/admin/users' : '/devices'
  const backPath = typeof locationState?.backPath === 'string' ? locationState.backPath : fallbackBackPath

  const token = useMemo(() => stateToken, [stateToken])

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
      const response = await api.post<{ username: string; user_id: number; total: number }>('/admin/users/logs/query', {
        token,
        skip: 0,
        limit: 0,
      })
      return response.data
    },
    enabled: !!token,
  })

  // TanStack Table 列配置
  const columns = useMemo(() => getLogColumns(), [])
  const statusOptions = useMemo(() => {
    return includeSearchLogs
      ? [...LOG_TYPE_OPTIONS, SEARCH_LOG_TYPE_OPTION]
      : LOG_TYPE_OPTIONS
  }, [includeSearchLogs])
  const extraParams = useMemo(() => {
    return includeSearchLogs ? { include_search_logs: true } : {}
  }, [includeSearchLogs])

  // 渲染展开行
  const renderExpandedRow = useCallback((itemRaw: Record<string, unknown>) => {
    const item = itemRaw as unknown as LogItemData
    return <OperationLogExpandedRow item={item} />
  }, [])

  if (!token) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="modern" className="h-10" onClick={() => navigate(backPath)}>
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
          <Button variant="modern" className="h-10" onClick={() => navigate(backPath)}>
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
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button variant="modern" className="h-10 shrink-0" onClick={() => navigate(backPath)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
          <h1 className="min-w-0 text-2xl font-bold text-primary sm:text-3xl">
            操作日志
            {userInfo?.username ? `：${userInfo.username}` : ''}
          </h1>
        </div>
      </div>

      {/* 数据表格区域 - 使用 FilterTable */}
      <FilterTable
        api={logsAPI as FilterAPI}
        queryKey={['logs', token, includeSearchLogs ? 'with-search' : 'base']}
        tableId="operation-logs"
        customColumns={columns as ColumnDef<Record<string, unknown>, unknown>[]}
        title={<><FileText className="w-5 h-5" /> 操作记录</>}
        searchPlaceholder="搜索详情..."
        searchActions={
          <SearchLogsToggle
            checked={includeSearchLogs}
            onCheckedChange={setIncludeSearchLogs}
          />
        }
        statusOptions={statusOptions}
        defaultStatus="all"
        showFuzzySearch={false}
        showMatchMode={false}
        searchFieldOptions={LOG_SEARCH_FIELD_OPTIONS}
        defaultSearchField="all"
        extraParams={extraParams}
        renderExpandedRow={renderExpandedRow}
        scrollHeight="calc(100vh - 280px)"
        emptyText="暂无操作记录"
      />
    </div>
  )
}
