import { http } from '@/shared/api/http'

export interface UpdateUserGroupPayload {
  group_id: string
  min_leverage?: number
  max_leverage?: number
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

