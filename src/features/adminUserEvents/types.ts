export type UserEventCategory = 'auth' | 'all'

export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'

export type UserEventItem = {
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

export type UserEventsListResponse = {
  items: UserEventItem[]
  cursor?: string | null
  hasMore: boolean
  total: number
}

import type { DateRangePreset } from './utils/dateRange'

export type UserEventFilters = {
  search: string
  category: string
  eventType: string
  deviceClass: string
  userId: string
  datePreset: DateRangePreset
  dateFrom: string
  dateTo: string
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  'auth.register': 'Registered',
  'auth.login': 'Logged in',
  'auth.logout': 'Logged out',
  'auth.session_created': 'Session created',
  'auth.password_reset': 'Password reset',
  'admin.impersonate': 'Admin impersonation',
  'finance.deposit_approved': 'Deposit approved',
  'finance.deposit_rejected': 'Deposit rejected',
}

export const DEVICE_CLASSES = [
  { value: 'all', label: 'All devices' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'bot', label: 'Bot' },
  { value: 'unknown', label: 'Unknown' },
] as const

export function deviceClassLabel(deviceClass: string): string {
  const found = DEVICE_CLASSES.find((d) => d.value === deviceClass)
  return found?.label ?? deviceClass
}

export const EVENT_CATEGORIES = [
  { value: 'all', label: 'All categories' },
  { value: 'auth', label: 'Auth' },
  { value: 'finance', label: 'Finance' },
  { value: 'admin', label: 'Admin' },
] as const

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType
}
