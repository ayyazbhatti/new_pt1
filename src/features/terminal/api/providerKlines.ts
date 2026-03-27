import { BARS_PER_CHUNK, fetchBinanceKlines, KLineBar } from './binanceKlines'

const INTERWARE_BASE_URL =
  (import.meta.env.VITE_INTERWARE_BASE_URL as string | undefined) ||
  'https://provider.interwarepvt.com'

type InterwareKline = {
  time: number
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  volume: string | number
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
  count = BARS_PER_CHUNK
): Promise<KLineBar[]> {
  const providerSymbol = normalizeInterwareSymbol(symbolCode)
  const timeframe = toInterwareTimeframe(interval)
  const url = `${INTERWARE_BASE_URL}/api/rates/${providerSymbol}?timeframe=${encodeURIComponent(
    timeframe
  )}&count=${Math.min(count, 1000)}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Interware klines: ${res.status} ${res.statusText}`)
  }

  const rows = (await res.json()) as InterwareKline[]
  return rows.map((r) => ({
    timestamp: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }))
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

  // Interware endpoint doesn't support start/end pagination in the same way.
  return fetchInterwareKlines(symbolCode, interval, limit)
}

