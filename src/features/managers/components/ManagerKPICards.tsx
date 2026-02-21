import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import type { Manager } from '../types/manager'

interface ManagerKPICardsProps {
  managers: Manager[]
}

export function ManagerKPICards({ managers }: ManagerKPICardsProps) {
  const total = managers.length
  const active = managers.filter((m) => m.status === 'active').length
  const disabled = managers.filter((m) => m.status === 'disabled').length

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Total Managers</div>
        <div className="text-2xl font-bold text-text mb-2">{total}</div>
        <Badge variant="neutral" className="text-xs">
          All manager accounts
        </Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Active</div>
        <div className="text-2xl font-bold text-text mb-2">{active}</div>
        <Badge variant="success" className="text-xs">
          Can access admin
        </Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Disabled</div>
        <div className="text-2xl font-bold text-text mb-2">{disabled}</div>
        <Badge variant="neutral" className="text-xs">
          Access revoked
        </Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Permission Profiles</div>
        <div className="text-2xl font-bold text-text mb-2">
          {new Set(managers.map((m) => m.permissionProfileId)).size}
        </div>
        <Badge variant="neutral" className="text-xs">
          In use
        </Badge>
      </Card>
    </div>
  )
}
