/**
 * 耗材订单展开行组件（共享）
 * 用于 Dashboard 耗材订单 Tab 和 ConsumableOrders 页面
 * 展示英文名称、货号、价格、备注，可选显示申购时间和订购人
 */
import React from 'react'

import { toText, formatDate } from '@/lib/utils'

export interface ConsumableOrderExpandedRowProps {
  english_name?: string | null
  product_number?: string | null
  price?: number | null
  notes?: string | null
  // 以下字段仅在完整模式（ConsumableOrders 页面）下显示
  created_at?: string | null
  applicant_name?: string | null
}

export const ConsumableOrderExpandedRow = React.memo(function ConsumableOrderExpandedRow({
  item,
  showExtraFields = false,
}: Readonly<{ item: ConsumableOrderExpandedRowProps; showExtraFields?: boolean }>) {
  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 flex-1">
        <div><span>英文名称：</span>{item.english_name || '-'}</div>
        <div><span>货号：</span>{toText(item.product_number) || '-'}</div>
        <div><span>价格：</span>{item.price || '-'}</div>
        {showExtraFields && (
          <>
            <div><span>申购时间：</span>{item.created_at ? formatDate(item.created_at) : '-'}</div>
            <div><span>订购人：</span>{item.applicant_name || '-'}</div>
          </>
        )}
        <div><span className={showExtraFields ? '' : 'col-span-2 md:col-span-3'}>备注：</span>{item.notes || '-'}</div>
      </div>
    </div>
  )
})
