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
  /** User who created this rule (manager/admin/super_admin); email for display */
  createdByUserId?: string
  createdByEmail?: string
  notes?: string
  /** Tag IDs assigned to this rule */
  tagIds?: string[]
}

export interface ListSwapRulesParams {
  groupId?: string
  market?: string
  symbol?: string
  status?: string
  calcMode?: string
  page?: number
  pageSize?: number
}

export interface ListSwapRulesResponse {
  items: SwapRule[]
  page: number
  pageSize: number
  total: number
}

export interface CreateSwapRulePayload {
  groupId: string
  symbol: string
  market: SwapRule['market']
  calcMode: SwapCalcMode
  unit: SwapUnit
  longRate: number
  shortRate: number
  rolloverTimeUtc: string
  weekendRule: WeekendRule
  status: 'active' | 'disabled'
  tripleDay?: SwapRule['tripleDay']
  minCharge?: number
  maxCharge?: number
  notes?: string
}

export interface UpdateSwapRulePayload {
  groupId?: string
  symbol?: string
  market?: SwapRule['market']
  calcMode?: SwapCalcMode
  unit?: SwapUnit
  longRate?: number
  shortRate?: number
  rolloverTimeUtc?: string
  weekendRule?: WeekendRule
  tripleDay?: SwapRule['tripleDay'] | null
  minCharge?: number | null
  maxCharge?: number | null
  status?: 'active' | 'disabled'
  notes?: string | null
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

