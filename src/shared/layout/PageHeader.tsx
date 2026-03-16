import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  backLink?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, backLink, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-center justify-between', className)}>
      <div>
        {backLink && <div className="mb-2">{backLink}</div>}
        <h1 className="text-xl font-bold text-text sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-xs text-text-muted sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

