import { ModalShell } from '@/shared/ui/modal'
import { Badge } from '@/shared/ui/badge'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { format } from 'date-fns'
import { cn } from '@/shared/utils'
import { useFormatFromUsd, useFormatSignedFromUsd } from '@/shared/currency'
import { formatPositionSize } from '@/shared/finance/sizeFormat'
import { useSymbolMetaLookup, getSymbolMetaForCode } from '@/features/terminal/hooks/useSymbolMetaLookup'
import { closedPositionPnlParts, openPositionPnlParts, PositionPnLBreakdown } from '@/shared/components/PositionPnLBreakdown'

export function PositionDetailsModal() {
  const { openModal, setOpenModal, selectedPositionId, positions, positionHistory } =
    useAdminTradingStore()
  const formatMoney = useFormatFromUsd()
  const formatSigned = useFormatSignedFromUsd()
  const symbolMetaLookup = useSymbolMetaLookup()
  const position = selectedPositionId
    ? positions.get(selectedPositionId) ?? positionHistory.get(selectedPositionId)
    : null
  const open = openModal === 'position-details'

  if (!position) return null

  const sizeFmt = formatPositionSize(
    position.size,
    getSymbolMetaForCode(symbolMetaLookup, position.symbol),
  )

  const isOpen = position.status === 'OPEN' || position.status === 'open'
  const pnlParts = isOpen
    ? openPositionPnlParts(
        {
          side: position.side === 'LONG' ? 'LONG' : 'SHORT',
          unrealized_pnl: String(position.pnl),
          accumulatedSwapUsd:
            position.accumulatedSwapUsd != null ? String(position.accumulatedSwapUsd) : undefined,
          accumulatedFeesUsd:
            position.accumulatedFeesUsd != null ? String(position.accumulatedFeesUsd) : undefined,
        },
        position.markPrice,
        position.size,
        position.entryPrice,
      )
    : closedPositionPnlParts({
        realized_pnl: String(position.pnl),
        accumulatedSwapUsd:
          position.accumulatedSwapUsd != null ? String(position.accumulatedSwapUsd) : undefined,
        accumulatedFeesUsd:
          position.accumulatedFeesUsd != null ? String(position.accumulatedFeesUsd) : undefined,
      })

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
            <div className="text-sm font-mono text-text" title={sizeFmt.secondary || undefined}>
              {sizeFmt.display}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Leverage</div>
            <div className="text-sm font-mono text-text">{position.leverage}×</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Entry Price</div>
            <div className="text-sm font-mono text-text">{position.entryPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Mark Price</div>
            <div className="text-sm font-mono text-text">{position.markPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">PnL (engine)</div>
            <div className={cn('text-sm font-mono font-semibold', pnlIsPositive ? 'text-success' : 'text-danger')}>
              {formatSigned(position.pnl)} ({pnlIsPositive ? '+' : ''}
              {position.pnlPercent.toFixed(2)}%)
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Margin Used</div>
            <div className="text-sm font-mono text-text">{formatMoney(position.marginUsed)}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Liquidation Price</div>
            <div className="text-sm font-mono text-text">{position.liquidationPrice.toFixed(2)}</div>
          </div>
          {position.stopLoss && (
            <div>
              <div className="text-xs text-text-muted mb-1">Stop Loss</div>
              <div className="text-sm font-mono text-text">{position.stopLoss.toFixed(2)}</div>
            </div>
          )}
          {position.takeProfit && (
            <div>
              <div className="text-xs text-text-muted mb-1">Take Profit</div>
              <div className="text-sm font-mono text-text">{position.takeProfit.toFixed(2)}</div>
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
        <div className="rounded-lg border border-border bg-surface-2/40 p-4">
          <div className="text-sm font-semibold text-text mb-2">P&L breakdown</div>
          <PositionPnLBreakdown
            marketPnlUsd={pnlParts.market}
            accumulatedSwapUsd={position.accumulatedSwapUsd}
            accumulatedFeesUsd={position.accumulatedFeesUsd}
            netPnlUsd={pnlParts.net}
          />
        </div>
      </div>
    </ModalShell>
  )
}

