import { Badge } from '@/shared/ui'
import { cn } from '@/shared/utils'

type Role = 'admin' | 'manager' | 'agent' | 'user'

const roleVariants: Record<Role, 'neutral' | 'primary' | 'success'> = {
  admin: 'primary',
  manager: 'neutral',
  agent: 'success',
  user: 'neutral',
}

interface RoleBadgeProps {
  role: string
  className?: string
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const r = (role?.toLowerCase() ?? 'user') as Role
  const variant = roleVariants[r] ?? 'neutral'
  return (
    <Badge variant={variant} className={cn('capitalize', className)}>
      {r}
    </Badge>
  )
}
