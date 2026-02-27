import type { AppointmentStatus } from '../types'
import { getStatusBadgeClasses } from '../utils/format'
import { cn } from '@/shared/utils'

interface StatusBadgeProps {
  status: AppointmentStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn(getStatusBadgeClasses(status), className)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
