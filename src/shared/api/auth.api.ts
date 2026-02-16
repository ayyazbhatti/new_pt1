import { http } from './http'
import { RegisterData } from '../store/auth.store'

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user: {
    id: string
    email: string
    first_name: string
    last_name: string
    role: string
    status: string
  }
}

export interface RefreshResponse {
  access_token: string
}

export interface UserResponse {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  status: string
  group_id?: string
  group_name?: string
  min_leverage?: number
  max_leverage?: number
  price_profile_name?: string
  leverage_profile_name?: string
}

export async function login(email: string, password: string): Promise<{
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    status: string
  }
}> {
  const response = await http<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    user: {
      id: response.user.id,
      email: response.user.email,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      role: response.user.role,
      status: response.user.status,
    },
  }
}

export async function register(data: RegisterData): Promise<{
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    status: string
  }
}> {
  const response = await http<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      password: data.password,
      country: data.country,
      referral_code: data.referralCode,
    }),
  })

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    user: {
      id: response.user.id,
      email: response.user.email,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      role: response.user.role,
      status: response.user.status,
    },
  }
}

export async function refresh(refreshToken: string): Promise<string> {
  const response = await http<RefreshResponse>('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  return response.access_token
}

export async function logout(refreshToken: string): Promise<void> {
  // Logout requires auth token and returns 204 No Content
  // The http client will handle 204 responses
  await http('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export interface MeResponse {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  groupId?: string
  groupName?: string
  minLeverage?: number
  maxLeverage?: number
  priceProfileName?: string
  leverageProfileName?: string
}

export async function me(): Promise<MeResponse> {
  const response = await http<UserResponse>('/api/auth/me', {
    method: 'GET',
  })

  return {
    id: response.id,
    email: response.email,
    firstName: response.first_name,
    lastName: response.last_name,
    role: response.role,
    status: response.status,
    groupId: response.group_id,
    groupName: response.group_name,
    minLeverage: response.min_leverage,
    maxLeverage: response.max_leverage,
    priceProfileName: response.price_profile_name,
    leverageProfileName: response.leverage_profile_name,
  }
}

/** Tier from symbol-leverage endpoint (snake_case from API). */
export interface SymbolLeverageTier {
  tier_index: number
  notional_from: string
  notional_to: string | null
  max_leverage: number
  initial_margin_percent: string
  maintenance_margin_percent: string
}

export interface SymbolLeverageResponse {
  leverage_profile_name: string | null
  leverage_profile_id: string | null
  tiers?: SymbolLeverageTier[] | null
}

/** Leverage profile applied to the given symbol for the current user's group (per-symbol or group default). */
export async function getSymbolLeverage(symbolCode: string): Promise<SymbolLeverageResponse> {
  const response = await http<{
    leverage_profile_name: string | null
    leverage_profile_id: string | null
    tiers?: SymbolLeverageTier[] | null
  }>(`/api/auth/me/symbol-leverage?symbol_code=${encodeURIComponent(symbolCode)}`, { method: 'GET' })
  return {
    leverage_profile_name: response.leverage_profile_name ?? null,
    leverage_profile_id: response.leverage_profile_id ?? null,
    tiers: response.tiers ?? null,
  }
}

