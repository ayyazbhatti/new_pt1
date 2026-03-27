import { BARS_PER_CHUNK, fetchBinanceKlines, KLineBar } from './binanceKlines'

const INTERWARE_BASE_URL =
  (import.meta.env.VITE_INTERWARE_BASE_URL as string | undefined) ||
  'https://provider.interwarepvt.com'
const EXCHANGE_RATE_URL =
  (import.meta.env.VITE_EXCHANGE_RATE_URL as string | undefined) ||
  'https://exchange4.dtrader.tech/api/exchange-rate'

type InterwareKline = {
  time: number
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  volume: string | number
}

type ExchangeRateResponse = {
  ask?: number | string
  bid?: number | string
  rate?: number | string
  [key: string]: unknown
}

function toInterwareTimeframe(interval: string): string {
  // Binance-like interval -> Interware/MT format
  if (interval.endsWith('m')) return `M${interval.slice(0, -1)}`
  if (interval.endsWith('h')) return `H${interval.slice(0, -1)}`
  if (interval.endsWith('d')) return `D${interval.slice(0, -1)}`
  if (interval.endsWith('w')) return `W${interval.slice(0, -1)}`
  if (interval.endsWith('M')) return 'MN1'
  return 'H1'
}

function normalizeInterwareSymbol(symbolCode: string): string {
  return symbolCode.replace(/-/g, '').toUpperCase()
}

export async function fetchInterwareKlines(
  symbolCode: string,
  interval: string,
  count = BARS_PER_CHUNK,
  endTime?: number,
  startTime?: number
): Promise<KLineBar[]> {
  const providerSymbol = normalizeInterwareSymbol(symbolCode)
  const timeframe = toInterwareTimeframe(interval)
  // Interware API uses count-based fetch (no explicit start/end window like Binance).
  // We fetch a bounded recent window and apply start/end filtering client-side.
  const requestCount = Math.min(Math.max(count, BARS_PER_CHUNK), 1000)
  const url = `${INTERWARE_BASE_URL}/api/rates/${providerSymbol}?timeframe=${encodeURIComponent(
    timeframe
  )}&count=${requestCount}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Interware klines: ${res.status} ${res.statusText}`)
  }

  const rows = (await res.json()) as InterwareKline[]
  let bars = rows.map((r) => ({
    timestamp: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }))

  // Normalize order just in case provider order changes.
  bars = bars.sort((a, b) => a.timestamp - b.timestamp)

  if (endTime != null) {
    bars = bars.filter((b) => b.timestamp <= endTime)
  }
  if (startTime != null) {
    bars = bars.filter((b) => b.timestamp >= startTime)
  }

  // Keep same chunk size behavior expected by chart loader.
  if (bars.length > count) {
    bars = bars.slice(-count)
  }
  return bars
}

/**
 * Optional helper for future conversion path.
 * Not applied to kline values yet (kept non-breaking for this tiny step).
 */
export async function fetchExchangeRate(quotation = 'USDT'): Promise<ExchangeRateResponse | null> {
  try {
    const res = await fetch(EXCHANGE_RATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotation }),
    })
    if (!res.ok) return null
    return (await res.json()) as ExchangeRateResponse
  } catch {
    return null
  }
}

export async function fetchProviderKlines(params: {
  awsProviderEnabled: boolean
  assetClass: string | null | undefined
  symbolCode: string
  binanceSymbol: string
  interval: string
  limit?: number
  endTime?: number
  startTime?: number
}): Promise<KLineBar[]> {
  const {
    awsProviderEnabled,
    assetClass,
    symbolCode,
    binanceSymbol,
    interval,
    limit = BARS_PER_CHUNK,
    endTime,
    startTime,
  } = params

  // Default/current behavior: always Binance.
  if (!awsProviderEnabled) {
    return fetchBinanceKlines(binanceSymbol, interval, limit, endTime, startTime)
  }

  // In AWS mode: crypto stays Binance, non-crypto uses Interware.
  if (assetClass === 'Cryptocurrencies') {
    return fetchBinanceKlines(binanceSymbol, interval, limit, endTime, startTime)
  }

  return fetchInterwareKlines(symbolCode, interval, limit, endTime, startTime)
}

