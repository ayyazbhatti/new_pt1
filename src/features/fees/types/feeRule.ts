export type FeeRuleMarket = 'crypto' | 'forex' | 'commodities' | 'indices' | 'stocks'

export type FeeRule = {
  id: string
  groupId: string
  groupName: string
  /** Empty / undefined means all symbols in group */
  symbol?: string | null
  market?: FeeRuleMarket | null
  feePercent: number
  minFee: number
  maxFee?: number | null
  status: 'active' | 'disabled'
  notes?: string | null
  createdAt: string
  updatedAt: string
  updatedBy?: string | null
  createdByUserId?: string | null
  createdByEmail?: string | null
}

export interface ListFeeRulesParams {
  groupId?: string
  symbol?: string
  status?: string
  page?: number
  pageSize?: number
}

export interface ListFeeRulesResponse {
  items: FeeRule[]
  page: number
  page_size: number
  total: number
}

export interface CreateFeeRulePayload {
  groupId: string
  symbol?: string | null
  market?: FeeRuleMarket | null
  feePercent: number
  minFee: number
  maxFee?: number | null
  status: 'active' | 'disabled'
  notes?: string | null
}

export type UpdateFeeRulePayload = Partial<CreateFeeRulePayload>
