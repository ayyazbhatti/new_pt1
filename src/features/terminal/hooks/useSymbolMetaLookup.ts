import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAllSymbolsMatching } from '@/features/symbols/api/symbols.api'
import { TERMINAL_ENABLED_SYMBOLS_QUERY_KEY } from '@/features/symbols/hooks/useSymbols'
import type { SymbolMeta } from '@/shared/finance/sizeFormat'

/**
 * Client-side lookup of symbol metadata (asset class, contract size, etc.) for position/order size formatting.
 * Shares the same React Query cache as `useAllEnabledSymbolsForTerminal`.
 */
export function useSymbolMetaLookup() {
  const { data } = useQuery({
    queryKey: TERMINAL_ENABLED_SYMBOLS_QUERY_KEY,
    queryFn: async () => {
      const items = await listAllSymbolsMatching({ is_enabled: 'true' })
      return { items, total: items.length }
    },
    staleTime: 5 * 60_000,
  })

  return useMemo(() => {
    const map = new Map<string, SymbolMeta>()
    for (const s of data?.items ?? []) {
      const code = (s.symbolCode || s.code || '').trim()
      if (!code) continue
      const meta: SymbolMeta = {
        code,
        assetClass: s.assetClass ?? undefined,
        market: s.market ?? undefined,
        contractSize: s.contractSize,
        baseCurrency: s.baseCurrency ?? undefined,
        volumePrecision: s.volumePrecision,
      }
      map.set(code, meta)
      map.set(code.toUpperCase(), meta)
    }
    return map
  }, [data?.items])
}

export function getSymbolMetaForCode(
  map: Map<string, SymbolMeta>,
  symbolCode: string | undefined | null
): SymbolMeta | undefined {
  if (!symbolCode) return undefined
  const trimmed = symbolCode.trim()
  if (!trimmed) return undefined
  return map.get(trimmed) ?? map.get(trimmed.toUpperCase())
}
