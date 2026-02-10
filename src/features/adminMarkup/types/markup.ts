export interface MarkupProfile {
  id: string
  name: string
  description: string | null
  groupId: string | null
  groupName: string | null
  markupType: 'points' | 'percent' | 'pips'
  bidMarkup: string
  askMarkup: string
  createdAt: string
  updatedAt: string
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
  group_id?: string | null
  markup_type: 'points' | 'percent' | 'pips'
  bid_markup: string
  ask_markup: string
}

export interface UpdateProfilePayload {
  name: string
  group_id?: string | null
  markup_type: 'points' | 'percent' | 'pips'
  bid_markup: string
  ask_markup: string
}

export interface UpsertSymbolOverridePayload {
  bid_markup: string
  ask_markup: string
}

