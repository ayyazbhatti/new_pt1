import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface ContentShellProps {
  children: ReactNode
  className?: string
}

export function ContentShell({ children, className }: ContentShellProps) {
  return (
    <div className={cn('container mx-auto px-4 py-4 sm:px-6 sm:py-6', className)}>
      {children}
    </div>
  )
}

