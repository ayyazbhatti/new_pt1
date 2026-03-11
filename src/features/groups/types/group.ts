/** Profile ref embedded in group list (from GET /api/admin/groups). */
export type ProfileRef = { id: string; name: string }

export type UserGroup = {
  id: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  /** Unique slug for signup link (e.g. "golduser"). URL: /register?ref=<signupSlug> */
  signupSlug?: string | null
  /** Tag IDs assigned to this group (from list API). */
  tagIds?: string[]
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
  /** Margin call level % (e.g. 50). Null = platform default. */
  marginCallLevel?: number | null
  /** Stop out level % (e.g. 20). When margin level falls below this, all positions are closed. Null = no automatic stop out. */
  stopOutLevel?: number | null
  /** User who created this group (manager/admin/super_admin). */
  createdByUserId?: string | null
  createdByEmail?: string | null
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
  margin_call_level?: number | null
  stop_out_level?: number | null
  /** Optional. Custom slug (3-20 alphanumeric). If empty, backend auto-generates 5-7 chars. */
  signup_slug?: string | null
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
