import { useState, InputHTMLAttributes, forwardRef } from 'react'
import { Input } from '@/shared/ui/input'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/shared/utils'

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)

    return (
      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          ref={ref}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aab2c5] hover:text-[#e6e8ee] transition-colors"
          tabIndex={-1}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    )
  }
)
PasswordField.displayName = 'PasswordField'

