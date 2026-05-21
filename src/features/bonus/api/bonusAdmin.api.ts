import { http } from '@/shared/api/http'

export interface AdminBonusStateResponse {
  userId: string
  balance: string
  locked: string
  revokable: string
}

export async function fetchAdminBonusUser(userId: string): Promise<AdminBonusStateResponse> {
  return http<AdminBonusStateResponse>(`/api/admin/bonus/user/${encodeURIComponent(userId)}`)
}

export async function postAdminBonusGrant(body: {
  userId: string
  amount: string
  note?: string
}): Promise<{ success: boolean; newBonusBalance: string }> {
  return http('/api/admin/bonus/grant', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function postAdminBonusRevoke(body: {
  userId: string
  amount: string
  note?: string
}): Promise<{ success: boolean; newBonusBalance: string }> {
  return http('/api/admin/bonus/revoke', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface BonusTxRow {
  id: string
  userId: string
  type: string
  amount: string
  netAmount: string
  reference?: string | null
  methodDetails?: Record<string, unknown> | null
  createdAt: string
}

export interface PaginatedBonusTx {
  items: BonusTxRow[]
  total: number
  limit: number
  offset: number
}

export async function fetchAdminBonusTransactions(params: {
  userId?: string
  from?: string
  to?: string
  type?: string
  adminId?: string
  limit?: number
  offset?: number
}): Promise<PaginatedBonusTx> {
  const q = new URLSearchParams()
  if (params.userId) q.set('userId', params.userId)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.type) q.set('type', params.type)
  if (params.adminId) q.set('adminId', params.adminId)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return http<PaginatedBonusTx>(`/api/admin/bonus/transactions${qs ? `?${qs}` : ''}`)
}

export async function fetchAdminBonusUserHistory(
  userId: string,
  params: { from?: string; to?: string; type?: string; limit?: number; offset?: number }
): Promise<PaginatedBonusTx> {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.type) q.set('type', params.type)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return http<PaginatedBonusTx>(
    `/api/admin/bonus/user/${encodeURIComponent(userId)}/history${qs ? `?${qs}` : ''}`
  )
}
