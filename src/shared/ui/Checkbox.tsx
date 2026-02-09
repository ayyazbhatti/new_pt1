import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/shared/utils'
import { Check } from 'lucide-react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          className="sr-only"
          {...props}
        />
        <div
          className={cn(
            'h-4 w-4 rounded border flex items-center justify-center transition-colors',
            checked
              ? 'bg-accent border-accent'
              : 'bg-surface border-border hover:border-accent/50',
            className
          )}
        >
          {checked && <Check className="h-3 w-3 text-white" />}
        </div>
      </label>
    )
  }
)
Checkbox.displayName = 'Checkbox'

