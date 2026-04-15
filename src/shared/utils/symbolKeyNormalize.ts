/**
 * Normalize symbol keys for matching WS ticks to UI rows.
 * Collapses `BTCUSDT` → `BTCUSD` so ticks align with codes like `BTC-USD`.
 * Does not collapse `EURUSDT` / `XAUUSDT` into forex `EURUSD` / `XAUUSD` (different instruments).
 */
export function normalizeSymbolKey(symbol: string): string {
  const u = symbol
    .toUpperCase()
    .trim()
    .replace(/\//g, '')
    .replace(/-/g, '')
  if (u === 'EURUSDT' || u === 'XAUUSDT') return u
  if (u.endsWith('USDT')) {
    return u.slice(0, -4) + 'USD'
  }
  return u
}
