/**
 * 表格列配置抽离
 * 仿照 formConfigs.tsx 模式，集中管理表格列配置
 * 
 * 使用方式：
 * import { getInventoryTableColumns } from '@/lib/tableConfigs'
 * const columns = getInventoryTableColumns()
 */
import { createColumnHelper } from '@tanstack/react-table'
import { safeString } from '@/lib/validationSchemas'
import type { ColumnDef } from '@tanstack/react-table'
import { HighlightText } from '@/components/ui/HighlightText'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { QuantityIndicator } from '@/components/ui/QuantityIndicator'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { formatDate, formatDateTime, getFullImageUrl } from '@/lib/utils'
import { Laptop } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'

// 使用 any 类型简化类型复杂性
type TableRowData = Record<string, unknown>

// 导出表格列类型供外部使用
export type { TableRowData }

const columnHelper = createColumnHelper<TableRowData>()

/**
 * 库存表格列配置
 * 包含：CAS号、名称、位置、分类、品牌、剩余/规格、状态
 */
export function getInventoryTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
      minSize: 100,
      maxSize: 200,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.getValue(), '')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 250,
      minSize: 200,
      maxSize: 500,
      cell: info => (
        <div className="flex items-center gap-1.5 break-all">
          <HazardousIcon isHazardous={Boolean(info.row.original.is_hazardous)} />
          <span>
            <HighlightText
              text={safeString(info.getValue(), '')}
              highlight={info.table.getState().globalFilter}
              fuzzy={info.table.options.meta?.fuzzySearch}
            />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('storage_location', {
      id: 'storage_location',
      header: '位置',
      size: 100,
      minSize: 80,
      maxSize: 150,
      sortDescFirst: false,
      sortingFn: 'text',
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.row.original.storage_location, '-')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('category', {
      header: '分类',
      size: 100,
      minSize: 80,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.getValue(), '-')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 100,
      minSize: 80,
      maxSize: 150,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.getValue(), '-')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('remaining_percent', {
      id: 'remaining_percent',
      header: '剩余/规格',
      size: 120,
      minSize: 120,
      maxSize: 150,
      cell: info => (
        <QuantityIndicator
          remaining={Number(info.row.original.remaining_quantity ?? 0)}
          initial={Number(info.row.original.initial_quantity ?? 0)}
          specification={safeString(info.row.original.specification, '')}
        />
      ),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      minSize: 80,
      maxSize: 120,
      cell: info => <StatusBadge status={safeString(info.getValue(), '')} />,
    }),
  ]
}

/**
 * 试剂订单表格列配置
 * 包含：CAS号、名称、品牌、规格、价格、原因、订购人、时间、状态
 */
export function getReagentOrderTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 110,
      minSize: 90,
      maxSize: 180,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.getValue(), '')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 200,
      minSize: 160,
      maxSize: 300,
      cell: info => (
        <div className="flex items-center gap-1.5">
          <HazardousIcon isHazardous={Boolean(info.row.original.is_hazardous)} />
          <span>
            <HighlightText
              text={safeString(info.getValue(), '')}
              highlight={info.table.getState().globalFilter}
              fuzzy={info.table.options.meta?.fuzzySearch}
            />
          </span>
        </div>
      ),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 90,
      minSize: 70,
      maxSize: 150,
      cell: info => {
        const value = info.getValue()
        return <span>{safeString(value, '-')}</span>
      },
    }),
    columnHelper.accessor('specification', {
      header: '规格',
      size: 100,
      minSize: 80,
      maxSize: 120,
      enableSorting: false,
      cell: info => {
        const order = info.row.original
        const specification = info.getValue() as string | null
        const displayText = specification || (order.unit ? `${order.initial_quantity} ${safeString(order.unit, '')}` : `${order.initial_quantity}`)
        const qty = Number(order.quantity)
        if (qty > 1) {
          return <span className="break-all">{qty} × {displayText}</span>
        }
        return <span className="break-all">{displayText || '-'}</span>
      },
    }),
    columnHelper.accessor('price', {
      header: '价格',
      size: 70,
      minSize: 60,
      maxSize: 100,
      cell: info => info.getValue() ? `¥${info.getValue()}` : '-',
    }),
    columnHelper.accessor('applicant_name', {
      id: 'applicant',
      header: '订购人',
      size: 70,
      minSize: 60,
      maxSize: 100,
      cell: info => {
        const value = info.getValue()
        return <span>{safeString(value, '-')}</span>
      },
    }),
    columnHelper.accessor('created_at', {
      header: '时间',
      size: 80,
      minSize: 70,
      maxSize: 120,
      cell: info => <span>{formatDate(info.getValue() as string).split(' ')[0]}</span>,
    }),
    columnHelper.accessor('order_reason', {
      header: '原因',
      size: 60,
      minSize: 50,
      maxSize: 80,
      cell: info => {
        const reason = info.getValue() as string
        return <StatusBadge status={reason} />
      },
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      minSize: 50,
      maxSize: 80,
      cell: info => <StatusBadge status={safeString(info.getValue(), '')} />,
    }),
  ]
}

/**
 * 耗材订单表格列配置
 * 包含：名称、分类、品牌、规格、数量、价格、订购人、状态
 */
export function getConsumableOrderTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('name', {
      header: '名称',
      size: 250,
      minSize: 150,
      maxSize: 300,
      cell: info => (
        <span className="break-all">
          <HighlightText
            text={safeString(info.getValue(), '')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('specification', {
      header: '规格',
      size: 250,
      minSize: 150,
      maxSize: 300,
      enableSorting: false,
      cell: info => {
        const value = info.getValue()
        return <span className="break-all">{safeString(value, '-')}</span>
      },
    }),
    columnHelper.accessor('quantity', {
      header: '数量',
      size: 50,
      minSize: 40,
      maxSize: 100,
      enableSorting: false,
      cell: info => {
        const value = info.getValue()
        const unit = info.row.original.unit as string | undefined
        return <span>{safeString(value, '')} {safeString(unit, '')}</span>
      },
    }),
    columnHelper.accessor('applicant_name', {
      id: 'applicant',
      header: '订购人',
      size: 60,
      minSize: 50,
      maxSize: 120,
      cell: info => {
        const value = safeString(info.getValue(), '-')
        return <span>{value}</span>
      },
    }),
    columnHelper.accessor('communication', {
      header: '订购信息',
      size: 100,
      minSize: 80,
      maxSize: 200,
      enableSorting: false,
      cell: info => {
        const value = info.getValue()
        return <span className="break-all">{safeString(value, '-')}</span>
      },
    }),
        columnHelper.accessor('created_at',{
      header:'申购时间',
      size: 100,
      minSize: 80,
      maxSize: 120,
      cell: info => {
        const value = info.getValue() as string
        return <span>{formatDate(value)}</span>
      }
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      minSize: 50,
      maxSize: 100,
      cell: info => <StatusBadge status={safeString(info.getValue(), '')} />,
    }),
  ]
}

/**
 * 常用货架表格列配置（不含操作列）
 */
export function getCommonShelfTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 130,
      minSize: 110,
      cell: info => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 220,
      minSize: 180,
      cell: info => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
    }),
    columnHelper.accessor('storage_location', {
      header: '位置',
      size: 140,
      minSize: 110,
      cell: info => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 100,
      minSize: 80,
      cell: info => <span className="break-all">{safeString(info.getValue(), '-')}</span>,
    }),
    columnHelper.accessor('specification', {
      header: '规格',
      size: 110,
      minSize: 90,
      cell: info => <span>{safeString(info.getValue(), '-')}</span>,
    }),
    columnHelper.accessor('available_bottles', {
      header: '可用瓶数',
      size: 90,
      minSize: 80,
      cell: info => <span className=" text-green-700">{safeString(info.getValue(), '0')} 瓶</span>,
    }),
    columnHelper.accessor('total_bottles', {
      header: '总瓶数',
      size: 90,
      minSize: 80,
      cell: info => <span>{safeString(info.getValue(), '0')} 瓶</span>,
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      minSize: 70,
      cell: info => <StatusBadge status={safeString(info.getValue(), '')} />,
    }),
  ]
}

/**
 * 用户管理表格列配置
 * 包含：用户名、姓名、角色、状态、创建时间、最后活跃时间
 */
export function getAdminUsersTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.display({
      id: 'avatar',
      header: '',
      size: 50,
      cell: info => {
        const user = info.row.original as unknown as { username: string; avatar_url?: string }
        return (
          <Avatar className="size-8">
            <AvatarImage src={user.avatar_url ? getFullImageUrl(user.avatar_url) : undefined} alt={user.username} />
            <AvatarFallback>{user.username.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        )
      },
    }),
    columnHelper.accessor('username', {
      header: '用户名',
      size: 150,
      cell: info => (
        <span>
          <HighlightText
            text={safeString(info.getValue(), '')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('full_name', {
      header: '姓名',
      size: 100,
      cell: info => (
        <span>
          <HighlightText
            text={safeString(info.getValue(), '')}
            highlight={info.table.getState().globalFilter}
            fuzzy={info.table.options.meta?.fuzzySearch}
          />
        </span>
      ),
    }),
    columnHelper.accessor('role', {
      header: '角色',
      size: 80,
      cell: info => <StatusBadge status={safeString(info.getValue(), '')} />,
    }),
    columnHelper.accessor('is_active', {
      header: '状态',
      size: 80,
      cell: info => {
        const isActive = info.getValue() as boolean
        return <StatusBadge status={isActive ? 'active' : 'inactive'} />
      },
    }),
    columnHelper.accessor('last_active_at', {
      header: '最后活跃',
      size: 160,
      cell: info => {
        const value = info.getValue() as string | null
        if (!value) return <span>从未登录</span>
        return formatDateTime(value)
      },
    }),
    columnHelper.accessor('created_at', {
      header: '创建时间',
      size: 120,
      cell: info => formatDate(info.getValue() as string),
    }),
  ]
}

/**
 * 设备管理表格列配置
 * 包含：设备名称、IP地址、最近活跃、首次登录、状态
 */
export function getDeviceManagementTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('device_name', {
      header: '设备名称',
      size: 150,
      cell: info => {
        const value = info.getValue()
        return (
          <div className="flex items-center gap-2">
            <Laptop className="w-4 h-4 text-muted-foreground" />
            <span>{safeString(value, '')}</span>
          </div>
        )
      },
    }),
    columnHelper.accessor('ip_address', {
      header: 'IP地址',
      size: 130,
      cell: info => {
        const value = info.getValue()
        return <span className="text-base">{safeString(value, '')}</span>
      },
    }),
    columnHelper.accessor('last_active_at', {
      header: '最近活跃',
      size: 150,
      cell: info => formatDateTime(info.getValue() as string),
    }),
    columnHelper.accessor('created_at', {
      header: '首次登录',
      size: 150,
      cell: info => formatDateTime(info.getValue() as string),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      cell: info => {
        const session = info.row.original
        const isCurrent = session.id === session.currentDeviceId
        return <StatusBadge status={isCurrent ? 'current' : 'other'} />
      },
    }),
  ]
}
