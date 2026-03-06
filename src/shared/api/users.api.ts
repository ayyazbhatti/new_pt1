import { http } from './http'

export interface UserResponse {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  status: string
  phone?: string | null
  country?: string | null
  created_at?: string
  last_login_at?: string | null
  referral_code?: string | null
  group_id?: string | null
  group_name?: string | null
  min_leverage?: number | null
  max_leverage?: number | null
  account_type?: string | null
  margin_calculation_type?: string | null
  trading_access?: string | null
  open_positions_count?: number | null
  permission_profile_id?: string | null
  permission_profile_name?: string | null
}

export interface ListUsersParams {
  limit?: number
  offset?: number
  /** Server-side pagination (use with page_size; preferred for large lists) */
  page?: number
  page_size?: number
  search?: string
  status?: string
  group_id?: string
}

export interface ListUsersResponse {
  items: UserResponse[]
  total: number
}

export async function listUsers(params?: ListUsersParams): Promise<ListUsersResponse> {
  const queryParams = new URLSearchParams()
  if (params?.limit != null) queryParams.append('limit', params.limit.toString())
  if (params?.offset != null) queryParams.append('offset', params.offset.toString())
  if (params?.page != null) queryParams.append('page', params.page.toString())
  if (params?.page_size != null) queryParams.append('page_size', params.page_size.toString())
  if (params?.search) queryParams.append('search', params.search.trim())
  if (params?.status && params.status !== 'all') queryParams.append('status', params.status)
  if (params?.group_id && params.group_id !== 'all') queryParams.append('group_id', params.group_id)

  const queryString = queryParams.toString()
  const endpoint = `/api/auth/users${queryString ? `?${queryString}` : ''}`

  return http<ListUsersResponse>(endpoint, {
    method: 'GET',
  })
}

export async function updateUserPermissionProfile(
  userId: string,
  permissionProfileId: string | null
): Promise<void> {
  await http(`/api/admin/users/${userId}/permission-profile`, {
    method: 'PUT',
    body: JSON.stringify({ permission_profile_id: permissionProfileId }),
  })
}

