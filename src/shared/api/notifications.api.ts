import { http } from './http'
import { NotificationPushPayload } from '../ws/wsEvents'

export interface NotificationResponse {
  items: NotificationPushPayload[]
  unreadCount: number
}

export async function fetchNotifications(): Promise<NotificationResponse> {
  return http<NotificationResponse>('/api/notifications')
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await http(`/api/notifications/${notificationId}/read`, { method: 'PATCH' })
}

export async function markAllNotificationsRead(): Promise<{ markedCount: number }> {
  return http<{ markedCount: number }>('/api/notifications/read-all', { method: 'POST' })
}

