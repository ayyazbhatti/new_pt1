import { HTMLAttributes } from 'react'
import { cn } from '@/shared/utils'

interface SwitchProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onChange' | 'onCheckedChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  onChange?: (checked: boolean) => void
}

export function Switch({ checked = false, onCheckedChange, onChange, className, ...props }: SwitchProps) {
  const handleToggle = () => {
    const newValue = !checked
    onCheckedChange?.(newValue)
    onChange?.(newValue)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleToggle}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-surface-2',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

