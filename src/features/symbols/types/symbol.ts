export type SymbolMarket = 'crypto' | 'forex' | 'metals' | 'indices' | 'stocks'
export type AssetClass = 'FX' | 'Crypto' | 'Metals' | 'Indices' | 'Stocks' | 'Commodities'

export interface AdminSymbol {
  id: string
  symbolCode: string
  providerSymbol: string | null
  assetClass: AssetClass | null
  baseCurrency: string
  quoteCurrency: string
  pricePrecision: number
  volumePrecision: number
  contractSize: string
  isEnabled: boolean
  tradingEnabled: boolean
  leverageProfileId: string | null
  leverageProfileName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSymbolPayload {
  symbol_code: string
  provider_symbol: string
  asset_class: AssetClass
  base_currency: string
  quote_currency: string
  price_precision: number
  volume_precision: number
  contract_size: string
  leverage_profile_id?: string | null
}

export interface UpdateSymbolPayload {
  symbol_code: string
  provider_symbol: string
  asset_class: AssetClass
  base_currency: string
  quote_currency: string
  price_precision: number
  volume_precision: number
  contract_size: string
  is_enabled: boolean
  trading_enabled: boolean
  leverage_profile_id?: string | null
}

export interface ListSymbolsParams {
  search?: string
  asset_class?: string
  is_enabled?: string
  page?: number
  page_size?: number
  sort?: string
}

export interface ListSymbolsResponse {
  items: AdminSymbol[]
  page: number
  page_size: number
  total: number
}

export interface GroupMarkup {
  groupId: string
  groupName: string
  markupType: 'points' | 'percent'
  markupValue: number
  enabled: boolean
}
