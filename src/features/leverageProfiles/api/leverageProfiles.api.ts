import { http } from '@/shared/api/http'
import {
  LeverageProfile,
  LeverageTier,
  LeverageProfileSymbols,
  ListLeverageProfilesParams,
  ListLeverageProfilesResponse,
  CreateLeverageProfilePayload,
  UpdateLeverageProfilePayload,
  CreateLeverageTierPayload,
  UpdateLeverageTierPayload,
  SetProfileSymbolsPayload,
} from '../types/leverageProfile'

// Helper to convert snake_case to camelCase
function toCamelCaseProfile(obj: any): LeverageProfile {
  return {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    status: obj.status,
    tiersCount: obj.tiers_count,
    symbolsCount: obj.symbols_count,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

function toCamelCaseTier(obj: any): LeverageTier {
  return {
    id: obj.id,
    profileId: obj.profile_id,
    tierIndex: obj.tier_index,
    notionalFrom: obj.notional_from,
    notionalTo: obj.notional_to,
    maxLeverage: obj.max_leverage,
    initialMarginPercent: obj.initial_margin_percent,
    maintenanceMarginPercent: obj.maintenance_margin_percent,
    updatedAt: obj.updated_at,
  }
}

function toCamelCaseSymbols(obj: any): LeverageProfileSymbols {
  return {
    assigned: obj.assigned || [],
    unassigned: obj.unassigned || [],
  }
}

// Helper to convert camelCase to snake_case
function toSnakeCaseProfile(payload: CreateLeverageProfilePayload | UpdateLeverageProfilePayload): any {
  return {
    name: payload.name,
    description: payload.description ?? null,
    status: payload.status,
  }
}

function toSnakeCaseTier(payload: CreateLeverageTierPayload | UpdateLeverageTierPayload): any {
  return {
    tier_index: payload.tier_index,
    notional_from: payload.notional_from,
    notional_to: payload.notional_to ?? null,
    max_leverage: payload.max_leverage,
    initial_margin_percent: payload.initial_margin_percent,
    maintenance_margin_percent: payload.maintenance_margin_percent,
  }
}

export async function listLeverageProfiles(params?: ListLeverageProfilesParams): Promise<ListLeverageProfilesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
  if (params?.sort) queryParams.append('sort', params.sort)

  const queryString = queryParams.toString()
  const endpoint = `/api/admin/leverage-profiles${queryString ? `?${queryString}` : ''}`

  const response = await http<ListLeverageProfilesResponse>(endpoint, {
    method: 'GET',
  })

  return {
    ...response,
    items: response.items.map(toCamelCaseProfile),
  }
}

export async function getLeverageProfile(id: string): Promise<LeverageProfile> {
  const response = await http<any>(`/api/admin/leverage-profiles/${id}`, {
    method: 'GET',
  })
  return toCamelCaseProfile(response)
}

export async function createLeverageProfile(payload: CreateLeverageProfilePayload): Promise<LeverageProfile> {
  const response = await http<any>(`/api/admin/leverage-profiles`, {
    method: 'POST',
    body: JSON.stringify(toSnakeCaseProfile(payload)),
  })
  return toCamelCaseProfile(response)
}

export async function updateLeverageProfile(id: string, payload: UpdateLeverageProfilePayload): Promise<LeverageProfile> {
  const response = await http<any>(`/api/admin/leverage-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toSnakeCaseProfile(payload)),
  })
  return toCamelCaseProfile(response)
}

export async function deleteLeverageProfile(id: string): Promise<void> {
  await http(`/api/admin/leverage-profiles/${id}`, {
    method: 'DELETE',
  })
}

export async function listLeverageProfileTiers(profileId: string): Promise<LeverageTier[]> {
  const response = await http<any[]>(`/api/admin/leverage-profiles/${profileId}/tiers`, {
    method: 'GET',
  })
  return response.map(toCamelCaseTier)
}

export async function createLeverageTier(profileId: string, payload: CreateLeverageTierPayload): Promise<LeverageTier> {
  const response = await http<any>(`/api/admin/leverage-profiles/${profileId}/tiers`, {
    method: 'POST',
    body: JSON.stringify(toSnakeCaseTier(payload)),
  })
  return toCamelCaseTier(response)
}

export async function updateLeverageTier(
  profileId: string,
  tierId: string,
  payload: UpdateLeverageTierPayload
): Promise<LeverageTier> {
  const response = await http<any>(`/api/admin/leverage-profiles/${profileId}/tiers/${tierId}`, {
    method: 'PUT',
    body: JSON.stringify(toSnakeCaseTier(payload)),
  })
  return toCamelCaseTier(response)
}

export async function deleteLeverageTier(profileId: string, tierId: string): Promise<void> {
  await http(`/api/admin/leverage-profiles/${profileId}/tiers/${tierId}`, {
    method: 'DELETE',
  })
}

export async function getLeverageProfileSymbols(profileId: string): Promise<LeverageProfileSymbols> {
  const response = await http<any>(`/api/admin/leverage-profiles/${profileId}/symbols`, {
    method: 'GET',
  })
  return toCamelCaseSymbols(response)
}

export async function setLeverageProfileSymbols(profileId: string, payload: SetProfileSymbolsPayload): Promise<void> {
  await http(`/api/admin/leverage-profiles/${profileId}/symbols`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

