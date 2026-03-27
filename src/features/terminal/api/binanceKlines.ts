/**
 * Binance REST API for historical kline/candlestick data.
 * Used only for chart history; live data comes from data-provider WebSocket (bid).
 */

const BINANCE_REST_BASE =
  (import.meta.env.VITE_BINANCE_REST_URL as string | undefined) || 'https://api.binance.com'
const BINANCE_KLINES = `${BINANCE_REST_BASE}/api/v3/klines`

/** Binance kline response: [openTime, open, high, low, close, volume, closeTime, ...] */
type BinanceKlineRow = [number, string, string, string, string, string, number, ...unknown[]]

export interface KLineBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Map terminal symbol (e.g. BTC-USD) to Binance symbol (e.g. BTCUSDT) */
export function toBinanceSymbol(code: string, quoteCurrency?: string): string {
  const base = code.replace(/-/g, '').toUpperCase()
  if (!base) return 'BTCUSDT'
  if (base.endsWith('USD') && !base.endsWith('USDT')) {
    return base.slice(0, -3) + 'USDT'
  }
  if (quoteCurrency === 'USD') {
    const basePart = code.split('-')[0]?.toUpperCase() ?? base.slice(0, -3)
    return basePart + 'USDT'
  }
  return base
}

/** Map period to Binance interval (Binance uses m, h, d, w) */
export function toBinanceInterval(span: number, type: string): string {
  if (type === 'minute') return `${span}m`
  if (type === 'hour') return `${span}h`
  if (type === 'day') return `${span}d`
  if (type === 'week') return `${span}w`
  if (type === 'month') return `${span}M`
  if (type === 'second') return `${span}s`
  return '1d'
}

/** Chunk size for on-demand loading (scroll back/forward). Binance max per request is 1000. */
export const BARS_PER_CHUNK = 500

/**
 * Fetch historical klines from Binance (no auth required).
 * @param endTime - If set, return bars with open time <= endTime (for loading older data when scrolling back).
 * @param startTime - If set, return bars with open time >= startTime (for loading newer data when scrolling forward).
 */
export async function fetchBinanceKlines(
  binanceSymbol: string,
  interval: string,
  limit = BARS_PER_CHUNK,
  endTime?: number,
  startTime?: number
): Promise<KLineBar[]> {
  const params = new URLSearchParams({
    symbol: binanceSymbol,
    interval,
    limit: String(Math.min(limit, 1000)),
  })
  if (endTime != null) params.set('endTime', String(endTime))
  if (startTime != null) params.set('startTime', String(startTime))

  const url = `${BINANCE_KLINES}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Binance klines: ${res.status} ${res.statusText}`)
  }
  const rows = (await res.json()) as BinanceKlineRow[]

  return rows.map((row) => ({
    timestamp: row[0],
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  }))
}
