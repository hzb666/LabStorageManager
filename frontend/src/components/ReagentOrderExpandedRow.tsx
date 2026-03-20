/**
 * 试剂订单展开行组件（共享）
 * 用于 Dashboard 试剂订单 Tab 和 ReagentOrders 页面
 * 展示分子结构、英文名称、别名、备注、CAS 订单/库存概览
 */
import React, { useState, useEffect } from 'react'

import MoleculeStructure from '@/components/ui/MoleculeStructure'
import { reagentOrderAPI, type CASOverviewResponse } from '@/api/client'
import { REAGENT_STATUS_MAP } from '@/lib/constants'
import { formatDate, getInventoryBorrowLabel } from '@/lib/utils'
import { isSpecialCasValue } from '@/lib/validationSchemas'

export interface ReagentOrderExpandedRowProps {
  id?: number
  cas_number: string
  english_name?: string | null
  alias?: string | null
  notes?: string | null
}

export const ReagentOrderExpandedRow = React.memo(function ReagentOrderExpandedRow({
  item,
}: Readonly<{ item: ReagentOrderExpandedRowProps }>) {
  const [casOverview, setCasOverview] = useState<CASOverviewResponse | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const isSpecialCas = isSpecialCasValue(item.cas_number)

  useEffect(() => {
    if (isSpecialCas) {
      setCasOverview(null)
      setLoadingOverview(false)
      return
    }

    let cancelled = false

    const loadOverview = async () => {
      setLoadingOverview(true)
      try {
        const response = await reagentOrderAPI.getCASOverview(
          item.cas_number,
          item.id ? { exclude_order_id: item.id } : undefined
        )
        if (!cancelled) {
          setCasOverview(response.data)
        }
      } catch {
        if (!cancelled) {
          setCasOverview(null)
        }
      } finally {
        if (!cancelled) {
          setLoadingOverview(false)
        }
      }
    }

    void loadOverview()
    return () => {
      cancelled = true
    }
  }, [item.cas_number, item.id, isSpecialCas])

  const inventoryLatest = casOverview?.inventory.latest
  const latestOrder = casOverview?.orders.latest

  return (
    <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
      <div className="hidden md:block shrink-0">
        <MoleculeStructure casNumber={item.cas_number} width={150} height={100} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
        <div>英文名称：{item.english_name || '-'}</div>
        <div>别名：{item.alias || '-'}</div>
        <div>备注：{item.notes || '-'}</div>
        {isSpecialCas ? (
          <div className="col-span-2 md:col-span-3">CAS查重：生物试剂不适用</div>
        ) : (
          <>
            <div className="col-span-2 md:col-span-3">
              <span>订单：{loadingOverview ? '查询中...' : `匹配 ${casOverview?.orders.total_count ?? 0} 条`}</span>
              <span>，最近订单：{latestOrder
                ? `${latestOrder.applicant_name || '未知订购人'}，${REAGENT_STATUS_MAP[latestOrder.status] || latestOrder.status}，${latestOrder.specification}，${formatDate(latestOrder.created_at)}订购`
                : '-'}</span>
            </div>
            <div className="col-span-2 md:col-span-3">
              <span>库存：
                {loadingOverview ? '查询中...' : `匹配 ${casOverview?.inventory.total_count ?? 0} 条`}</span>
              <span>，最近库存剩余量：{inventoryLatest
                ? `${inventoryLatest.remaining_quantity ?? '-'} / ${inventoryLatest.specification}`
                : '-'}</span>
              <span>，库存位置：{inventoryLatest
                ? `${inventoryLatest.storage_location || '未填写'} ，借用状态： ${getInventoryBorrowLabel(inventoryLatest.status, inventoryLatest.borrower_name)}`
                : '-'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
