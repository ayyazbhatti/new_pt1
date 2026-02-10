import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface ContentShellProps {
  children: ReactNode
  className?: string
}

export function ContentShell({ children, className }: ContentShellProps) {
  return (
    <div className={cn('container mx-auto p-6', className)}>
      {children}
    </div>
  )
}

