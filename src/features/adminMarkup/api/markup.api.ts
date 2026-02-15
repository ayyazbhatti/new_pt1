import { http } from '@/shared/api/http'
import {
  MarkupProfile,
  SymbolMarkupOverride,
  CreateProfilePayload,
  UpdateProfilePayload,
  UpsertSymbolOverridePayload,
} from '../types/markup'

// Helper to convert snake_case to camelCase; accepts both shapes from API
function toCamelCaseProfile(obj: any): MarkupProfile {
  const id = obj?.id != null ? String(obj.id) : ''
  const name = obj?.name != null ? String(obj.name) : id || ''
  return {
    id,
    name,
    description: obj?.description ?? undefined,
    groupId: obj?.group_id ?? obj?.groupId ?? undefined,
    groupName: obj?.group_name ?? obj?.groupName ?? undefined,
    markupType: obj?.markup_type ?? obj?.markupType,
    bidMarkup: obj?.bid_markup ?? obj?.bidMarkup,
    askMarkup: obj?.ask_markup ?? obj?.askMarkup,
    createdAt: obj?.created_at ?? obj?.createdAt,
    updatedAt: obj?.updated_at ?? obj?.updatedAt,
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
  const response = await http<any>(`/api/admin/markup/profiles`, {
    method: 'GET',
  })
  const arr = Array.isArray(response) ? response : (response?.items ?? response?.data ?? [])
  if (!Array.isArray(arr)) return []
  return arr
    .map((item: any) => toCamelCaseProfile(item))
    .filter((p) => p.id != null && p.id !== '')
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

