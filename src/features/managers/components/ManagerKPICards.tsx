import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Users, CheckCircle, XCircle, Shield } from 'lucide-react'
import type { Manager } from '../types/manager'

interface ManagerKPICardsProps {
  managers: Manager[]
}

const STAT_CARDS = [
  {
    key: 'total',
    label: 'Total Managers',
    getValue: (managers: Manager[]) => managers.length,
    icon: Users,
    iconClassName: 'text-text-muted',
    badge: { label: 'All manager accounts', variant: 'neutral' as const },
  },
  {
    key: 'active',
    label: 'Active',
    getValue: (managers: Manager[]) => managers.filter((m) => m.status === 'active').length,
    icon: CheckCircle,
    iconClassName: 'text-emerald-500',
    badge: { label: 'Can access admin', variant: 'success' as const },
  },
  {
    key: 'disabled',
    label: 'Disabled',
    getValue: (managers: Manager[]) => managers.filter((m) => m.status === 'disabled').length,
    icon: XCircle,
    iconClassName: 'text-slate-500',
    badge: { label: 'Access revoked', variant: 'neutral' as const },
  },
  {
    key: 'profiles',
    label: 'Permission Profiles',
    getValue: (managers: Manager[]) => new Set(managers.map((m) => m.permissionProfileId)).size,
    icon: Shield,
    iconClassName: 'text-blue-500',
    badge: { label: 'In use', variant: 'neutral' as const },
  },
]

export function ManagerKPICards({ managers }: ManagerKPICardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon
        const value = card.getValue(managers)
        return (
          <Card key={card.key} className="p-4 bg-surface-2 flex items-start gap-3">
            <div className={`rounded-lg bg-surface-1 p-2 shrink-0 ${card.iconClassName}`}>
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text-muted mb-1">{card.label}</div>
              <div className="text-2xl font-bold text-text mb-2">{value}</div>
              <Badge variant={card.badge.variant} className="text-xs">
                {card.badge.label}
              </Badge>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
