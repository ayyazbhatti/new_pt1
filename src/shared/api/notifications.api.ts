import { http } from './http'
import { NotificationPushPayload } from '../ws/wsEvents'

export interface NotificationResponse {
  items: NotificationPushPayload[]
  unreadCount: number
}

export async function fetchNotifications(): Promise<NotificationResponse> {
  return http<NotificationResponse>('/api/notifications')
}

