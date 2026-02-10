export type MarkupType = 'fixed' | 'percent' | 'spread'

export type ApplyTo = 'bid' | 'ask' | 'both'

export interface MarkupRule {
  id: string
  groupId: string
  groupName: string
  symbol: string
  market: 'crypto' | 'forex' | 'commodities' | 'indices' | 'stocks'
  markupType: MarkupType
  value: number
  applyTo: ApplyTo
  rounding: number
  minMarkup?: number
  maxMarkup?: number
  status: 'active' | 'disabled'
  updatedAt: string
  updatedBy: string
  notes?: string
}

export interface PricePreview {
  providerBid: number
  providerAsk: number
  finalBid: number
  finalAsk: number
  appliedMarkupBid: number
  appliedMarkupAsk: number
}

