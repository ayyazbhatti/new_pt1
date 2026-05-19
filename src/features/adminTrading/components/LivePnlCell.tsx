import { memo } from 'react'
import { useAdminTradingStore } from '../store/adminTrading.store'
import type { AdminPosition } from '../types'
import { cn } from '@/shared/utils'
import { computePositionPnl, computePnlPercent } from '../utils/pnl'

interface LivePnlCellProps {
  position: AdminPosition
  readOnly?: boolean
}

function useLivePnlValues(position: AdminPosition, readOnly?: boolean) {
  const symbolKey = position.symbol?.toUpperCase() ?? ''
  const liveMark = useAdminTradingStore((s) =>
    symbolKey ? s.liveMarkBySymbol[symbolKey] : undefined
  )

  const isOpen = position.status === 'OPEN' || position.status === 'open'
  const isLive =
    !readOnly && isOpen && typeof liveMark === 'number' && Number.isFinite(liveMark)
  const pnl = isLive
    ? computePositionPnl(position.entryPrice, liveMark, position.size, position.side)
    : position.pnl
  const pnlPercent = isLive
    ? computePnlPercent(pnl, position.marginUsed || 1)
    : position.pnlPercent

  return { pnl, pnlPercent, isPositive: pnl >= 0 }
}

/** Dollar PnL only — subscribes to this row's symbol mark. */
export const LivePnlAmountCell = memo(function LivePnlAmountCell({
  position,
  readOnly,
}: LivePnlCellProps) {
  const { pnl, isPositive } = useLivePnlValues(position, readOnly)
  return (
    <span className={cn('text-sm font-mono', isPositive ? 'text-success' : 'text-danger')}>
      {isPositive ? '+' : ''}${pnl.toFixed(2)}
    </span>
  )
})

/** PnL % only — subscribes to this row's symbol mark. */
export const LivePnlPercentCell = memo(function LivePnlPercentCell({
  position,
  readOnly,
}: LivePnlCellProps) {
  const { pnlPercent, isPositive } = useLivePnlValues(position, readOnly)
  return (
    <span className={cn('text-sm font-mono', isPositive ? 'text-success' : 'text-danger')}>
      {isPositive ? '+' : ''}
      {pnlPercent.toFixed(2)}%
    </span>
  )
})
