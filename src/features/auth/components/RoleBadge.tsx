import { Badge } from '@/shared/ui'
import { cn } from '@/shared/utils'

type Role = 'admin' | 'manager' | 'agent'

const roleVariants: Record<Role, 'neutral' | 'primary' | 'success'> = {
  admin: 'primary',
  manager: 'neutral',
  agent: 'success',
}

interface RoleBadgeProps {
  role: string
  className?: string
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const r = (role?.toLowerCase() ?? 'agent') as Role
  const variant = roleVariants[r] ?? 'neutral'
  return (
    <Badge variant={variant} className={cn('capitalize', className)}>
      {r}
    </Badge>
  )
}
