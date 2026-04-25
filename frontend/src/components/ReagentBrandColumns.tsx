import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'

import type { ReagentBrandItem } from '@/api/client'
import { TableActionButtonsMemo } from '@/components/TableActionButtons'

export function ReagentBrandActionButtons({
  item,
  onEdit,
  onDelete,
}: {
  item: ReagentBrandItem
  onEdit: (item: ReagentBrandItem) => void
  onDelete: (item: ReagentBrandItem) => Promise<void>
}) {
  const actions = useMemo(() => [
    {
      id: 'delete',
      label: '删除',
      icon: <Trash2 className="size-4 text-destructive" />,
      className: 'text-destructive hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20',
      confirm: true,
      confirmLabel: '确认删除',
      onClick: onDelete,
    },
  ], [onDelete])

  return (
    <TableActionButtonsMemo
      item={item}
      actions={actions}
      showEdit={true}
      onEdit={onEdit}
    />
  )
}
