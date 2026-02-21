import { http } from '@/shared/api/http'

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
