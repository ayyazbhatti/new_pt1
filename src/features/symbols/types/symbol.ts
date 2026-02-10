export type SymbolMarket = 'crypto' | 'forex' | 'metals' | 'indices' | 'stocks'

export interface AdminSymbol {
  id: string
  code: string
  name: string
  market: SymbolMarket
  provider: 'Binance' | 'Coinbase' | 'Kraken' | 'Other'
  leverageProfileName: string
  contractSize: number
  tickSize: number
  pricePrecision: number
  lotMin: number
  lotMax: number
  status: 'enabled' | 'disabled'
  commission?: number
  swapProfile?: string
  notes?: string
}

export interface GroupMarkup {
  groupId: string
  groupName: string
  markupType: 'points' | 'percent'
  markupValue: number
  enabled: boolean
}

