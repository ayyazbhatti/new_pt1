import { memo } from 'react'
import { useAdminTradingStore } from '../store/adminTrading.store'
import type { AdminPosition } from '../types'
import { cn } from '@/shared/utils'
import { computePositionPnl, computePnlPercent } from '../utils/pnl'
import { useFormatSignedFromQuoteCurrency } from '@/shared/currency'
import type { CurrencyCode } from '@/shared/currency/types'
import { useSymbolMetaLookup, getSymbolMetaForCode } from '@/features/terminal/hooks/useSymbolMetaLookup'

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

/** Row P&L from mark-to-market is in the symbol's quote currency; convert to the user's display currency. */
export const LivePnlAmountCell = memo(function LivePnlAmountCell({
  position,
  readOnly,
}: LivePnlCellProps) {
  const { pnl, isPositive } = useLivePnlValues(position, readOnly)
  const symbolMetaLookup = useSymbolMetaLookup()
  const formatSignedQuote = useFormatSignedFromQuoteCurrency()
  const quote =
    (getSymbolMetaForCode(symbolMetaLookup, position.symbol)?.quoteCurrency ?? 'USD').trim() || 'USD'
  return (
    <span className={cn('text-sm font-mono', isPositive ? 'text-success' : 'text-danger')}>
      {formatSignedQuote(pnl, quote as CurrencyCode)}
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
