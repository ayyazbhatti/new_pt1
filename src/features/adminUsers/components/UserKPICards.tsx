import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Users, Activity, FileCheck, ShieldAlert } from 'lucide-react'
import { User } from '../types/users'

interface UserKPICardsProps {
  users: User[]
  /** When using server-side pagination, pass total count from API for "Total Users" card */
  totalFromServer?: number
}

const STAT_CARDS = [
  {
    key: 'total',
    label: 'Total Users',
    getValue: (users: User[], totalFromServer?: number) => totalFromServer ?? users.length,
    icon: Users,
    iconClassName: 'text-text-muted',
    badge: { label: 'All accounts', variant: 'neutral' as const },
  },
  {
    key: 'active',
    label: 'Active Traders',
    getValue: (users: User[]) => users.filter((u) => u.openPositions > 0).length,
    icon: Activity,
    iconClassName: 'text-emerald-500',
    badge: { label: 'With open positions', variant: 'success' as const },
  },
  {
    key: 'kyc',
    label: 'KYC Pending',
    getValue: (users: User[]) => users.filter((u) => u.kycStatus === 'pending').length,
    icon: FileCheck,
    iconClassName: 'text-amber-500',
    badge: { label: 'Requires review', variant: 'warning' as const },
  },
  {
    key: 'restricted',
    label: 'Restricted Accounts',
    getValue: (users: User[]) =>
      users.filter((u) => u.status === 'suspended' || u.status === 'disabled').length,
    icon: ShieldAlert,
    iconClassName: 'text-red-500',
    badge: { label: 'Suspended/Disabled/High Risk', variant: 'danger' as const },
  },
]

export function UserKPICards({ users, totalFromServer }: UserKPICardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon
        const value = card.key === 'total' ? card.getValue(users, totalFromServer) : card.getValue(users)
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

