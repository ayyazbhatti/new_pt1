import type { AssetClass } from '@/features/symbols/types/symbol'
import type { MockSymbol } from '@/shared/mock/terminalMock'

/** Same enum as admin `/admin/symbols` — order used for sidebar sections and quote pills. */
export const ASSET_CLASS_DISPLAY_ORDER: readonly AssetClass[] = [
  'FX',
  'Crypto',
  'Metals',
  'Indices',
  'Stocks',
  'Commodities',
]

const LABEL: Record<string, string> = {
  FX: 'Forex',
  Crypto: 'Cryptocurrencies',
  Metals: 'Metals',
  Indices: 'Indices',
  Stocks: 'Stocks',
  Commodities: 'Commodities',
  Other: 'Other',
}

export function assetClassDisplayLabel(key: string): string {
  return LABEL[key] ?? key
}

export function normalizeSymbolAssetClass(s: MockSymbol): string {
  return s.assetClass ?? 'Other'
}

/**
 * Groups symbols for the terminal sidebar: one section per class that has at least one symbol (after filters).
 */
export function groupSymbolsByAssetClass(symbols: MockSymbol[]): {
  key: string
  label: string
  symbols: MockSymbol[]
}[] {
  const map = new Map<string, MockSymbol[]>()
  for (const s of symbols) {
    const k = normalizeSymbolAssetClass(s)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(s)
  }
  const out: { key: string; label: string; symbols: MockSymbol[] }[] = []
  const seen = new Set<string>()
  for (const k of ASSET_CLASS_DISPLAY_ORDER) {
    const list = map.get(k)
    if (list?.length) {
      out.push({ key: k, label: assetClassDisplayLabel(k), symbols: list })
      seen.add(k)
    }
  }
  for (const k of [...map.keys()].sort()) {
    if (seen.has(k)) continue
    const list = map.get(k)
    if (list?.length) out.push({ key: k, label: assetClassDisplayLabel(k), symbols: list })
  }
  return out
}

/** Asset classes that exist in the current symbol list (for mobile quote pills). */
export function distinctAssetClasses(symbols: MockSymbol[]): string[] {
  const set = new Set<string>()
  for (const s of symbols) set.add(normalizeSymbolAssetClass(s))
  const ordered: string[] = []
  for (const k of ASSET_CLASS_DISPLAY_ORDER) {
    if (set.has(k)) ordered.push(k)
  }
  for (const k of [...set].sort()) {
    if (!ordered.includes(k)) ordered.push(k)
  }
  return ordered
}
