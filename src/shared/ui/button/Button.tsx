import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/shared/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'success' | 'danger'
  size?: 'sm' | 'default' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-lg active:rounded-lg hover:rounded-lg focus:rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-0 active:ring-0 hover:ring-0 disabled:opacity-50 disabled:pointer-events-none border-0 active:border-0 focus:border-0 hover:border-0',
          variant === 'primary' && 'bg-accent text-white hover:bg-accent/90 active:bg-accent/80',
          variant === 'secondary' && 'bg-surface-2 text-text hover:bg-surface-2/80 active:bg-surface-2/70',
          variant === 'ghost' && 'bg-transparent text-text hover:bg-surface-2 active:bg-surface-2/80',
          variant === 'outline' && 'bg-transparent border border-border text-text hover:bg-surface-2 active:bg-surface-2/80',
          variant === 'success' && 'bg-success text-white hover:bg-success/90 active:bg-success/80',
          variant === 'danger' && 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
          size === 'sm' && 'px-3 py-1.5 text-xs',
          size === 'lg' && 'px-6 py-3 text-base',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

