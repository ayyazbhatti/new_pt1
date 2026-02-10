export type SwapCalcMode = 'daily' | 'hourly' | 'funding_8h'
export type SwapUnit = 'percent' | 'fixed'
export type WeekendRule = 'none' | 'triple_day' | 'fri_triple' | 'custom'

export interface SwapRule {
  id: string
  groupId: string
  groupName: string
  symbol: string
  market: 'crypto' | 'forex' | 'commodities' | 'indices' | 'stocks'
  calcMode: SwapCalcMode
  unit: SwapUnit
  longRate: number
  shortRate: number
  rolloverTimeUtc: string
  tripleDay?: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  weekendRule: WeekendRule
  minCharge?: number
  maxCharge?: number
  status: 'active' | 'disabled'
  updatedAt: string
  updatedBy: string
  notes?: string
}

export interface SwapPreviewInput {
  side: 'long' | 'short'
  positionSize: number
  entryPrice: number
  currentPrice: number
  leverage: number
  holdingHours: number
  quoteCurrency: string
}

export interface SwapPreviewResult {
  estimatedCharge: number
  unitLabel: string
  breakdown: string[]
}

