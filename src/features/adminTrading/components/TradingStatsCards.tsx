import { Card } from '@/shared/ui/card'
import { Order, Position, MarginEvent } from '../types/adminTrading'

interface TradingStatsCardsProps {
  orders: Order[]
  positions: Position[]
  marginEvents: MarginEvent[]
}

export function TradingStatsCards({ orders, positions, marginEvents }: TradingStatsCardsProps) {
  const activeOrders = orders.filter((o) => o.status === 'pending').length
  const openPositions = positions.filter((p) => p.status === 'open').length
  const totalExposure = positions
    .filter((p) => p.status === 'open')
    .reduce((sum, p) => sum + p.size * p.markPrice, 0)
  const marginEventsToday = marginEvents.filter((e) => {
    const eventDate = new Date(e.time).toDateString()
    const today = new Date().toDateString()
    return eventDate === today
  }).length

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Active Orders</div>
        <div className="text-2xl font-bold text-text">{activeOrders}</div>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Open Positions</div>
        <div className="text-2xl font-bold text-text">{openPositions}</div>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Total Exposure</div>
        <div className="text-2xl font-bold text-text">
          ${(totalExposure / 1000000).toFixed(2)}M
        </div>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="text-sm text-text-muted mb-1">Margin Events Today</div>
        <div className="text-2xl font-bold text-text">{marginEventsToday}</div>
      </Card>
    </div>
  )
}

