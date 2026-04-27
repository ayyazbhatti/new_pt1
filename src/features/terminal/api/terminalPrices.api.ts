import { http } from '@/shared/api/http'

/** Response from GET /v1/terminal/prices — same group-marked (bid, ask) as the gateway, Redis-backed. */
export interface TerminalPriceItem {
  symbol: string
  bid: string
  ask: string
  ts: number
}

const BATCH = 120

/**
 * Fetches current prices for the user's group (JWT) in batches. Used on full page load so the UI
 * is not empty while the WebSocket reconnects (browsers always disconnect WS on refresh).
 */
export async function fetchTerminalPricesSnapshot(symbols: string[]): Promise<TerminalPriceItem[]> {
  if (symbols.length === 0) return []
  const upper = symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0)
  const out: TerminalPriceItem[] = []
  for (let i = 0; i < upper.length; i += BATCH) {
    const batch = upper.slice(i, i + BATCH)
    const value = batch.join(',')
    const part = await http<TerminalPriceItem[]>(`/v1/terminal/prices?symbols=${encodeURIComponent(value)}`, {
      method: 'GET',
    })
    if (Array.isArray(part)) {
      for (const row of part) {
        if (row?.symbol) out.push(row)
      }
    }
  }
  return out
}
