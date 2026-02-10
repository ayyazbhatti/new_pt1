import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { MarginEvent } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { formatDateTime } from '../utils/formatters'

interface EventDetailsModalProps {
  event: MarginEvent
}

export function EventDetailsModal({ event }: EventDetailsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const getTypeBadge = (type: string) => {
    return (
      <Badge variant={type === 'liquidation' ? 'danger' : 'warning'} className="uppercase">
        {type.replace('_', ' ')}
      </Badge>
    )
  }

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger'> = {
      low: 'success',
      medium: 'warning',
      high: 'danger',
    }
    return <Badge variant={variants[severity] || 'neutral'} className="capitalize">{severity}</Badge>
  }

  const suggestedActions = [
    'Monitor user account closely',
    'Consider reducing position size',
    'Review margin requirements',
    'Check for pending orders',
    event.type === 'liquidation' ? 'Position has been liquidated' : 'User may need to add margin',
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Event ID</div>
            <div className="font-mono font-semibold text-text">{event.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Type</div>
            {getTypeBadge(event.type)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Severity</div>
            {getSeverityBadge(event.severity)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Time</div>
            <div className="text-sm text-text-muted">{formatDateTime(event.time)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-text">{event.userName}</div>
            <div className="text-xs text-text-muted font-mono">{event.userId}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Group</div>
            <div className="text-text">{event.groupName}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Symbol</div>
            <div className="font-mono font-semibold text-text">{event.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Acknowledged</div>
            <Badge variant={event.acknowledged ? 'success' : 'neutral'}>
              {event.acknowledged ? 'Yes' : 'No'}
            </Badge>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Account Snapshot</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Equity</div>
            <div className="font-mono text-text">${event.equity.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Margin</div>
            <div className="font-mono text-text">${event.margin.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Free Margin</div>
            <div className={`font-mono ${event.freeMargin < 0 ? 'text-danger' : 'text-text'}`}>
              ${event.freeMargin.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Maintenance</div>
            <div className="font-mono text-text">${event.maintenance.toFixed(2)}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Message</div>
        <div className="text-sm text-text-muted">{event.message}</div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Suggested Actions</div>
        <ul className="space-y-1">
          {suggestedActions.map((action, index) => (
            <li key={index} className="text-sm text-text-muted flex items-start">
              <span className="mr-2">•</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

