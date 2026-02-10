import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Order } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { formatDateTime } from '../utils/formatters'

interface OrderDetailsModalProps {
  order: Order
}

export function OrderDetailsModal({ order }: OrderDetailsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = {
      filled: 'success',
      pending: 'warning',
      cancelled: 'neutral',
      rejected: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
  }

  const getSideBadge = (side: string) => {
    return (
      <Badge variant={side === 'buy' ? 'success' : 'danger'} className="uppercase">
        {side}
      </Badge>
    )
  }

  const timeline = [
    { label: 'Created', time: order.createdAt },
    { label: 'Updated', time: order.updatedAt },
    ...(order.filledAt ? [{ label: 'Filled', time: order.filledAt }] : []),
    ...(order.cancelledAt ? [{ label: 'Cancelled', time: order.cancelledAt }] : []),
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Order ID</div>
            <div className="font-mono font-semibold text-text">{order.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Status</div>
            {getStatusBadge(order.status)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-text">{order.userName}</div>
            <div className="text-xs text-text-muted font-mono">{order.userId}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Group</div>
            <div className="text-text">{order.groupName}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Symbol</div>
            <div className="font-mono font-semibold text-text">{order.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Side</div>
            {getSideBadge(order.side)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Type</div>
            <div className="capitalize text-text">{order.type}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Size</div>
            <div className="font-mono text-text">{order.size}</div>
          </div>
          {order.price && (
            <div>
              <div className="text-xs text-text-muted mb-1">Price</div>
              <div className="font-mono text-text">{order.price.toFixed(2)}</div>
            </div>
          )}
          {order.stopPrice && (
            <div>
              <div className="text-xs text-text-muted mb-1">Stop Price</div>
              <div className="font-mono text-text">{order.stopPrice.toFixed(2)}</div>
            </div>
          )}
          {order.filledSize && (
            <div>
              <div className="text-xs text-text-muted mb-1">Filled Size</div>
              <div className="font-mono text-text">{order.filledSize}</div>
            </div>
          )}
          {order.averagePrice && (
            <div>
              <div className="text-xs text-text-muted mb-1">Average Price</div>
              <div className="font-mono text-text">{order.averagePrice.toFixed(2)}</div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Timeline</div>
        <div className="space-y-2">
          {timeline.map((item, index) => (
            <div key={index} className="flex items-center justify-between text-sm">
              <span className="text-text-muted">{item.label}</span>
              <span className="font-mono text-text">{formatDateTime(item.time)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Raw JSON</div>
        <pre className="text-xs font-mono text-text-muted bg-surface-1 p-3 rounded overflow-auto max-h-48">
          {JSON.stringify(order, null, 2)}
        </pre>
      </Card>
    </div>
  )
}

