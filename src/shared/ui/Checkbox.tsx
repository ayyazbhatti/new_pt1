import { InputHTMLAttributes, forwardRef, useEffect, useRef } from 'react'
import { cn } from '@/shared/utils'
import { Check, Minus } from 'lucide-react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** When true, shows indeterminate state (e.g. "some selected") */
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, indeterminate, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement | null>(null)
    const setRef = (el: HTMLInputElement | null) => {
      inputRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    }
    useEffect(() => {
      const el = inputRef.current
      if (el) el.indeterminate = indeterminate ?? false
    }, [indeterminate])
    const isIndeterminate = indeterminate === true
    const showChecked = checked && !isIndeterminate
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          ref={setRef}
          checked={checked}
          className="sr-only"
          {...props}
        />
        <div
          className={cn(
            'h-4 w-4 rounded border flex items-center justify-center transition-colors',
            showChecked || isIndeterminate
              ? 'bg-accent border-accent'
              : 'bg-surface border-border hover:border-accent/50',
            className
          )}
        >
          {showChecked && <Check className="h-3 w-3 text-white" />}
          {isIndeterminate && <Minus className="h-3 w-3 text-white" />}
        </div>
      </label>
    )
  }
)
Checkbox.displayName = 'Checkbox'

