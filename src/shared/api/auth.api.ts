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
    trading_access?: string | null
    permission_profile_id?: string | null
    permission_profile_name?: string | null
    permissions?: string[] | null
    referral_code?: string | null
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
  trading_access?: string | null
  permission_profile_id?: string | null
  permission_profile_name?: string | null
  permissions?: string[] | null
  referral_code?: string | null
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
    tradingAccess?: string
    permissions?: string[]
    permissionProfileId?: string | null
    permissionProfileName?: string | null
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
      tradingAccess: response.user.trading_access ?? 'full',
      permissions: response.user.permissions ?? undefined,
      permissionProfileId: response.user.permission_profile_id ?? undefined,
      permissionProfileName: response.user.permission_profile_name ?? undefined,
      referralCode: response.user.referral_code ?? undefined,
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
    tradingAccess?: string
    permissions?: string[]
    permissionProfileId?: string | null
    permissionProfileName?: string | null
    referralCode?: string
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
      referral_code: data.referralCode || undefined,
      ...(data.groupRef ? { ref: data.groupRef } : data.groupId ? { group_id: data.groupId } : {}),
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
      tradingAccess: response.user.trading_access ?? 'full',
      permissions: response.user.permissions ?? undefined,
      permissionProfileId: response.user.permission_profile_id ?? undefined,
      permissionProfileName: response.user.permission_profile_name ?? undefined,
      referralCode: response.user.referral_code ?? undefined,
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
  /** 'full' | 'close_only' | 'disabled' - trading panel access */
  tradingAccess?: string
  permissions?: string[]
  permissionProfileId?: string | null
  permissionProfileName?: string | null
  referralCode?: string | null
}

export async function me(): Promise<MeResponse> {
  const response = await http<UserResponse>('/api/auth/me', {
    method: 'GET',
  })

  return mapUserResponseToMe(response)
}

/** Referred user (someone in your referral chain). level 1 = direct, 2 = referral of your referral, etc. */
export interface ReferredUserDto {
  id: string
  email: string
  first_name: string
  last_name: string
  created_at: string
  level?: number
}

export interface ReferredUser {
  id: string
  email: string
  firstName: string
  lastName: string
  createdAt: string
  level: number
}

export async function getMyReferrals(): Promise<ReferredUser[]> {
  const list = await http<ReferredUserDto[]>('/api/auth/me/referrals', {
    method: 'GET',
  })
  return list.map((d) => ({
    id: d.id,
    email: d.email,
    firstName: d.first_name,
    lastName: d.last_name,
    createdAt: d.created_at,
    // Backend sends level (1=direct, 2=indirect, …); default 1 if missing (e.g. old API)
    level: typeof d.level === 'number' ? d.level : 1,
  }))
}

function mapUserResponseToMe(response: UserResponse): MeResponse {
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
    tradingAccess: response.trading_access ?? 'full',
    permissions: response.permissions ?? undefined,
    permissionProfileId: response.permission_profile_id ?? undefined,
    permissionProfileName: response.permission_profile_name ?? undefined,
    referralCode: response.referral_code ?? undefined,
  }
}

export interface UpdateProfilePayload {
  first_name?: string
  last_name?: string
}

export async function updateProfile(
  payload: UpdateProfilePayload
): Promise<MeResponse> {
  const body: UpdateProfilePayload = {}
  if (payload.first_name !== undefined) body.first_name = payload.first_name.trim()
  if (payload.last_name !== undefined) body.last_name = payload.last_name.trim()
  const response = await http<UserResponse>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return mapUserResponseToMe(response)
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

/**
 * Effective leverage for a given notional (exposure): find tier where
 * notional_from <= notional < notional_to, take tier's max_leverage, then clamp to [userMin, userMax].
 * Returns defaultLeverage if no tiers or missing limits.
 */
export function getEffectiveLeverage(
  notional: number,
  tiers: SymbolLeverageTier[] | null | undefined,
  userMin: number | null | undefined,
  userMax: number | null | undefined,
  defaultLeverage: number = 50
): number {
  if (!Number.isFinite(notional) || notional < 0) return defaultLeverage
  const t = tiers?.length ? tiers : null
  if (!t) return defaultLeverage
  let symbolLeverage = defaultLeverage
  for (const tier of t) {
    const from = parseFloat(tier.notional_from) || 0
    const to = tier.notional_to != null ? parseFloat(tier.notional_to) : Infinity
    if (notional >= from && notional < to) {
      symbolLeverage = tier.max_leverage
      break
    }
  }
  const minL = userMin != null ? userMin : 1
  const maxL = userMax != null ? userMax : 1000
  return Math.max(minL, Math.min(maxL, symbolLeverage))
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

