export type SymbolMarket = 'crypto' | 'forex' | 'metals' | 'indices' | 'stocks'
export type AssetClass =
  | 'Forex'
  | 'Cryptocurrencies'
  | 'Metals'
  | 'Indices'
  | 'Stocks'
  | 'Shares'
  | 'ETFs'
  | 'Energies'
  | 'Commodities'

export interface AdminSymbol {
  id: string
  symbolCode: string
  /** Alias for symbolCode - for compatibility */
  code?: string
  /** Display name - for compatibility */
  name?: string
  /** Market/category - for compatibility */
  market?: string
  providerSymbol: string | null
  assetClass: AssetClass | null
  baseCurrency: string
  quoteCurrency: string
  pricePrecision: number
  volumePrecision: number
  contractSize: string
  tickSize?: number | null
  lotMin?: number | null
  lotMax?: number | null
  defaultPipPosition?: number | null
  pipPositionMin?: number | null
  pipPositionMax?: number | null
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
  tick_size?: string | null
  lot_min?: string | null
  lot_max?: string | null
  default_pip_position?: string | null
  pip_position_min?: string | null
  pip_position_max?: string | null
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
  tick_size?: string | null
  lot_min?: string | null
  lot_max?: string | null
  default_pip_position?: string | null
  pip_position_min?: string | null
  pip_position_max?: string | null
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
  markupType: 'percent'
  markupValue: number
  enabled: boolean
}
