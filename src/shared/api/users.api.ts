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
}

export interface ListUsersParams {
  limit?: number
  offset?: number
}

export async function listUsers(params?: ListUsersParams): Promise<UserResponse[]> {
  const queryParams = new URLSearchParams()
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.offset) queryParams.append('offset', params.offset.toString())
  
  const queryString = queryParams.toString()
  const endpoint = `/api/auth/users${queryString ? `?${queryString}` : ''}`
  
  return http<UserResponse[]>(endpoint, {
    method: 'GET',
  })
}

