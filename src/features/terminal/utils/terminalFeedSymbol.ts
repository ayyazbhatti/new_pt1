import type { AdminSymbol } from '@/features/symbols/types/symbol'
import { normalizeSymbolKey } from '@/shared/utils/symbolKeyNormalize'

/**
 * Wire symbol sent to the price feed (must match `symbolCodes` in AppShellTerminal).
 */
export function terminalFeedSymbol(s: AdminSymbol): string {
  let raw: string
  if (s.providerSymbol?.trim()) {
    raw = s.providerSymbol.toUpperCase().trim()
  } else {
    const normalized = s.symbolCode.toUpperCase().replace(/-/g, '')
    if (
      s.assetClass === 'Crypto' &&
      s.quoteCurrency === 'USD' &&
      normalized.endsWith('USD') &&
      !normalized.endsWith('USDT')
    ) {
      raw = normalized.slice(0, -3) + 'USDT'
    } else {
      raw = normalized
    }
  }
  // Strip slashes/dashes (e.g. EUR/USD) so WS subscribe matches gateway + tick keys.
  return normalizeSymbolKey(raw)
}

/** Key used in `usePriceStream` price maps for this catalog row (same as normalizeSymbolKey(feed symbol)). */
export function terminalPriceLookupKey(symbol: AdminSymbol): string {
  return normalizeSymbolKey(terminalFeedSymbol(symbol))
}
