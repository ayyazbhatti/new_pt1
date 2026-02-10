import { http } from '@/shared/api/http'

export interface UpdateUserGroupPayload {
  group_id: string
}

export async function updateUserGroup(userId: string, payload: UpdateUserGroupPayload): Promise<void> {
  await http(`/api/admin/users/${userId}/group`, {
    method: 'PUT',
    body: JSON.stringify({
      group_id: payload.group_id,
    }),
  })
}

