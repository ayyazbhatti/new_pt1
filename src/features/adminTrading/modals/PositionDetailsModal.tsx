import { useState } from 'react'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Position } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { formatDateTime, formatPercent } from '../utils/formatters'
import { toast } from 'react-hot-toast'

interface PositionDetailsModalProps {
  position: Position
}

export function PositionDetailsModal({ position }: PositionDetailsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [notes, setNotes] = useState('')

  const getSideBadge = (side: string) => {
    return (
      <Badge variant={side === 'long' ? 'success' : 'danger'} className="uppercase">
        {side}
      </Badge>
    )
  }

  const pnlColor = position.pnl >= 0 ? 'text-success' : 'text-danger'

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Position ID</div>
            <div className="font-mono font-semibold text-text">{position.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Status</div>
            <Badge variant={position.status === 'open' ? 'success' : 'neutral'}>
              {position.status}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-text">{position.userName}</div>
            <div className="text-xs text-text-muted font-mono">{position.userId}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Group</div>
            <div className="text-text">{position.groupName}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Symbol</div>
            <div className="font-mono font-semibold text-text">{position.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Side</div>
            {getSideBadge(position.side)}
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Entry Price</div>
            <div className="font-mono text-text">{position.entryPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Mark Price</div>
            <div className="font-mono text-text">{position.markPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">PnL</div>
            <div className={`font-mono font-semibold ${pnlColor}`}>
              {position.pnl >= 0 ? '+' : ''}
              {position.pnl.toFixed(2)}
            </div>
            <div className={`text-xs ${pnlColor}`}>{formatPercent(position.pnlPercent)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Leverage</div>
            <div className="font-mono text-text">1:{position.leverage}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Margin Used</div>
            <div className="font-mono text-text">${position.marginUsed.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Liquidation Price</div>
            <div className="font-mono text-danger">{position.liquidationPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Size</div>
            <div className="font-mono text-text">{position.size}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Opened</div>
            <div className="text-sm text-text-muted">{formatDateTime(position.openedAt)}</div>
          </div>
          {position.closedAt && (
            <div>
              <div className="text-xs text-text-muted mb-1">Closed</div>
              <div className="text-sm text-text-muted">{formatDateTime(position.closedAt)}</div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Admin Notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="flex min-h-[100px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Add admin notes for this position..."
        />
      </Card>

      {position.status === 'open' && (
        <div className="flex justify-end gap-2">
          <Button
            variant="danger"
            onClick={() => {
              toast.success('Close position functionality coming soon')
            }}
          >
            Close Position
          </Button>
        </div>
      )}
    </div>
  )
}

