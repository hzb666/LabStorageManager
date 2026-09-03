/** 统一管理表格列配置。 */
import { createColumnHelper } from '@tanstack/react-table'
import { safeString } from '@/lib/validationSchemas'
import type { CellContext, ColumnDef } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { HighlightText } from '@/components/ui/HighlightText'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  OrderStatusBadge,
  type OrderStatusBadgeKind,
  type OrderStatusTimeFields,
} from '@/components/OrderStatusBadge'
import { QuantityIndicator } from '@/components/ui/QuantityIndicator'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { formatDate, formatDateTime, getFullImageUrl } from '@/lib/utils'
import { CHEMICAL_CATEGORY_LABELS, type BadgeColor } from '@/lib/constants'
import { Laptop } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

// 使用 any 类型简化类型复杂性
type TableRowData = Record<string, unknown>

// 导出表格列类型供外部使用
export type { TableRowData }

const columnHelper = createColumnHelper<TableRowData>()

function renderPlainTextCell(
  text: unknown,
  { fallback = '', className }: { fallback?: string; className?: string } = {},
) {
  return <span className={className}>{safeString(text, fallback)}</span>
}

function renderHighlightedTextCell(
  info: CellContext<TableRowData, unknown>,
  text: unknown = info.getValue(),
  { fallback = '', className }: { fallback?: string; className?: string } = {},
) {
  return (
    <span className={className}>
      <HighlightText
        text={safeString(text, fallback)}
        highlight={info.table.getState().globalFilter}
        fuzzy={info.table.options.meta?.fuzzySearch}
        matchMode={info.table.options.meta?.matchMode}
      />
    </span>
  )
}

function renderHighlightedDateCell(
  info: CellContext<TableRowData, unknown>,
  { dateOnly = false }: { dateOnly?: boolean } = {},
) {
  const dateText = formatDate(info.getValue() as string)
  return renderHighlightedTextCell(info, dateOnly ? dateText.split(' ')[0] : dateText)
}

function renderStatusBadgeCell(status: unknown, color?: BadgeColor) {
  return <StatusBadge status={safeString(status, '')} color={color} />
}

function renderOrderStatusBadgeCell(
  info: CellContext<TableRowData, unknown>,
  kind: OrderStatusBadgeKind,
) {
  return (
    <OrderStatusBadge
      status={safeString(info.getValue(), '')}
      order={info.row.original as OrderStatusTimeFields}
      kind={kind}
    />
  )
}

function renderHazardousNameCell(
  info: CellContext<TableRowData, unknown>,
  className?: string,
) {
  const isHazardous = Boolean(info.row.original.is_hazardous)

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5',
        className,
      )}
    >
      <HazardousIcon isHazardous={isHazardous} />
      {renderHighlightedTextCell(info, undefined, { className: 'min-w-0 break-all' })}
    </div>
  )
}

/**
 * 库存表格列配置
 * 包含：CAS号、名称、位置、品牌、剩余/规格、入库时间、状态
 */
export function getInventoryTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
      minSize: 100,
      maxSize: 200,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 260,
      minSize: 200,
      maxSize: 500,
      cell: info => renderHazardousNameCell(info),
    }),
    columnHelper.accessor('storage_location', {
      id: 'storage_location',
      header: '位置',
      size: 100,
      minSize: 80,
      maxSize: 150,
      sortDescFirst: false,
      sortingFn: 'text',
      cell: info =>
        renderHighlightedTextCell(info, info.row.original.storage_location, {
          fallback: '-',
          className: 'break-all',
        }),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 100,
      minSize: 80,
      maxSize: 150,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
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
    columnHelper.accessor('created_at', {
      header: '入库时间',
      size: 120,
      minSize: 100,
      maxSize: 180,
      sortDescFirst: true,
      cell: info => renderHighlightedDateCell(info, { dateOnly: true }),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 80,
      minSize: 80,
      maxSize: 120,
      cell: info => renderStatusBadgeCell(info.getValue()),
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
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 200,
      minSize: 160,
      maxSize: 300,
      cell: info => renderHazardousNameCell(info),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 90,
      minSize: 70,
      maxSize: 150,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-' }),
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
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-' }),
    }),
    columnHelper.accessor('created_at', {
      header: '申购时间',
      size: 80,
      minSize: 70,
      maxSize: 120,
      cell: info => renderHighlightedDateCell(info, { dateOnly: true }),
    }),
    columnHelper.accessor('order_reason', {
      header: '原因',
      size: 60,
      minSize: 50,
      maxSize: 80,
      cell: info => renderStatusBadgeCell(info.getValue()),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      minSize: 60,
      maxSize: 80,
      cell: info => renderOrderStatusBadgeCell(info, 'reagent'),
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
      size: 180,
      minSize: 150,
      maxSize: 250,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('specification', {
      header: '规格',
      size: 280,
      minSize: 150,
      maxSize: 350,
      enableSorting: false,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
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
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-' }),
    }),
    columnHelper.accessor('communication', {
      header: '订购信息',
      size: 120,
      minSize: 80,
      maxSize: 200,
      enableSorting: false,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
    }),
    columnHelper.accessor('created_at', {
      header:'申购时间',
      size: 100,
      minSize: 80,
      maxSize: 120,
      cell: info => renderHighlightedDateCell(info),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 60,
      minSize: 50,
      maxSize: 100,
      cell: info => renderOrderStatusBadgeCell(info, 'consumable'),
    }),
  ]
}

export const COMMON_SHELF_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'run_short', label: '快用完' },
  { value: 'consumed', label: '已耗尽' },
]

export const COMMON_SHELF_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'alias', label: '别名' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
  { value: 'storage_location', label: '位置' },
]

export function getCommonShelfTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', {
      header: 'CAS号',
      size: 120,
      minSize: 100,
      maxSize: 180,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('name', {
      header: '名称',
      size: 240,
      minSize: 160,
      maxSize: 320,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('storage_location', {
      header: '位置',
      size: 120,
      minSize: 90,
      maxSize: 180,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
    }),
    columnHelper.accessor('brand', {
      header: '品牌',
      size: 120,
      minSize: 90,
      maxSize: 180,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      size: 90,
      minSize: 80,
      maxSize: 130,
      cell: info => renderStatusBadgeCell(info.getValue()),
    }),
  ]
}

export const COMMON_SHELF_GROUP_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'cas_number', label: 'CAS' },
  { value: 'name', label: '名称' },
  { value: 'alias', label: '别名' },
  { value: 'brand', label: '品牌' },
  { value: 'storage_location', label: '位置' },
]
export const CHEMICAL_NAME_MAP_SEARCH_FIELD_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'cas_number', label: 'CAS' },
  { value: 'name', label: '名称' },
  { value: 'alias', label: '别名' },
]
export const COMMON_SHELF_EMPTY_LOCATION_VALUE = '__EMPTY_LOCATION__'

export function renderCommonShelfCategory(category: string | null) {
  if (!category) return '-'
  return CHEMICAL_CATEGORY_LABELS[category] || category
}

function getChemicalCategoryBadgeColor(category: string | null): BadgeColor {
  switch (category) {
    case 'acid':
      return 'red'
    case 'base':
      return 'blue'
    case 'salt':
      return 'purple'
    case 'solvent':
      return 'green'
    default:
      return 'gray'
  }
}

export function getCommonShelfGroupTableColumns(args: {
  renderActions: (row: TableRowData) => ReactNode
}): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor((row) => safeString((row.group as Record<string, unknown>)?.cas_number, ''), {
      id: 'cas_number',
      header: 'CAS',
      cell: info => renderPlainTextCell(info.getValue(), { className: 'break-all' }),
    }),
    columnHelper.accessor((row) => safeString((row.display as Record<string, unknown>)?.name, ''), {
      id: 'name',
      header: '名称',
      cell: info => renderPlainTextCell(info.getValue(), { className: 'break-all' }),
    }),
    columnHelper.accessor((row) => (row.display as Record<string, unknown>)?.category as string | null, {
      id: 'category',
      header: '分类',
      cell: (info) => {
        const category = info.getValue()
        return (
          renderStatusBadgeCell(
            renderCommonShelfCategory(category),
            getChemicalCategoryBadgeColor(category),
          )
        )
      },
    }),
    columnHelper.accessor((row) => safeString((row.group as Record<string, unknown>)?.brand, ''), {
      id: 'brand',
      header: '品牌',
      cell: info => renderPlainTextCell(info.getValue(), { fallback: '-' }),
    }),
    columnHelper.accessor((row) => safeString((row.group as Record<string, unknown>)?.specification_text, ''), {
      id: 'specification',
      header: '规格',
      cell: info => renderPlainTextCell(info.getValue(), { fallback: '-' }),
    }),
    columnHelper.accessor((row) => Number(row.bottle_count ?? 0), {
      id: 'bottle_count',
      header: '剩余瓶数',
      cell: (info) => <span className="font-normal">{info.getValue()} 瓶</span>,
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      cell: (info) => <>{args.renderActions(info.row.original)}</>,
    }),
  ]
}

export function getChemicalNameMapTableColumns(args: {
  renderActions?: (row: TableRowData) => ReactNode
  renderAliases: (row: TableRowData) => string
}): ColumnDef<TableRowData, unknown>[] {
  const columns: ColumnDef<TableRowData, unknown>[] = [
    columnHelper.accessor('cas_number', {
      header: 'CAS',
      size: 96,
      minSize: 84,
      maxSize: 120,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('name', {
      header: '中文名称',
      size: 180,
      minSize: 140,
      maxSize: 260,
      cell: info => renderHighlightedTextCell(info, undefined, { className: 'break-all' }),
    }),
    columnHelper.accessor('english_name', {
      header: '英文名称',
      size: 240,
      minSize: 180,
      maxSize: 360,
      cell: info => renderHighlightedTextCell(info, undefined, { fallback: '-', className: 'break-all' }),
    }),
    columnHelper.display({
      id: 'aliases',
      header: '别名',
      size: 220,
      minSize: 160,
      maxSize: 340,
      enableSorting: false,
      cell: info =>
        renderHighlightedTextCell(info, args.renderAliases(info.row.original), {
          className: 'break-all',
        }),
    }),
    columnHelper.accessor('category', {
      header: '分类',
      size: 72,
      minSize: 64,
      maxSize: 88,
      cell: (info) => {
        const category = info.getValue() as string | null
        return (
          renderStatusBadgeCell(
            renderCommonShelfCategory(category),
            getChemicalCategoryBadgeColor(category),
          )
        )
      },
    }),
  ]

  const renderActions = args.renderActions
  if (renderActions) {
    columns.push(columnHelper.display({
      id: 'actions',
      header: '操作',
      enableSorting: false,
      size: 144,
      minSize: 132,
      maxSize: 160,
      cell: (info) => <>{renderActions(info.row.original)}</>,
    }))
  }

  return columns
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
      cell: info => renderHighlightedTextCell(info),
    }),
    columnHelper.accessor('full_name', {
      header: '姓名',
      size: 100,
      cell: info => renderHighlightedTextCell(info),
    }),
    columnHelper.accessor('role', {
      header: '角色',
      size: 80,
      cell: info => renderStatusBadgeCell(info.getValue()),
    }),
    columnHelper.accessor('is_active', {
      header: '状态',
      size: 80,
      cell: info => {
        const isActive = info.getValue() as boolean
        return renderStatusBadgeCell(isActive ? 'active' : 'inactive')
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
        return renderStatusBadgeCell(isCurrent ? 'current' : 'other')
      },
    }),
  ]
}
