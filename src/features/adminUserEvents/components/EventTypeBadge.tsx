import { DollarSign, KeyRound, LogIn, LogOut, Shield, UserPlus } from 'lucide-react'
import { cn } from '@/shared/utils'
import { eventTypeLabel } from '../types'

const EVENT_CONFIG: Record<
  string,
  { label: string; className: string; icon: typeof LogIn }
> = {
  'auth.register': {
    label: 'Registered',
    className: 'bg-emerald-500/20 text-emerald-400',
    icon: UserPlus,
  },
  'auth.login': {
    label: 'Logged in',
    className: 'bg-blue-500/20 text-blue-400',
    icon: LogIn,
  },
  'auth.logout': {
    label: 'Logged out',
    className: 'bg-amber-500/20 text-amber-400',
    icon: LogOut,
  },
  'auth.session_created': {
    label: 'Session created',
    className: 'bg-surface-2 text-text-muted',
    icon: LogIn,
  },
  'auth.password_reset': {
    label: 'Password reset',
    className: 'bg-purple-500/20 text-purple-400',
    icon: KeyRound,
  },
  'admin.impersonate': {
    label: 'Admin impersonation',
    className: 'bg-red-500/20 text-red-400',
    icon: Shield,
  },
  'finance.deposit_approved': {
    label: 'Deposit approved',
    className: 'bg-emerald-500/20 text-emerald-400',
    icon: DollarSign,
  },
  'finance.deposit_rejected': {
    label: 'Deposit rejected',
    className: 'bg-danger/20 text-danger',
    icon: DollarSign,
  },
}

export function EventTypeBadge({ eventType }: { eventType: string }) {
  const config = EVENT_CONFIG[eventType] ?? {
    label: eventTypeLabel(eventType),
    className: 'bg-surface-2 text-text-muted',
    icon: LogIn,
  }
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}
