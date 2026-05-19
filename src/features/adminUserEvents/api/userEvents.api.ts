import { http } from '@/shared/api/http'
import type { UserEventItem, UserEventsListResponse } from '../types'

interface UserEventApiItem {
  id: string
  subjectUserId: string
  subjectEmail: string
  subjectName: string
  actorUserId?: string | null
  actorEmail?: string | null
  actorName?: string | null
  eventType: string
  category: string
  ip?: string | null
  userAgent?: string | null
  deviceClass: string
  deviceOs?: string | null
  deviceBrowser?: string | null
  meta: Record<string, unknown>
  createdAt: string
}

interface ListUserEventsApiResponse {
  items: UserEventApiItem[]
  cursor?: string | null
  hasMore: boolean
  total: number
}

function mapItem(r: UserEventApiItem): UserEventItem {
  return {
    id: r.id,
    subjectUserId: r.subjectUserId,
    subjectEmail: r.subjectEmail,
    subjectName: r.subjectName,
    actorUserId: r.actorUserId,
    actorEmail: r.actorEmail,
    actorName: r.actorName,
    eventType: r.eventType,
    category: r.category,
    ip: r.ip,
    userAgent: r.userAgent,
    deviceClass: r.deviceClass ?? 'unknown',
    deviceOs: r.deviceOs,
    deviceBrowser: r.deviceBrowser,
    meta: r.meta ?? {},
    createdAt: r.createdAt,
  }
}

export type ListUserEventsParams = {
  search?: string
  category?: string
  eventType?: string
  deviceClass?: string
  userId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

export async function listUserEvents(
  params: ListUserEventsParams
): Promise<UserEventsListResponse> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.category && params.category !== 'all') query.set('category', params.category)
  if (params.eventType && params.eventType !== 'all') query.set('event_type', params.eventType)
  if (params.deviceClass && params.deviceClass !== 'all') {
    query.set('device_class', params.deviceClass)
  }
  if (params.userId) query.set('user_id', params.userId)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))

  const qs = query.toString()
  const path = qs ? `/api/admin/user-events?${qs}` : '/api/admin/user-events'
  const data = await http<ListUserEventsApiResponse>(path)
  return {
    items: (data.items ?? []).map(mapItem),
    cursor: data.cursor,
    hasMore: data.hasMore,
    total: data.total,
  }
}
