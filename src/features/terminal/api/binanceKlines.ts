/**
 * Binance REST API for historical kline/candlestick data.
 * MMDPS forex symbols use data-provider `GET /feed/history` (server proxies MMDPS; no API key in browser).
 * Live ticks for both paths come from the price WebSocket.
 */

import { getDataProviderPricesBaseUrl } from '@/shared/ws/priceStreamClient'

const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines'

/** Keep in sync with `backend/data-provider/src/feeds/routing.rs` `is_binance_spot_style`. */
function isFiat3(code: string): boolean {
  return (
    /^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|SEK|NOK|DKK|MXN|ZAR|TRY|PLN|HUF|CZK|ILS|CNY|CNH|HKD|SGD|RON|RUB|INR|IDR|THB|PHP|KRW|SAR|AED|COP|BRL|ARS|CLP|PEN|BGN|HRK|ISK|MAD|TWD|MYR|VND|BHD|JOD|KWD|OMR|QAR|EGP|NGN|GHS|KES|UGX|TZS|ZMW)$/.test(
      code
    )
  )
}

function isLikelyClassicFxOrMetal6(key: string): boolean {
  if (key.length !== 6 || !/^[A-Z]{6}$/.test(key)) return false
  const a = key.slice(0, 3)
  const b = key.slice(3, 6)
  if (isFiat3(a) && isFiat3(b)) return true
  const metal3 = ['XAU', 'XAG', 'XPT', 'XPD']
  if (metal3.includes(a) && isFiat3(b)) return true
  return false
}

/** Binance multiplex spot tickers — must match data-provider `is_binance_spot_style`. */
function isBinanceSpotStyleSymbol(key: string): boolean {
  if (isLikelyClassicFxOrMetal6(key)) return false
  const stableQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDD', 'DAI']
  if (stableQuotes.some((q) => key.length > q.length && key.endsWith(q))) return true
  const cryptoQuotes = [
    'EUR',
    'TRY',
    'BRL',
    'BTC',
    'ETH',
    'BNB',
    'AUD',
    'GBP',
    'RUB',
    'ZAR',
    'MXN',
    'ARS',
    'PLN',
    'RON',
    'UAH',
    'NGN',
  ]
  return cryptoQuotes.some((q) => key.length > q.length && key.endsWith(q))
}

/** Normalized key for matching terminal symbols to feed symbols (e.g. EUR-USD → EURUSD). */
export function normalizeChartSymbolKey(code: string): string {
  return code.replace(/-/g, '').toUpperCase()
}

/**
 * True when this chart should load history via data-provider `/feed/history` (MMDPS proxy).
 * With `VITE_DATA_PROVIDER_*` set: any non–Binance-style symbol uses MMDPS (matches server auto-routing).
 * Override with `VITE_MMDPS_SYMBOLS` (comma list); set to empty string to force Binance-only charts.
 */
export function isMmdpsChartSymbol(feedSymbol: string): boolean {
  const key = normalizeChartSymbolKey(feedSymbol)
  const env = typeof import.meta !== 'undefined' && (import.meta as ImportMeta).env
  const explicit = env?.VITE_MMDPS_SYMBOLS
  if (explicit === '') return false
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const set = new Set<string>()
    for (const part of String(explicit).split(',')) {
      const s = part.trim().toUpperCase()
      if (s) set.add(s)
    }
    return set.has(key)
  }
  if (!getDataProviderPricesBaseUrl()) return false
  return !isBinanceSpotStyleSymbol(key)
}

/**
 * Symbol string passed to chart history loaders: MMDPS-listed pairs stay EURUSD-style; others map to Binance (e.g. BTCUSDT).
 */
export function toChartFeedSymbol(code: string, quoteCurrency?: string): string {
  const key = normalizeChartSymbolKey(code)
  if (isMmdpsChartSymbol(key)) return key
  return toBinanceSymbol(code, quoteCurrency)
}

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

function num(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string') {
    const n = parseFloat(x)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/** Best-effort parse: MMDPS may return arrays, objects, or `{ data | candles: [...] }`. */
function parseMmdpsHistoryPayload(json: unknown): KLineBar[] {
  if (json == null) return []
  let rows: unknown[] = []
  if (Array.isArray(json)) {
    rows = json
  } else if (typeof json === 'object') {
    const o = json as Record<string, unknown>
    // MMDPS wraps candles in `bars`; other shapes use data/candles/result
    const inner = o.bars ?? o.data ?? o.candles ?? o.result
    if (Array.isArray(inner)) rows = inner
  }
  const out: KLineBar[] = []
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 6) {
      const ts = num(row[0])
      if (!Number.isFinite(ts)) continue
      const o = num(row[1])
      const h = num(row[2])
      const l = num(row[3])
      const c = num(row[4])
      const v = num(row[5])
      if (![o, h, l, c].every((x) => Number.isFinite(x))) continue
      out.push({
        timestamp: ts < 1e12 ? ts * 1000 : ts,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: Number.isFinite(v) ? v : 0,
      })
      continue
    }
    if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>
      const tRaw =
        o.timestamp ?? o.time ?? o.t ?? o.open_time ?? o.openTime ?? o.ts ?? o[0]
      let ts = num(tRaw)
      if (!Number.isFinite(ts)) continue
      if (ts < 1e12) ts *= 1000
      const op = num(o.open ?? o.o)
      const hi = num(o.high ?? o.h)
      const lo = num(o.low ?? o.l)
      const cl = num(o.close ?? o.c)
      const vo = num(o.volume ?? o.v ?? 0)
      if (![op, hi, lo, cl].every((x) => Number.isFinite(x))) continue
      out.push({
        timestamp: ts,
        open: op,
        high: hi,
        low: lo,
        close: cl,
        volume: Number.isFinite(vo) ? vo : 0,
      })
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Historical candles via data-provider proxy (requires `VITE_DATA_PROVIDER_HTTP_URL` or infer from `VITE_DATA_PROVIDER_WS_URL`).
 * The upstream API currently supports `symbol`, `timeframe`, `count` only — no cursor for older/newer pages; extra loads return empty.
 */
export async function fetchMmdpsHistoryKlines(
  symbol: string,
  timeframe: string,
  limit = BARS_PER_CHUNK,
  endTime?: number,
  startTime?: number
): Promise<KLineBar[]> {
  const base = getDataProviderPricesBaseUrl()
  if (!base) {
    throw new Error('MMDPS chart history requires VITE_DATA_PROVIDER_HTTP_URL (or VITE_DATA_PROVIDER_WS_URL for port inference)')
  }
  const count = Math.min(Math.max(1, limit), 500)
  // No server support for windowed history yet; avoid duplicate full loads when scrolling.
  if (endTime != null || startTime != null) {
    return []
  }
  const params = new URLSearchParams({
    symbol: normalizeChartSymbolKey(symbol),
    timeframe,
    count: String(count),
  })
  const url = `${base}/feed/history?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`MMDPS history proxy: ${res.status} ${res.statusText}`)
  }
  const json: unknown = await res.json()
  return parseMmdpsHistoryPayload(json)
}

/**
 * Chart history: Binance REST for Binance-style symbols; MMDPS via data-provider for others when `VITE_DATA_PROVIDER_*` is set (unless `VITE_MMDPS_SYMBOLS` overrides).
 */
export async function fetchChartKlines(
  feedSymbol: string,
  interval: string,
  limit = BARS_PER_CHUNK,
  endTime?: number,
  startTime?: number
): Promise<KLineBar[]> {
  if (isMmdpsChartSymbol(feedSymbol)) {
    return fetchMmdpsHistoryKlines(feedSymbol, interval, limit, endTime, startTime)
  }
  return fetchBinanceKlines(feedSymbol, interval, limit, endTime, startTime)
}
