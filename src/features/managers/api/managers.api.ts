import { http } from '@/shared/api/http'
import type { Manager } from '../types/manager'

/** Backend response shape (snake_case) */
export interface ManagerDto {
  id: string
  user_id: string
  user_name: string
  user_email: string
  user_role: string
  permission_profile_id: string
  permission_profile_name: string
  status: string
  notes: string | null
  created_at: string
  last_login_at: string | null
}

function fromDto(d: ManagerDto): Manager {
  return {
    id: d.id,
    userId: d.user_id,
    userName: d.user_name,
    userEmail: d.user_email,
    role: d.user_role,
    permissionProfileId: d.permission_profile_id,
    permissionProfileName: d.permission_profile_name,
    status: d.status === 'disabled' ? 'disabled' : 'active',
    createdAt: d.created_at,
    lastLoginAt: d.last_login_at ?? undefined,
    notes: d.notes ?? undefined,
  }
}

export interface ListManagersParams {
  status?: string
  permission_profile_id?: string
  search?: string
}

export async function listManagers(params?: ListManagersParams): Promise<Manager[]> {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.permission_profile_id) searchParams.set('permission_profile_id', params.permission_profile_id)
  if (params?.search?.trim()) searchParams.set('search', params.search.trim())
  const query = searchParams.toString()
  const list = await http<ManagerDto[]>(
    `/api/admin/managers${query ? `?${query}` : ''}`,
    { method: 'GET' }
  )
  return list.map(fromDto)
}

export interface CreateManagerPayload {
  user_id: string
  permission_profile_id: string
  role?: string | null
  notes?: string | null
}

export async function createManager(payload: CreateManagerPayload): Promise<Manager> {
  const d = await http<ManagerDto>('/api/admin/managers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return fromDto(d)
}

export interface UpdateManagerPayload {
  permission_profile_id?: string
  notes?: string | null
  status?: 'active' | 'disabled'
}

export async function updateManager(id: string, payload: UpdateManagerPayload): Promise<Manager> {
  const d = await http<ManagerDto>(`/api/admin/managers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return fromDto(d)
}

export async function deleteManager(id: string): Promise<void> {
  await http(`/api/admin/managers/${id}`, { method: 'DELETE' })
}
