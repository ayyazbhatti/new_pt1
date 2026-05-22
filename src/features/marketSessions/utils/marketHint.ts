import type { AssetClass } from '@/features/symbols/types/symbol'
import type { SessionDefaultMarket } from '../types/sessionTemplate'

/** Maps admin symbol asset class to DB `market_type` / session default key. */
export function assetClassToMarketHint(ac: AssetClass | string | null | undefined): SessionDefaultMarket | undefined {
  switch (ac) {
    case 'FX':
      return 'forex'
    case 'Crypto':
      return 'crypto'
    case 'Metals':
    case 'Commodities':
      return 'commodities'
    case 'Indices':
      return 'indices'
    case 'Stocks':
      return 'stocks'
    default:
      return undefined
  }
}
