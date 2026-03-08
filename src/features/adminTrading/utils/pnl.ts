/**
 * Position PnL calculation aligned with backend (auth-service admin positions, order-engine).
 * CFD-style: LONG pnl = (mark - entry) × size, SHORT = (entry - mark) × size.
 * PnL % = (pnl / marginUsed) × 100 when marginUsed > 0.
 */

export type PositionSide = 'LONG' | 'SHORT'

/**
 * Compute unrealized PnL for a position given current mark price.
 */
export function computePositionPnl(
  entryPrice: number,
  markPrice: number,
  size: number,
  side: PositionSide
): number {
  if (size <= 0) return 0
  const pnl =
    side === 'LONG'
      ? (markPrice - entryPrice) * size
      : (entryPrice - markPrice) * size
  return Math.round(pnl * 100) / 100
}

/**
 * Compute PnL percentage relative to margin used (matches backend admin_positions).
 */
export function computePnlPercent(pnl: number, marginUsed: number): number {
  if (marginUsed <= 0) return 0
  return Math.round((pnl / marginUsed) * 10000) / 100
}
