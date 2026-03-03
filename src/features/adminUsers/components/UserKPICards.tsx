import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { User } from '../types/users'

interface UserKPICardsProps {
  users: User[]
}

export function UserKPICards({ users }: UserKPICardsProps) {
  const totalUsers = users.length
  const activeTraders = users.filter((u) => u.openPositions > 0).length
  const kycPending = users.filter((u) => u.kycStatus === 'pending').length
  const restrictedAccounts = users.filter(
    (u) => u.status === 'suspended' || u.status === 'disabled'
  ).length

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Total Users</div>
        <div className="text-2xl font-bold text-text mb-2">{totalUsers}</div>
        <Badge variant="neutral" className="text-xs">All accounts</Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Active Traders</div>
        <div className="text-2xl font-bold text-text mb-2">{activeTraders}</div>
        <Badge variant="success" className="text-xs">With open positions</Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">KYC Pending</div>
        <div className="text-2xl font-bold text-text mb-2">{kycPending}</div>
        <Badge variant="warning" className="text-xs">Requires review</Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Restricted Accounts</div>
        <div className="text-2xl font-bold text-text mb-2">{restrictedAccounts}</div>
        <Badge variant="danger" className="text-xs">Suspended/Disabled/High Risk</Badge>
      </Card>
    </div>
  )
}

