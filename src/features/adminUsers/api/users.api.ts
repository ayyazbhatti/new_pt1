import { http } from '@/shared/api/http'

export interface UpdateUserProfilePayload {
  first_name: string
  last_name: string
  email?: string
  phone?: string | null
  country?: string
  status?: 'active' | 'disabled' | 'suspended'
}

export async function updateUserProfile(
  userId: string,
  payload: UpdateUserProfilePayload
): Promise<void> {
  const body: Record<string, unknown> = {
    first_name: payload.first_name.trim(),
    last_name: payload.last_name.trim(),
  }
  if (payload.email !== undefined) body.email = payload.email.trim() || null
  if (payload.phone !== undefined) body.phone = payload.phone?.trim() ?? null
  if (payload.country !== undefined) body.country = payload.country?.trim() ?? null
  if (payload.status !== undefined) body.status = payload.status
  await http(`/api/admin/users/${userId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export interface UpdateUserGroupPayload {
  group_id: string
  min_leverage?: number
  max_leverage?: number
}

export interface UpdateUserAccountTypePayload {
  account_type: 'hedging' | 'netting'
}

export async function updateUserGroup(userId: string, payload: UpdateUserGroupPayload): Promise<void> {
  const body: Record<string, unknown> = { group_id: payload.group_id }
  if (payload.min_leverage != null && payload.max_leverage != null) {
    body.min_leverage = payload.min_leverage
    body.max_leverage = payload.max_leverage
  }
  await http(`/api/admin/users/${userId}/group`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function updateUserAccountType(
  userId: string,
  payload: UpdateUserAccountTypePayload
): Promise<void> {
  await http(`/api/admin/users/${userId}/account-type`, {
    method: 'PUT',
    body: JSON.stringify({ account_type: payload.account_type }),
  })
}

export interface UpdateUserMarginCalculationTypePayload {
  margin_calculation_type: 'hedged' | 'net'
}

export async function updateUserMarginCalculationType(
  userId: string,
  payload: UpdateUserMarginCalculationTypePayload
): Promise<void> {
  await http(`/api/admin/users/${userId}/margin-calculation-type`, {
    method: 'PUT',
    body: JSON.stringify({ margin_calculation_type: payload.margin_calculation_type }),
  })
}

export interface UpdateUserTradingAccessPayload {
  trading_access: 'full' | 'close_only' | 'disabled'
}

export async function updateUserTradingAccess(
  userId: string,
  payload: UpdateUserTradingAccessPayload
): Promise<void> {
  await http(`/api/admin/users/${userId}/trading-access`, {
    method: 'PUT',
    body: JSON.stringify({ trading_access: payload.trading_access }),
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

export interface ImpersonateResponse {
  access_token: string
  refresh_token: string
}

/** Get tokens to sign in as another user (admin only). Open /impersonate#access_token=...&refresh_token=... in a new tab to apply. */
export async function impersonateUser(userId: string): Promise<ImpersonateResponse> {
  const response = await http<ImpersonateResponse>(
    `/api/admin/users/${userId}/impersonate`,
    { method: 'POST' }
  )
  return response
}

export interface SendNotifyPayload {
  title: string
  message: string
}

export interface SendNotifyResponse {
  success: boolean
  notification_id: string
}

/** Send a notification to a user (admin only). User sees it in their notification panel. */
export async function sendNotificationToUser(
  userId: string,
  payload: SendNotifyPayload
): Promise<SendNotifyResponse> {
  return http<SendNotifyResponse>(`/api/admin/users/${userId}/notify`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
