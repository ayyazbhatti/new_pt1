import { http } from '@/shared/api/http'
import {
  UserGroup,
  ListGroupsParams,
  ListGroupsResponse,
  CreateGroupPayload,
  UpdateGroupPayload,
  UsageResponse,
  GroupSymbol,
} from '../types/group'

// Helper to convert snake_case to camelCase (list item may include price_profile, leverage_profile)
function toCamelCase(obj: any): UserGroup {
  const priceProfile = obj.price_profile
    ? { id: obj.price_profile.id, name: obj.price_profile.name }
    : null
  const leverageProfile = obj.leverage_profile
    ? { id: obj.leverage_profile.id, name: obj.leverage_profile.name }
    : null
  return {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    status: obj.status,
    priceProfileId: obj.default_price_profile_id,
    leverageProfileId: obj.default_leverage_profile_id,
    priceProfile: priceProfile ?? undefined,
    leverageProfile: leverageProfile ?? undefined,
    marginCallLevel: obj.margin_call_level != null ? Number(obj.margin_call_level) : null,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

// Helper to convert camelCase to snake_case
function toSnakeCase(payload: CreateGroupPayload | UpdateGroupPayload): any {
  return {
    name: payload.name,
    description: payload.description ?? null,
    status: payload.status,
    margin_call_level: payload.margin_call_level ?? null,
  }
}

export async function listGroups(params?: ListGroupsParams): Promise<ListGroupsResponse> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
  if (params?.sort) queryParams.append('sort', params.sort)

  const queryString = queryParams.toString()
  const endpoint = `/api/admin/groups${queryString ? `?${queryString}` : ''}`

  const response = await http<any>(endpoint, {
    method: 'GET',
  })

  const rawProfiles = response.available_price_profiles ?? []
  const availablePriceProfiles = Array.isArray(rawProfiles)
    ? rawProfiles.map((p: any) => ({ id: p.id, name: p.name ?? '' }))
    : []

  return {
    ...response,
    items: response.items.map(toCamelCase),
    availablePriceProfiles,
  }
}

export async function getGroup(id: string): Promise<UserGroup> {
  const response = await http<any>(`/api/admin/groups/${id}`, {
    method: 'GET',
  })
  return toCamelCase(response)
}

export async function createGroup(payload: CreateGroupPayload): Promise<UserGroup> {
  const response = await http<any>(`/api/admin/groups`, {
    method: 'POST',
    body: JSON.stringify(toSnakeCase(payload)),
  })
  return toCamelCase(response)
}

export async function updateGroup(id: string, payload: UpdateGroupPayload): Promise<UserGroup> {
  const response = await http<any>(`/api/admin/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toSnakeCase(payload)),
  })
  return toCamelCase(response)
}

export async function deleteGroup(id: string): Promise<void> {
  await http(`/api/admin/groups/${id}`, {
    method: 'DELETE',
  })
}

export async function getGroupUsage(id: string): Promise<UsageResponse> {
  return http<UsageResponse>(`/api/admin/groups/${id}/usage`, {
    method: 'GET',
  })
}

export async function updateGroupPriceProfile(groupId: string, priceProfileId: string | null): Promise<void> {
  await http(`/api/admin/groups/${groupId}/price-profile`, {
    method: 'PUT',
    body: JSON.stringify({
      price_profile_id: priceProfileId,
    }),
  })
}

/** Get per-symbol settings for a group (all symbols with group defaults/overrides applied). */
export async function getGroupSymbols(groupId: string): Promise<GroupSymbol[]> {
  const response = await http<{ items: any[] }>(`/api/admin/groups/${groupId}/symbols`, {
    method: 'GET',
  })
  return (response.items ?? []).map((row: any) => ({
    symbolId: row.symbol_id,
    symbolCode: row.symbol_code,
    leverageProfileId: row.leverage_profile_id != null ? String(row.leverage_profile_id).toLowerCase() : null,
    leverageProfileName: row.leverage_profile_name ?? null,
    enabled: row.enabled ?? true,
  }))
}

/** Save per-symbol settings for a group. */
export async function updateGroupSymbols(
  groupId: string,
  symbols: { symbolId: string; leverageProfileId: string | null; enabled: boolean }[],
): Promise<void> {
  await http(`/api/admin/groups/${groupId}/symbols`, {
    method: 'PUT',
    body: JSON.stringify({
      symbols: symbols.map((s) => ({
        symbol_id: s.symbolId,
        leverage_profile_id: s.leverageProfileId ?? null,
        enabled: Boolean(s.enabled),
      })),
    }),
  })
}

