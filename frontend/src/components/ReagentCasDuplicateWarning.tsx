import { AlertTriangle } from 'lucide-react'

import type { CASOverviewResponse } from '@/api/client'

interface ReagentCasDuplicateWarningProps {
  casWarning: CASOverviewResponse | null
  className?: string
  onOpenOrders?: () => void
  onOpenInventory?: () => void
  getOrderStatusLabel?: (status: string) => string
}

export function ReagentCasDuplicateWarning({
  casWarning,
  className,
  onOpenOrders,
  onOpenInventory,
  getOrderStatusLabel,
}: Readonly<ReagentCasDuplicateWarningProps>) {
  if (!casWarning?.has_warning) {
    return null
  }

  let displayName = ''
  if (casWarning.display_name) {
    displayName = casWarning.display_name.length > 10
      ? `${casWarning.display_name.slice(0, 10)}...`
      : casWarning.display_name
  }

  return (
    <div className={className || 'mt-4 rounded-md bg-orange-50 p-3 dark:bg-orange-950'}>
      <p className='flex items-center gap-1 text-sm text-orange-700 dark:text-orange-300'>
        <AlertTriangle className='h-4 w-4' />
        <span>
          注意：检测到同 CAS 相关记录（CAS: {casWarning.cas_number}
          {displayName ? `，名称：${displayName}` : ''}
          ）
        </span>
      </p>

      <div className='mt-2 space-y-1 text-sm text-orange-800 dark:text-orange-200'>
        {casWarning.orders.total_count > 0 && casWarning.orders.latest && (
          <p>
            {onOpenOrders ? (
              <button
                type='button'
                className='font-bold transition-colors hover:text-orange-950 dark:hover:text-orange-100'
                onClick={onOpenOrders}
              >
                现有订单（共 {casWarning.orders.total_count} 条）：
              </button>
            ) : (
              <span className='font-bold'>现有订单（共 {casWarning.orders.total_count} 条）：</span>
            )}
            <span>订购人：{casWarning.orders.latest.applicant_name || '未知订购人'}，</span>
            <span>状态：{getOrderStatusLabel ? getOrderStatusLabel(casWarning.orders.latest.status) : casWarning.orders.latest.status}，</span>
            <span>规格：{casWarning.orders.latest.specification}</span>
          </p>
        )}

        {casWarning.inventory.total_count > 0 && casWarning.inventory.latest && (
          <p>
            {onOpenInventory ? (
              <button
                type='button'
                className='font-bold transition-colors hover:text-orange-950 dark:hover:text-orange-100'
                onClick={onOpenInventory}
              >
                现有库存（共 {casWarning.inventory.total_count} 条）：
              </button>
            ) : (
              <span className='font-bold'>现有库存（共 {casWarning.inventory.total_count} 条）：</span>
            )}
            <span>{casWarning.inventory.latest.storage_location || '位置未填写'}，</span>
            <span>{casWarning.inventory.latest.remaining_quantity ?? '-'} / {casWarning.inventory.latest.specification}</span>
          </p>
        )}
      </div>
    </div>
  )
}
