/**
 * 耗材订单展开行组件（共享）
 * 用于 Dashboard 耗材订单 Tab 和 ConsumableOrders 页面
 * 展示英文名称、货号、价格、备注
 */
import React from 'react'

import { toText } from '@/lib/utils'

export interface ConsumableOrderExpandedRowProps {
  english_name?: string | null
  product_number?: string | null
  price?: number | null
  notes?: string | null
}

export const ConsumableOrderExpandedRow = React.memo(function ConsumableOrderExpandedRow({
  item,
}: Readonly<{ item: ConsumableOrderExpandedRowProps }>) {
  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 flex-1">
        <div className="col-span-2">英文名称：{item.english_name || '-'}</div>
        <div>货号：{toText(item.product_number) || '-'}</div>
        <div className="col-span-2">备注：{item.notes || '-'}</div>
        <div>价格：{item.price ?? '-'}</div>
      </div>
    </div>
  )
})
