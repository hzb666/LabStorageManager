import type { LogItem } from '@/api/client'

const SEARCH_LOG_ENDPOINT_LABELS: Record<string, string> = {
  '/inventory/': '库存',
  '/reagent-orders/': '试剂订单',
  '/consumable-orders/': '耗材订单',
  '/common-shelf/groups': '常用货架',
  '/chem/search/substructure': '结构',
}

const ORDER_EXPORT_SCOPE_LABELS: Record<string, string> = {
  reagent_orders: '试剂订单',
  consumable_orders: '耗材订单',
}

const REAGENT_ORDER_ACTION_LABELS: Record<string, string> = {
  create: '创建试剂申购',
  update: '编辑试剂申购',
  delete: '删除试剂申购',
  approve: '审批通过试剂申购',
  reject: '审批拒绝试剂申购',
  export: '导出试剂订单',
}

const CONSUMABLE_ORDER_ACTION_LABELS: Record<string, string> = {
  create: '创建耗材申购',
  update: '编辑耗材申购',
  delete: '删除耗材申购',
  approve: '审批通过耗材申购',
  reject: '审批拒绝耗材申购',
  arrival_complete: '确认耗材到货',
  export: '导出耗材订单',
}

const USER_OPERATION_ACTION_LABELS: Record<string, string> = {
  login: '用户登录',
  logout: '用户退出',
  change_password: '修改密码',
  update_profile: '修改用户资料',
  upload_avatar: '上传头像',
  delete_avatar: '删除头像',
  create_user: '创建用户',
  activate_user: '启用用户',
  deactivate_user: '停用用户',
  update_user_role: '修改用户角色',
  reset_user_password: '重置用户密码',
  update_user_sensitive_fields: '修改用户敏感信息',
  create_reagent_brand: '新增品牌',
  update_reagent_brand: '修改品牌',
  delete_reagent_brand: '删除品牌',
  create_chemical_name_map: '新增 CAS 主数据',
  update_chemical_name_map: '修改 CAS 主数据',
  delete_chemical_name_map: '删除 CAS 主数据',
  create_announcement: '新增公告',
  update_announcement: '修改公告',
  delete_announcement: '删除公告',
  update_announcement_pin: '切换公告置顶',
  update_announcement_visibility: '切换公告可见性',
  upload_announcement_image: '上传公告图片',
  delete_announcement_image: '删除公告图片',
  delete_session: '删除设备会话',
  delete_other_sessions: '删除其他设备会话',
  refresh_session: '刷新设备会话',
  update_session: '修改设备会话',
}

const COMMON_SHELF_ACTION_LABELS: Record<string, string> = {
  stock_in: '常用货架入库',
  add_bottles: '常用货架加瓶',
  remove_one: '常用货架扣减',
  update_group: '修改常用货架分组',
  update_item: '修改常用货架条目',
  merge_group: '合并常用货架分组',
  delete_group: '删除常用货架分组',
  export: '导出常用货架',
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function joinParts(...parts: unknown[]): string {
  return parts.map(cleanText).filter(Boolean).join(' ')
}

function withCliPrefix(detail: string, isCli: boolean): string {
  const normalized = detail.trim()
  if (!isCli) {
    return normalized
  }
  if (!normalized) {
    return '[cli]'
  }
  return normalized.startsWith('[cli] ') ? normalized : `[cli] ${normalized}`
}

function buildSessionLoginDetail(item: LogItem): string {
  return joinParts(
    '登录',
    item.summary?.source_meta?.device_name,
    item.summary?.source_meta?.ip_address,
  )
}

function buildSearchDetail(item: LogItem): string {
  const sourceMeta = item.summary?.source_meta ?? {}
  const metrics = item.summary?.metrics ?? {}
  const sourceLabel = sourceMeta.source === 'cli' ? 'CLI' : 'Web'
  const endpointLabel =
    SEARCH_LOG_ENDPOINT_LABELS[sourceMeta.endpoint ?? ''] ?? sourceMeta.endpoint ?? ''
  const actionLabel = sourceMeta.query_text ? '搜索' : '筛选'
  const querySuffix = sourceMeta.query_text ? `：${sourceMeta.query_text}` : ''
  return `${sourceLabel}${actionLabel}${endpointLabel}${querySuffix}，结果 ${metrics.result_count ?? 0} 条`
}

function buildOrderExportDetail(item: LogItem): string {
  const sourceMeta = item.summary?.source_meta ?? {}
  const metrics = item.summary?.metrics ?? {}
  return `导出${ORDER_EXPORT_SCOPE_LABELS[sourceMeta.export_scope ?? ''] ?? '订单'} ${metrics.count ?? 0} 条`
}

function buildReagentOrderDetail(item: LogItem): string {
  const summary = item.summary
  const target = summary?.target ?? {}
  const actionLabel =
    REAGENT_ORDER_ACTION_LABELS[summary?.action_code ?? ''] ?? cleanText(summary?.action_code)
  const prefix = summary?.actor_is_external
    ? `${summary?.actor_name || '管理员'}${actionLabel}`
    : actionLabel
  const compactSpecification = cleanText(target.specification).replace(/\s+/g, '')
  return joinParts(prefix, target.target_name, compactSpecification, `x${cleanText(target.quantity)}`)
}

function buildConsumableOrderDetail(item: LogItem): string {
  const summary = item.summary
  const target = summary?.target ?? {}
  const actionLabel =
    CONSUMABLE_ORDER_ACTION_LABELS[summary?.action_code ?? ''] ?? cleanText(summary?.action_code)
  const prefix = summary?.actor_is_external
    ? `${summary?.actor_name || '管理员'}${actionLabel}`
    : actionLabel
  return joinParts(prefix, target.target_name, target.specification, `x${cleanText(target.quantity)}`)
}

function buildUserActionDetail(item: LogItem): string {
  const summary = item.summary
  const actionLabel =
    USER_OPERATION_ACTION_LABELS[summary?.action_code ?? ''] ?? cleanText(summary?.action_code)
  const prefix = summary?.targets_viewer && summary?.actor_is_external
    ? `${summary?.actor_name || '管理员'}对你执行: ${actionLabel}`
    : actionLabel
  return summary?.extra_detail ? `${prefix} (${summary.extra_detail})` : prefix
}

function buildInventoryActionDetail(item: LogItem): string {
  const summary = item.summary
  const target = summary?.target ?? {}
  const metrics = summary?.metrics ?? {}
  if (summary?.action_code === 'inventory_update') {
    return joinParts('更新库存', target.target_name)
  }
  if (summary?.action_code === 'inventory_delete') {
    return joinParts('删除库存', target.target_name)
  }
  if (summary?.action_code === 'inventory_export') {
    return `导出库存 ${metrics.count ?? 0} 条`
  }
  return joinParts('入库', target.target_name, `${cleanText(target.quantity)}${cleanText(target.unit)}`)
}

function buildCommonShelfActionDetail(item: LogItem): string {
  const summary = item.summary
  const target = summary?.target ?? {}
  const metrics = summary?.metrics ?? {}
  if (summary?.action_code === 'export') {
    return `导出常用货架 ${metrics.count ?? 0} 条`
  }
  return joinParts(
    COMMON_SHELF_ACTION_LABELS[summary?.action_code ?? ''] ?? cleanText(summary?.action_code),
    target.target_name,
  )
}

function buildBorrowActionDetail(item: LogItem): string {
  const summary = item.summary
  const target = summary?.target ?? {}
  const metrics = summary?.metrics ?? {}
  const borrowed = joinParts(metrics.quantity_borrowed, target.unit)
  if (summary?.is_returned) {
    const returned = joinParts(metrics.quantity_returned, target.unit)
    return `借用 ${cleanText(target.target_name)} ${borrowed}, 已归还 ${returned}`.trim()
  }
  return `借用 ${cleanText(target.target_name)} ${borrowed}, 未归还`.trim()
}

const LOG_SUMMARY_DETAIL_BUILDERS: Record<string, (item: LogItem) => string> = {
  session_login: buildSessionLoginDetail,
  search: buildSearchDetail,
  order_export: buildOrderExportDetail,
  reagent_order_action: buildReagentOrderDetail,
  consumable_order_action: buildConsumableOrderDetail,
  user_action: buildUserActionDetail,
  inventory_action: buildInventoryActionDetail,
  common_shelf_action: buildCommonShelfActionDetail,
  borrow_action: buildBorrowActionDetail,
}

function buildSummaryDetail(item: LogItem): string | null {
  const kind = item.summary?.kind
  if (!kind) {
    return null
  }
  const builder = LOG_SUMMARY_DETAIL_BUILDERS[kind]
  return builder ? builder(item) : null
}

export function getOperationLogDetailText(item: LogItem): string {
  const isCli = (item.full_data as Record<string, unknown> | undefined)?.is_cli === true
    || item.summary?.source_meta?.source === 'cli'
  const detail = buildSummaryDetail(item) ?? cleanText(item.detail)
  return withCliPrefix(detail, isCli)
}
