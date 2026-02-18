/** Profile ref embedded in group list (from GET /api/admin/groups). */
export type ProfileRef = { id: string; name: string }

export type UserGroup = {
  id: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  priceProfileId?: string | null
  leverageProfileId?: string | null
  /** Set when returned from list groups API (assigned price stream profile). */
  priceProfile?: ProfileRef | null
  /** Set when returned from list groups API (assigned leverage profile). */
  leverageProfile?: ProfileRef | null
  createdAt: string
  updatedAt: string
  /** Extended fields for edit modal compatibility */
  currency?: string
  region?: string
  tradingAllowed?: boolean
  spreadMarkup?: number
  commission?: number
  swapProfile?: string
  maxExposure?: number
  usersCount?: number
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
}

export interface UpdateGroupPayload extends CreateGroupPayload {}

export interface UsageResponse {
  users_count: number
}

/** Per-symbol settings for a group (leverage profile + enabled). Markup is set in the price stream profile assigned to the group. */
export interface GroupSymbol {
  symbolId: string
  symbolCode: string
  leverageProfileId: string | null
  leverageProfileName: string | null
  enabled: boolean
}
