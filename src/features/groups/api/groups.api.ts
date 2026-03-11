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

function normalizeId(id: string | undefined | null): string | undefined {
  if (id == null || id === '') return undefined
  return String(id).toLowerCase()
}

// Helper to convert snake_case to camelCase (list item may include price_profile, leverage_profile)
function toCamelCase(obj: any): UserGroup {
  const priceProfile = obj.price_profile
    ? { id: (normalizeId(obj.price_profile.id) ?? String(obj.price_profile.id)).toLowerCase(), name: obj.price_profile.name }
    : null
  const leverageProfile = obj.leverage_profile
    ? { id: (normalizeId(obj.leverage_profile.id) ?? String(obj.leverage_profile.id)).toLowerCase(), name: obj.leverage_profile.name }
    : null
  return {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    status: obj.status,
    signupSlug: obj.signup_slug ?? undefined,
    tagIds: Array.isArray(obj.tag_ids) ? obj.tag_ids : [],
    priceProfileId: normalizeId(obj.default_price_profile_id) ?? obj.default_price_profile_id ?? undefined,
    leverageProfileId: normalizeId(obj.default_leverage_profile_id) ?? obj.default_leverage_profile_id ?? undefined,
    priceProfile: priceProfile ?? undefined,
    leverageProfile: leverageProfile ?? undefined,
    marginCallLevel: obj.margin_call_level != null ? Number(obj.margin_call_level) : null,
    stopOutLevel: obj.stop_out_level != null ? Number(obj.stop_out_level) : null,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
    createdByUserId: obj.created_by_user_id ?? undefined,
    createdByEmail: obj.created_by_email ?? undefined,
  }
}

// Helper to convert camelCase to snake_case
function toSnakeCase(payload: CreateGroupPayload | UpdateGroupPayload): any {
  const out: Record<string, unknown> = {
    name: payload.name,
    description: payload.description ?? null,
    status: payload.status,
    margin_call_level: payload.margin_call_level ?? null,
    stop_out_level: payload.stop_out_level ?? null,
  }
  if ('signup_slug' in payload) out.signup_slug = payload.signup_slug ?? null
  return out
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
    ? rawProfiles.map((p: any) => ({ id: normalizeId(p.id) ?? p.id, name: p.name ?? '' }))
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

/** Get tag IDs assigned to a group. Uses /api/admin/group-tags/:id to avoid route conflicts. */
export async function getGroupTags(groupId: string): Promise<string[]> {
  const res = await http<{ tag_ids: string[] }>(`/api/admin/group-tags/${groupId}`, { method: 'GET' })
  return res.tag_ids ?? []
}

/** Assign tags to a group (replaces existing). Uses /api/admin/group-tags/:id to avoid route conflicts. */
export async function setGroupTags(groupId: string, tagIds: string[]): Promise<void> {
  await http(`/api/admin/group-tags/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}

