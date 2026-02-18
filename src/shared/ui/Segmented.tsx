import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface SegmentedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: { value: string; label: ReactNode }[]
  value: string
  onChange?: (value: string) => void
}

export function Segmented({ options, value, onChange, className, ...props }: SegmentedProps) {
  return (
    <div
      className={cn('inline-flex rounded-lg bg-surface-2 p-1', className)}
      {...props}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange?.(option.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            value === option.value
              ? 'bg-accent text-white'
              : 'text-text-dim hover:text-text'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

