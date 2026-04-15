import type { AdminSymbol } from '@/features/symbols/types/symbol'
import { normalizeSymbolKey } from '@/shared/utils/symbolKeyNormalize'

/**
 * Wire symbol sent to the price feed (must match `symbolCodes` in AppShellTerminal).
 */
export function terminalFeedSymbol(s: AdminSymbol): string {
  if (s.providerSymbol?.trim()) {
    return s.providerSymbol.toUpperCase().trim()
  }
  const normalized = s.symbolCode.toUpperCase().replace(/-/g, '')
  if (
    s.assetClass === 'Crypto' &&
    s.quoteCurrency === 'USD' &&
    normalized.endsWith('USD') &&
    !normalized.endsWith('USDT')
  ) {
    return normalized.slice(0, -3) + 'USDT'
  }
  return normalized
}

/** Key used in `usePriceStream` price maps for this catalog row (same as normalizeSymbolKey(feed symbol)). */
export function terminalPriceLookupKey(symbol: AdminSymbol): string {
  return normalizeSymbolKey(terminalFeedSymbol(symbol))
}
