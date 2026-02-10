export type UserGroup = {
  id: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  priority: number
  minLeverage: number
  maxLeverage: number
  maxOpenPositions: number
  maxOpenOrders: number
  riskMode: 'standard' | 'conservative' | 'aggressive'
  priceProfileId?: string | null
  leverageProfileId?: string | null
  createdAt: string
  updatedAt: string
}

export interface ListGroupsParams {
  search?: string
  status?: string
  page?: number
  page_size?: number
  sort?: string
}

export interface ListGroupsResponse {
  items: UserGroup[]
  page: number
  page_size: number
  total: number
}

export interface CreateGroupPayload {
  name: string
  description?: string | null
  status: 'active' | 'disabled'
  priority: number
  min_leverage: number
  max_leverage: number
  max_open_positions: number
  max_open_orders: number
  risk_mode: 'standard' | 'conservative' | 'aggressive'
}

export interface UpdateGroupPayload extends CreateGroupPayload {}

export interface UsageResponse {
  users_count: number
}
