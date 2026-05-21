import { useFormatSignedFromUsd } from '@/shared/currency'

/**
 * Trading-costs P&L breakdown (Phase 5).
 *
 * - **Open positions:** `marketPnlUsd` is mark-to-market from live prices when available; otherwise it is
 *   derived from stored `unrealized_pnl` + swap + fees (treating stored unrealized as **net**).
 * - **Closed positions:** `realized_pnl` from the API is treated as **market** P&L; net = market − swap − fees.
 */

/** Parse API numeric strings / numbers; non-finite → 0. */
export function pnlCostNumber(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Open position: `realized_pnl` is not used. `unrealized_pnl` from API is treated as **net of swap**
 * when live price is unavailable (Redis/engine). When live price exists, **market** PnL is recomputed from prices.
 */
export function openPositionPnlParts(
  pos: { side: string; unrealized_pnl?: string; accumulatedSwapUsd?: string; accumulatedFeesUsd?: string },
  livePrice: number | null,
  sizeNum: number,
  entryPrice: number,
): { market: number; net: number; swap: number; fees: number } {
  const swap = pnlCostNumber(pos.accumulatedSwapUsd)
  const fees = pnlCostNumber(pos.accumulatedFeesUsd)
  let market: number
  if (livePrice !== null && sizeNum > 0 && entryPrice > 0) {
    market =
      pos.side === 'LONG'
        ? (livePrice - entryPrice) * sizeNum
        : (entryPrice - livePrice) * sizeNum
  } else {
    const stored = pnlCostNumber(pos.unrealized_pnl)
    market = stored + swap + fees
  }
  const net = market - swap - fees
  return { market, net, swap, fees }
}

/**
 * Closed position: `realized_pnl` from API is **market** PnL (engine/Lua). Lifetime swap/fees on the row are debits.
 */
export function closedPositionPnlParts(pos: {
  realized_pnl?: string
  accumulatedSwapUsd?: string
  accumulatedFeesUsd?: string
}): { market: number; net: number; swap: number; fees: number } {
  const market = pnlCostNumber(pos.realized_pnl)
  const swap = pnlCostNumber(pos.accumulatedSwapUsd)
  const fees = pnlCostNumber(pos.accumulatedFeesUsd)
  const net = market - swap - fees
  return { market, net, swap, fees }
}

export interface PositionPnLBreakdownProps {
  /** Market PnL (mark-to-market or closed engine PnL), before swap/fees. */
  marketPnlUsd?: string | number | null
  accumulatedSwapUsd?: string | number | null
  accumulatedFeesUsd?: string | number | null
  /** Net after costs; if omitted, computed as market − swap − fees. */
  netPnlUsd?: string | number | null
  compact?: boolean
}

export function PositionPnLBreakdown({
  marketPnlUsd,
  accumulatedSwapUsd,
  accumulatedFeesUsd,
  netPnlUsd,
  compact,
}: PositionPnLBreakdownProps) {
  const formatSigned = useFormatSignedFromUsd()

  const swap = pnlCostNumber(accumulatedSwapUsd)
  const fees = pnlCostNumber(accumulatedFeesUsd)
  const market = pnlCostNumber(marketPnlUsd)
  const net =
    netPnlUsd != null && String(netPnlUsd).trim() !== ''
      ? pnlCostNumber(netPnlUsd)
      : market - swap - fees
  const hasCosts = swap !== 0 || fees !== 0

  if (!hasCosts && compact) {
    return <span>{formatSigned(net)}</span>
  }

  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between gap-3 font-semibold">
        <span>Net P&L</span>
        <span className={net >= 0 ? 'text-success' : 'text-danger'}>{formatSigned(net)}</span>
      </div>
      {hasCosts && (
        <div className="text-xs space-y-0.5 pl-2 opacity-80">
          <div className="flex justify-between gap-3">
            <span>Market P&L</span>
            <span>{formatSigned(market)}</span>
          </div>
          {swap !== 0 && (
            <div className="flex justify-between gap-3">
              <span>Swap</span>
              <span>{formatSigned(-swap)}</span>
            </div>
          )}
          {fees !== 0 && (
            <div className="flex justify-between gap-3">
              <span>Fees</span>
              <span>{formatSigned(-fees)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
