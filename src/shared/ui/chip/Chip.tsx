import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface ChipProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
  onRemove?: () => void
}

export function Chip({ children, className, variant = 'default', size = 'md', onRemove }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-sm',
        variant === 'default' && 'border-border bg-surface-2 text-text',
        variant === 'primary' && 'border-accent/50 bg-accent/10 text-accent',
        variant === 'success' && 'border-success/50 bg-success/10 text-success',
        variant === 'warning' && 'border-warning/50 bg-warning/10 text-warning',
        variant === 'danger' && 'border-danger/50 bg-danger/10 text-danger',
        className
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 focus:outline-none"
          aria-label="Remove"
        >
          <span className="text-current opacity-70 hover:opacity-100">×</span>
        </button>
      )}
    </span>
  )
}
