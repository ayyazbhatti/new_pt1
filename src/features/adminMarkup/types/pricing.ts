export type MarkupType = 'percent'
export type RoundingMode = 'none' | 'symbol' | 'custom'

export interface PriceStreamProfile {
  id: string
  name: string
  description: string
  markupType: MarkupType
  bidMarkup: number
  askMarkup: number
  allowNegative: boolean
  roundingMode: RoundingMode
  customRounding?: number
  status: 'active' | 'disabled'
  createdBy: string
  updatedAt: string
}

export interface GroupPriceProfile {
  groupId: string
  groupName: string
  profileId: string
  profileName: string
  notes?: string
}

export interface SymbolPriceOverride {
  symbol: string
  symbolName: string
  defaultGroupProfileId: string
  defaultGroupProfileName: string
  overrideProfileId: string | null
  overrideProfileName: string | null
  effectiveBidMarkup: number
  effectiveAskMarkup: number
}

