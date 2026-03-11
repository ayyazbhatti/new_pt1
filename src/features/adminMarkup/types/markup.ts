export interface MarkupProfile {
  id: string
  name: string
  description: string | null
  groupId: string | null
  groupName: string | null
  markupType: 'percent'
  bidMarkup: string
  askMarkup: string
  createdAt: string
  updatedAt: string
  /** Tag IDs assigned to this profile */
  tagIds?: string[]
  /** User who created this profile (manager/admin/super_admin). */
  createdByUserId?: string | null
  createdByEmail?: string | null
}

export interface SymbolMarkupOverride {
  id: string
  profileId: string
  symbolId: string
  symbolCode: string
  bidMarkup: string
  askMarkup: string
  createdAt: string
  updatedAt: string
}

export interface SymbolWithMarkup {
  symbolId: string
  symbolCode: string
  baseCurrency: string
  quoteCurrency: string
  bidMarkup: string
  askMarkup: string
  isOverride: boolean
}

export interface CreateProfilePayload {
  name: string
  description?: string | null
  markup_type: 'percent'
  bid_markup: string
  ask_markup: string
}

export interface UpdateProfilePayload {
  name: string
  markup_type: 'percent'
  bid_markup: string
  ask_markup: string
}

export interface UpsertSymbolOverridePayload {
  bid_markup: string
  ask_markup: string
}

