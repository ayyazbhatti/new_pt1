/**
 * Instrument quote prices (bid/ask/entry) — not wallet money amounts.
 * Uses symbol precision; no currency symbols (quote is implied by the pair).
 */

export interface SymbolPriceMeta {
  pricePrecision?: number | null
  digits?: number | null
  code?: string | null
}

/**
 * Format an instrument price using the symbol's price precision.
 *
 * - FX (e.g. EURUSD, AUDCAD): typically 5 decimals → `0.98518`
 * - JPY pairs (USDJPY, EURJPY): often 3 decimals → `150.235`
 * - Crypto (BTCUSDT): often 2 decimals → `77000.50`
 *
 * Returns a plain numeric string. Does **not** prepend a currency symbol — the quote
 * currency is implied by the pair (e.g. CAD per AUD on AUDCAD), not USD wallet money.
 */
export function formatSymbolPrice(
  price: number | string | null | undefined,
  symbol: SymbolPriceMeta | null | undefined,
): string {
  if (price == null || price === '') return '—'
  const num = typeof price === 'string' ? parseFloat(price) : price
  if (!Number.isFinite(num)) return '—'

  const precision = symbol?.pricePrecision ?? symbol?.digits ?? 2
  const safe = Math.max(0, Math.min(16, Math.floor(Number(precision)) || 2))
  return num.toFixed(safe)
}
