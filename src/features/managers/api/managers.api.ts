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
  tag_ids?: string[]
  created_by_user_id?: string | null
  created_by_email?: string | null
}

function fromDto(d: ManagerDto): Manager {
  const status: Manager['status'] =
    d.status === 'disabled' ? 'disabled' : d.status === 'active' ? 'active' : d.status
  return {
    id: d.id,
    userId: d.user_id,
    userName: d.user_name,
    userEmail: d.user_email,
    role: d.user_role,
    permissionProfileId: d.permission_profile_id,
    permissionProfileName: d.permission_profile_name,
    status,
    createdAt: d.created_at,
    lastLoginAt: d.last_login_at ?? undefined,
    notes: d.notes ?? undefined,
    tagIds: Array.isArray(d.tag_ids) ? d.tag_ids : undefined,
    createdByUserId: d.created_by_user_id ?? undefined,
    createdByEmail: d.created_by_email ?? undefined,
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
  /** When editing admin/super_admin: set to 'admin' or 'super_admin' to toggle. */
  role?: 'admin' | 'super_admin'
}

/** Get a single manager by id. Returns null on 404 or 405 (GET not implemented). */
export async function getManager(id: string): Promise<Manager | null> {
  try {
    const d = await http<ManagerDto>(`/api/admin/managers/${id}`, { method: 'GET' })
    return fromDto(d)
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404 || status === 405) return null
    throw err
  }
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

/** Get tag IDs assigned to a manager. */
export async function getManagerTags(managerId: string): Promise<string[]> {
  const res = await http<{ tag_ids: string[] }>(`/api/admin/manager-tags/${managerId}`, {
    method: 'GET',
  })
  return res.tag_ids ?? []
}

/** Assign tags to a manager (replaces existing). */
export async function setManagerTags(managerId: string, tagIds: string[]): Promise<void> {
  await http(`/api/admin/manager-tags/${managerId}`, {
    method: 'PUT',
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}

/** Response shape for GET /api/admin/managers/:id/statistics (when backend implements it). */
export interface ManagerStatisticsResponse {
  overview?: { totalUsers: number; totalGroups: number; activeUsers: number; assignedLeads: number }
  deposits?: { totalCount: number; totalVolume: number; todayCount: number; todayVolume: number; pendingCount: number }
  withdrawals?: { totalCount: number; totalVolume: number; todayCount: number; todayVolume: number; pendingCount: number }
  positions?: { openCount: number; totalExposure: number; closedToday: number; livePnl: number }
  orders?: { activeCount: number; filledToday: number; cancelledToday: number }
  recentDeposits?: Array<{ id: string; user: string; amount: number; currency: string; status: string; time: string }>
  recentWithdrawals?: Array<{ id: string; user: string; amount: number; currency: string; status: string; time: string }>
  openPositions?: Array<{ id: string; symbol: string; side: string; size: number; entry: number; mark: number; livePnl: number; user: string }>
  recentOrders?: Array<{ id: string; user: string; symbol: string; side: string; type: string; status: string }>
  topTraders?: Array<{ rank: number; user: string; pnl: number; winRate: number; volume: number }>
  topLosers?: Array<{ rank: number; user: string; pnl: number; winRate: number; volume: number }>
}

/** Fetch pre-aggregated statistics for a manager (for super_admin viewing another manager). Returns null on 404. */
export async function fetchManagerStatistics(managerId: string): Promise<ManagerStatisticsResponse | null> {
  try {
    return await http<ManagerStatisticsResponse>(`/api/admin/managers/${managerId}/statistics`, { method: 'GET' })
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    throw err
  }
}
