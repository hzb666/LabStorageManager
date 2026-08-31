import { AlertTriangle } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/Tooltip'
import {
  getDashboardAlertBadgeClassName,
  type DashboardAlertTone,
} from '@/lib/dashboardUtils'

interface DashboardAlertBadgeProps {
  label: string
  tooltip: string
  tone?: DashboardAlertTone
}

export function DashboardAlertBadge({
  label,
  tooltip,
  tone = 'destructive',
}: Readonly<DashboardAlertBadgeProps>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`${getDashboardAlertBadgeClassName(tone)} cursor-help`}
          aria-label={tooltip}
          tabIndex={0}
        >
          <AlertTriangle className="size-3" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}
