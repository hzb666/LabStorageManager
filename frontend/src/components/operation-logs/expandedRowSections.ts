import {
  asRecord,
  customField,
  dateField,
  diffField,
  field,
  firstValue,
  formatBoolean,
  formatPrice,
  formatQuantity,
  formatText,
  hasValue,
  isRecord,
  mergeDisplayRecord,
  section,
  systemSection,
  type DetailSection,
  type LogRecord,
  type Tone,
} from './expandedRowUtils'

const INVENTORY_ACTION_LABELS: Record<string, string> = {
  stock_in: '入库',
  inventory_update: '更新',
  inventory_delete: '删除',
  inventory_export: '导出',
}

const COMMON_SHELF_ACTION_LABELS: Record<string, string> = {
  stock_in: '入库',
  add_bottles: '加瓶',
  remove_one: '扣减',
  update_group: '修改分组',
  update_item: '修改条目',
  merge_group: '合并分组',
  delete_group: '删除分组',
  export: '导出',
}

const EXPORT_SCOPE_LABELS: Record<string, string> = {
  inventory: '库存',
  common_shelf: '常用货架',
  reagent_orders: '试剂订单',
  consumable_orders: '耗材订单',
}

function formatAction(value: unknown, labels: Record<string, string>): string {
  const action = formatText(value, '')
  return labels[action] ?? action
}

function getActionValue(fullData: LogRecord): string {
  return formatText(fullData.action, '')
}

function formatRecord(value: unknown): string {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) {
    return ''
  }
  return JSON.stringify(record)
}

function formatReagentSpecification(record: LogRecord): string {
  return formatQuantity(record.initial_quantity, record.unit)
}

function formatInventoryCategory(value: unknown): string {
  const category = formatText(value, '').trim()
  if (category === 'other' || category === 'others') {
    return ''
  }
  return category
}

interface OrderChangeSectionOptions {
  includeUnit?: boolean
  beforeSpecification?: unknown
  afterSpecification?: unknown
}

function buildOrderChangeSection(
  fullData: LogRecord,
  options: OrderChangeSectionOptions = {}
): DetailSection {
  const before = asRecord(fullData.before)
  const after = asRecord(fullData.after)
  const fields = [
    diffField('名称', before.name, after.name),
    diffField(
      '规格',
      firstValue(options.beforeSpecification, before.specification),
      firstValue(options.afterSpecification, after.specification)
    ),
    diffField('数量', before.quantity, after.quantity),
    diffField('品牌', before.brand, after.brand),
    diffField('纯度', before.purity, after.purity),
    diffField('价格', formatPrice(before.price), formatPrice(after.price)),
    diffField('状态', before.status, after.status),
    diffField('类别', before.category, after.category),
    diffField('备注', before.notes, after.notes),
  ]

  if (options.includeUnit !== false) {
    fields.splice(3, 0, diffField('单位', before.unit, after.unit))
  }

  return section('变更内容', fields)
}

function buildReagentOrderSections(fullData: LogRecord): DetailSection[] {
  const data = mergeDisplayRecord(fullData)
  const before = asRecord(fullData.before)
  const after = asRecord(fullData.after)
  return [
    section('试剂订单', [
      field('操作', fullData.action),
      field('试剂名称', firstValue(data.name, fullData.order_name)),
      field('CAS号', data.cas_number),
      field('英文名称', data.english_name),
      field('别名', data.alias),
      field('规格', firstValue(data.specification, formatReagentSpecification(data))),
      field('数量', data.quantity),
      field('品牌', data.brand),
      field('纯度', data.purity),
      field('价格', formatPrice(data.price), { visible: hasValue(data.price) }),
      field('状态', data.status),
      field('类别', data.category),
      field('申购原因', data.order_reason),
      field('备注', data.notes),
    ]),
    buildOrderChangeSection(fullData, {
      includeUnit: false,
      beforeSpecification: formatReagentSpecification(before),
      afterSpecification: formatReagentSpecification(after),
    }),
    systemSection(fullData),
  ]
}

function buildConsumableOrderSections(fullData: LogRecord): DetailSection[] {
  const data = mergeDisplayRecord(fullData)
  return [
    section('耗材订单', [
      field('操作', fullData.action),
      field('耗材名称', firstValue(data.name, fullData.order_name)),
      field('产品编号', data.product_number),
      field('规格', data.specification),
      field('数量', data.quantity),
      field('单位', data.unit),
      field('品牌', data.brand),
      field('价格', formatPrice(data.price), { visible: hasValue(data.price) }),
      field('状态', data.status),
      field('类别', data.category),
      field('沟通记录', data.communication),
      field('备注', data.notes),
    ]),
    buildOrderChangeSection(fullData),
    systemSection(fullData),
  ]
}

function buildInventoryInfoSection(title: string, fullData: LogRecord): DetailSection {
  const quantityTone: Tone = title === '删除前库存' ? 'danger' : 'success'
  return section(title, [
    field('操作', formatAction(fullData.action, INVENTORY_ACTION_LABELS), {
      visible: hasValue(fullData.action),
    }),
    field('物品名称', fullData.name),
    field('英文名称', fullData.english_name),
    field('别名', fullData.alias),
    field('CAS号', fullData.cas_number),
    field('类别', formatInventoryCategory(fullData.category)),
    field('品牌', fullData.brand),
    field('纯度', fullData.purity),
    field('存放位置', fullData.storage_location),
    field('入库数量', formatQuantity(fullData.initial_quantity, fullData.unit), {
      tone: quantityTone,
      visible: hasValue(fullData.initial_quantity),
    }),
    field('剩余数量', formatQuantity(fullData.remaining_quantity, fullData.unit), {
      visible: hasValue(fullData.remaining_quantity),
    }),
    field('危险品', formatBoolean(fullData.is_hazardous), {
      visible: hasValue(fullData.is_hazardous),
    }),
    field('状态', fullData.status),
    field('内部编号', fullData.internal_code, { mono: true }),
    field('来源', fullData.source),
    field('备注', fullData.notes),
  ])
}

function buildInventoryChangeSections(fullData: LogRecord): DetailSection[] {
  const before = asRecord(fullData.before)
  const after = asRecord(fullData.after)
  return [
    section('库存对象', [
      field('操作', formatAction(fullData.action, INVENTORY_ACTION_LABELS), {
        visible: hasValue(fullData.action),
      }),
      field('物品名称', firstValue(fullData.name, after.name, before.name)),
      field('CAS号', firstValue(fullData.cas_number, after.cas_number, before.cas_number)),
      field('纯度', firstValue(fullData.purity, after.purity, before.purity)),
    ]),
    section('变更内容', [
      diffField('名称', before.name, after.name),
      diffField('CAS号', before.cas_number, after.cas_number),
      diffField('存放位置', before.storage_location, after.storage_location),
      diffField(
        '剩余量',
        formatQuantity(before.remaining_quantity, before.unit),
        formatQuantity(after.remaining_quantity, after.unit)
      ),
      diffField(
        '入库数量',
        formatQuantity(before.initial_quantity, before.unit),
        formatQuantity(after.initial_quantity, after.unit)
      ),
      diffField('状态', before.status, after.status),
      diffField(
        '类别',
        formatInventoryCategory(before.category),
        formatInventoryCategory(after.category)
      ),
      diffField('品牌', before.brand, after.brand),
      diffField('纯度', before.purity, after.purity),
      diffField('备注', before.notes, after.notes),
    ]),
    systemSection(fullData),
  ]
}

function buildCommonShelfSections(fullData: LogRecord): DetailSection[] {
  const data = mergeDisplayRecord(fullData)
  const before = asRecord(fullData.before)
  const after = asRecord(fullData.after)
  return [
    section('货架记录', [
      field('操作', formatAction(fullData.action, COMMON_SHELF_ACTION_LABELS), {
        visible: hasValue(fullData.action),
      }),
      field('名称', firstValue(data.name, fullData.name)),
      field('CAS号', data.cas_number),
      field('品牌', data.brand),
      field('纯度', data.purity),
      field('规格', data.specification_text),
      field('位置', firstValue(data.location, data.storage_location)),
      field('数量', data.count),
      field('备注', data.notes),
    ]),
    section('变更内容', [
      diffField('品牌', before.brand, after.brand),
      diffField('纯度', before.purity, after.purity),
      diffField('规格', before.specification_text, after.specification_text),
      diffField('位置', before.storage_location, after.storage_location),
      diffField('备注', before.notes, after.notes),
    ]),
    systemSection(fullData),
  ]
}

function buildBorrowSections(fullData: LogRecord): DetailSection[] {
  const returned = fullData.is_returned === true
  return [
    section('借用信息', [
      field('物品名称', fullData.inventory_name),
      field('CAS号', fullData.cas_number),
      field('借出数量', formatQuantity(fullData.quantity_borrowed, fullData.unit), {
        tone: 'info',
        visible: hasValue(fullData.quantity_borrowed),
      }),
      customField('归还状态', returned ? '已归还' : '未归还', {
        visible: hasValue(fullData.is_returned),
        tone: returned ? 'success' : 'warning',
      }),
      field('归还数量', formatQuantity(fullData.quantity_returned, fullData.unit), {
        visible: returned && hasValue(fullData.quantity_returned),
      }),
      dateField('借用时间', fullData.borrow_time),
      dateField('归还时间', fullData.return_time),
      field('备注', fullData.notes),
    ]),
    systemSection(fullData),
  ]
}

function buildExportSections(fullData: LogRecord): DetailSection[] {
  const exportScope = formatText(fullData.export_scope, '')
  return [
    section('导出信息', [
      field('操作', '导出'),
      field('导出对象', EXPORT_SCOPE_LABELS[exportScope] ?? exportScope),
      field('导出条数', fullData.count),
      dateField('导出时间', fullData.created_at),
    ]),
    systemSection(fullData),
  ]
}

function buildInventorySections(fullData: LogRecord): DetailSection[] {
  const action = getActionValue(fullData)
  if (action === 'inventory_update') return buildInventoryChangeSections(fullData)
  if (action === 'inventory_delete') {
    return [buildInventoryInfoSection('删除前库存', fullData), systemSection(fullData)]
  }
  if (action === 'inventory_export') return buildExportSections(fullData)
  return [buildInventoryInfoSection('入库信息', fullData), systemSection(fullData)]
}

function buildCommonShelfSectionsByAction(fullData: LogRecord): DetailSection[] {
  if (getActionValue(fullData) === 'export') return buildExportSections(fullData)
  return buildCommonShelfSections(fullData)
}

function buildSessionSections(fullData: LogRecord): DetailSection[] {
  return [
    section('登录信息', [
      field('设备名称', fullData.device_name),
      field('IP地址', fullData.ip_address),
      field('最近 IP', fullData.last_ip_address),
      field('User-Agent', fullData.user_agent, { wide: true, mono: true }),
      dateField('首次登录', fullData.created_at),
      dateField('最后活跃', fullData.last_active_at),
      dateField('过期时间', fullData.expires_at),
    ]),
    systemSection(fullData),
  ]
}

function buildSearchSections(fullData: LogRecord): DetailSection[] {
  return [
    section('搜索日志', [
      field('端点', fullData.endpoint),
      field('关键词', firstValue(fullData.query, fullData.normalized_query)),
      field('标准化关键词', fullData.normalized_query),
      field('筛选条件', formatRecord(fullData.filters), {
        visible: hasValue(formatRecord(fullData.filters)),
      }),
      field('排序', formatRecord(fullData.sort), {
        visible: hasValue(formatRecord(fullData.sort)),
      }),
      field('结果数', fullData.result_count),
      field('耗时', hasValue(fullData.latency_ms) ? `${fullData.latency_ms} ms` : ''),
      dateField('搜索时间', fullData.created_at),
    ]),
    systemSection(fullData),
  ]
}

function buildUserSections(fullData: LogRecord): DetailSection[] {
  const snapshot = asRecord(fullData.snapshot)
  const before = asRecord(snapshot.before)
  const after = asRecord(snapshot.after)
  return [
    section('用户操作', [
      field('操作', fullData.action),
      field('结果', fullData.outcome),
      field('客户端 IP', fullData.client_ip),
      field('说明', fullData.detail, { wide: true }),
    ]),
    section('变更内容', [
      diffField('用户名', before.username, after.username),
      diffField('姓名', before.full_name, after.full_name),
      diffField('角色', before.role, after.role),
      diffField('启用状态', formatBoolean(before.is_active), formatBoolean(after.is_active)),
      diffField('头像', before.avatar_url, after.avatar_url),
      diffField('用户名版本', before.username_version, after.username_version),
    ]),
    systemSection(fullData),
  ]
}

function buildFallbackSections(fullData: LogRecord): DetailSection[] {
  const fields = Object.entries(fullData)
    .filter(([, value]) => !isRecord(value) && !Array.isArray(value))
    .map(([key, value]) => field(key, value, { mono: key.endsWith('_id') }))
  return [section('日志字段', fields)]
}

export function buildSections(type: string, fullData: LogRecord): DetailSection[] {
  switch (type) {
    case 'borrow':
      return buildBorrowSections(fullData)
    case 'reagent_order':
      return buildReagentOrderSections(fullData)
    case 'consumable_order':
      return buildConsumableOrderSections(fullData)
    case 'inventory':
      return buildInventorySections(fullData)
    case 'common_shelf':
      return buildCommonShelfSectionsByAction(fullData)
    case 'delete':
      return [buildInventoryInfoSection('删除前库存', fullData), systemSection(fullData)]
    case 'update':
      return buildInventoryChangeSections(fullData)
    case 'export':
      return buildExportSections(fullData)
    case 'session':
      return buildSessionSections(fullData)
    case 'search':
      return buildSearchSections(fullData)
    case 'user':
      return buildUserSections(fullData)
    default:
      return buildFallbackSections(fullData)
  }
}
