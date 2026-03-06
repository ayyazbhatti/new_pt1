import { http } from '@/shared/api/http'

export interface CallRecordRow {
  id: string
  callId: string
  adminUserId: string
  adminEmail: string | null
  adminDisplayName: string | null
  userId: string
  userEmail: string | null
  userDisplayName: string | null
  status: string
  initiatedAt: string
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  endedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ListCallRecordsParams {
  limit?: number
  offset?: number
  adminUserId?: string
  userId?: string
  status?: string
  fromDate?: string
  toDate?: string
}

export interface ListCallRecordsResponse {
  records: CallRecordRow[]
  total: number
  limit: number
  offset: number
}

export async function getCallRecords(
  params: ListCallRecordsParams = {}
): Promise<ListCallRecordsResponse> {
  const searchParams = new URLSearchParams()
  if (params.limit != null) searchParams.set('limit', String(params.limit))
  if (params.offset != null) searchParams.set('offset', String(params.offset))
  if (params.adminUserId) searchParams.set('admin_user_id', params.adminUserId)
  if (params.userId) searchParams.set('user_id', params.userId)
  if (params.status) searchParams.set('status', params.status)
  if (params.fromDate) searchParams.set('from_date', params.fromDate)
  if (params.toDate) searchParams.set('to_date', params.toDate)
  const q = searchParams.toString()
  return http<ListCallRecordsResponse>(
    `/api/admin/call-records${q ? `?${q}` : ''}`,
    { method: 'GET' }
  )
}
