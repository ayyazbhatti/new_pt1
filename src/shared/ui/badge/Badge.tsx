import { HTMLAttributes } from 'react'
import { cn } from '@/shared/utils'

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'neutral'
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'primary' && 'bg-accent/20 text-accent',
        variant === 'success' && 'bg-success/20 text-success',
        variant === 'danger' && 'bg-danger/20 text-danger',
        variant === 'warning' && 'bg-warning/20 text-warning',
        variant === 'info' && 'bg-info/20 text-info',
        variant === 'neutral' && 'bg-surface-2 text-text-dim',
        className
      )}
      {...props}
    />
  )
}

