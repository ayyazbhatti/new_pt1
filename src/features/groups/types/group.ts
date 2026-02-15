/** Profile ref embedded in group list (from GET /api/admin/groups). */
export type ProfileRef = { id: string; name: string }

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
  /** Set when returned from list groups API (assigned price stream profile). */
  priceProfile?: ProfileRef | null
  /** Set when returned from list groups API (assigned leverage profile). */
  leverageProfile?: ProfileRef | null
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
  /** Price stream profiles for the dropdown (from GET /api/admin/groups). */
  availablePriceProfiles?: ProfileRef[]
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
