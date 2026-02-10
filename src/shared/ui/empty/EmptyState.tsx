import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      {title && <h3 className="text-lg font-semibold text-text mb-2">{title}</h3>}
      {description && <p className="text-sm text-text-muted text-center max-w-sm mb-4">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  )
}

