import { http } from '@/shared/api/http'
import {
  MarkupProfile,
  SymbolMarkupOverride,
  CreateProfilePayload,
  UpdateProfilePayload,
  UpsertSymbolOverridePayload,
} from '../types/markup'

// Helper to convert snake_case to camelCase
function toCamelCaseProfile(obj: any): MarkupProfile {
  return {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    groupId: obj.group_id,
    groupName: obj.group_name,
    markupType: obj.markup_type,
    bidMarkup: obj.bid_markup,
    askMarkup: obj.ask_markup,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

function toCamelCaseOverride(obj: any): SymbolMarkupOverride {
  return {
    id: obj.id,
    profileId: obj.profile_id,
    symbolId: obj.symbol_id,
    symbolCode: obj.symbol_code,
    bidMarkup: obj.bid_markup,
    askMarkup: obj.ask_markup,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

export async function listMarkupProfiles(): Promise<MarkupProfile[]> {
  const response = await http<any[]>(`/api/admin/markup/profiles`, {
    method: 'GET',
  })
  return response.map(toCamelCaseProfile)
}

export async function getMarkupProfile(id: string): Promise<MarkupProfile> {
  const response = await http<any>(`/api/admin/markup/profiles/${id}`, {
    method: 'GET',
  })
  return toCamelCaseProfile(response)
}

export async function createMarkupProfile(payload: CreateProfilePayload): Promise<MarkupProfile> {
  const response = await http<any>(`/api/admin/markup/profiles`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return toCamelCaseProfile(response)
}

export async function updateMarkupProfile(
  id: string,
  payload: UpdateProfilePayload
): Promise<MarkupProfile> {
  const response = await http<any>(`/api/admin/markup/profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return toCamelCaseProfile(response)
}

export async function getSymbolOverrides(profileId: string): Promise<SymbolMarkupOverride[]> {
  const response = await http<any[]>(`/api/admin/markup/profiles/${profileId}/symbols`, {
    method: 'GET',
  })
  return response.map(toCamelCaseOverride)
}

export async function upsertSymbolOverride(
  profileId: string,
  symbolId: string,
  payload: UpsertSymbolOverridePayload
): Promise<SymbolMarkupOverride> {
  const response = await http<any>(
    `/api/admin/markup/profiles/${profileId}/symbols/${symbolId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  )
  return toCamelCaseOverride(response)
}

