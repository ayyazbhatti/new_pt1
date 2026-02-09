import { HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/shared/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(elevated ? 'card-elevated' : 'card', className)}
        {...props}
      />
    )
  }
)
Card.displayName = 'Card'

