export type LeverageProfileStatus = 'active' | 'disabled'

export type LeverageTier = {
  id: string
  profileId: string
  tierIndex: number
  notionalFrom: string
  notionalTo: string | null
  maxLeverage: number
  initialMarginPercent: string
  maintenanceMarginPercent: string
  updatedAt: string
  /** Alias for notionalFrom - for compatibility */
  from?: number | string
  /** Alias for notionalTo - for compatibility */
  to?: number | string | null
  /** Alias for maxLeverage - for compatibility */
  leverage?: number
}

export type LeverageProfile = {
  id: string
  name: string
  description: string | null
  status: LeverageProfileStatus
  tiersCount: number
  symbolsCount: number
  createdAt: string
  updatedAt: string
  /** Tiers for modal/display - optional, loaded separately */
  tiers?: LeverageTier[]
}

export type LeverageProfileSymbols = {
  assigned: Array<{ symbolId: string; symbolCode: string; name: string | null; assetClass: string }>
  unassigned: Array<{ symbolId: string; symbolCode: string; name: string | null; assetClass: string }>
}

export interface ListLeverageProfilesParams {
  search?: string
  status?: string
  page?: number
  page_size?: number
  sort?: string
}

export interface ListLeverageProfilesResponse {
  items: LeverageProfile[]
  page: number
  page_size: number
  total: number
}

export interface CreateLeverageProfilePayload {
  name: string
  description?: string | null
  status: LeverageProfileStatus
}

export interface UpdateLeverageProfilePayload extends CreateLeverageProfilePayload {}

export interface CreateLeverageTierPayload {
  tier_index: number
  notional_from: string
  notional_to?: string | null
  max_leverage: number
  initial_margin_percent: string
  maintenance_margin_percent: string
}

export interface UpdateLeverageTierPayload extends CreateLeverageTierPayload {}

export interface SetProfileSymbolsPayload {
  symbol_ids: string[]
}
