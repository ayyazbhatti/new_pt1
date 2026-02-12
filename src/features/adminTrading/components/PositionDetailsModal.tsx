import { ModalShell } from '@/shared/ui/modal'
import { Badge } from '@/shared/ui/badge'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { format } from 'date-fns'
import { cn } from '@/shared/utils'

export function PositionDetailsModal() {
  const { openModal, setOpenModal, selectedPositionId, positions } = useAdminTradingStore()
  const position = selectedPositionId ? positions.get(selectedPositionId) : null
  const open = openModal === 'position-details'

  if (!position) return null

  const pnlIsPositive = position.pnl >= 0

  return (
    <ModalShell
      open={open}
      onOpenChange={(open) => setOpenModal(open ? 'position-details' : null)}
      title="Position Details"
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Position ID</div>
            <div className="font-mono text-sm text-text">{position.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Status</div>
            <Badge
              variant={
                position.status === 'OPEN' ? 'success' : position.status === 'LIQUIDATED' ? 'danger' : 'neutral'
              }
            >
              {position.status}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-sm text-text">{position.userName}</div>
            <div className="text-xs text-text-muted">{position.userEmail}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Group</div>
            <div className="text-sm text-text">{position.groupName}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Symbol</div>
            <div className="text-sm font-medium text-text">{position.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Side</div>
            <Badge variant={position.side === 'LONG' ? 'success' : 'danger'}>{position.side}</Badge>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Size</div>
            <div className="text-sm font-mono text-text">{position.size.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Leverage</div>
            <div className="text-sm font-mono text-text">{position.leverage}×</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Entry Price</div>
            <div className="text-sm font-mono text-text">${position.entryPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Mark Price</div>
            <div className="text-sm font-mono text-text">${position.markPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">PnL</div>
            <div className={cn('text-sm font-mono font-semibold', pnlIsPositive ? 'text-success' : 'text-danger')}>
              {pnlIsPositive ? '+' : ''}${position.pnl.toFixed(2)} ({pnlIsPositive ? '+' : ''}
              {position.pnlPercent.toFixed(2)}%)
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Margin Used</div>
            <div className="text-sm font-mono text-text">${position.marginUsed.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Liquidation Price</div>
            <div className="text-sm font-mono text-text">${position.liquidationPrice.toFixed(2)}</div>
          </div>
          {position.stopLoss && (
            <div>
              <div className="text-xs text-text-muted mb-1">Stop Loss</div>
              <div className="text-sm font-mono text-text">${position.stopLoss.toFixed(2)}</div>
            </div>
          )}
          {position.takeProfit && (
            <div>
              <div className="text-xs text-text-muted mb-1">Take Profit</div>
              <div className="text-sm font-mono text-text">${position.takeProfit.toFixed(2)}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-text-muted mb-1">Opened</div>
            <div className="text-sm text-text">{format(new Date(position.openedAt), 'PPpp')}</div>
          </div>
          {position.closedAt && (
            <div>
              <div className="text-xs text-text-muted mb-1">Closed</div>
              <div className="text-sm text-text">{format(new Date(position.closedAt), 'PPpp')}</div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

