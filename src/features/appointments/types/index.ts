// Specification-aligned types (snake_case for API parity; use as-is in UI with optional camelCase mapping later)

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'

export type AppointmentType =
  | 'consultation'
  | 'support'
  | 'onboarding'
  | 'review'
  | 'other'

export type ReminderType = '24h' | '2h' | '1h' | '15m' | 'custom'

export interface Appointment {
  id: string
  user_id: string
  admin_id: string
  title: string
  description?: string
  scheduled_at: string // ISO 8601
  duration_minutes: number
  status: AppointmentStatus
  type: AppointmentType
  meeting_link?: string
  location?: string
  notes?: string
  cancelled_at?: string
  completed_at?: string
  rescheduled_at?: string
  cancelled_reason?: string
  completion_notes?: string
  created_at: string
  updated_at: string
  // From joined queries
  user_email?: string
  user_name?: string
  admin_email?: string
}

export interface AppointmentStats {
  total_appointments: number
  scheduled_appointments: number
  confirmed_appointments: number
  completed_appointments: number
  cancelled_appointments: number
  rescheduled_appointments: number
  today_appointments: number
  upcoming_7_days: number
  overdue_appointments: number
  avg_duration_minutes?: number
}

export interface AppointmentQueryParams {
  limit?: number
  offset?: number
  search?: string
  status?: AppointmentStatus
  type?: AppointmentType
  user_id?: string
  admin_id?: string
  start_date?: string
  end_date?: string
}

export interface AppointmentsResponse {
  appointments: Appointment[]
  total: number
  limit: number
  offset: number
}

export interface UserSearchResult {
  id: string
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
}

export interface CreateAppointmentRequest {
  user_id: string
  title: string
  description?: string
  scheduled_at: string
  duration_minutes: number
  type?: AppointmentType
  meeting_link?: string
  location?: string
  notes?: string
}

export interface UpdateAppointmentRequest {
  title?: string
  description?: string
  scheduled_at?: string
  duration_minutes?: number
  status?: AppointmentStatus
  type?: AppointmentType
  meeting_link?: string
  location?: string
  notes?: string
}

export interface SendReminderRequest {
  reminder_type: ReminderType
  subject: string
  message: string
}

export interface RescheduleAppointmentRequest {
  scheduled_at: string
  reason?: string
}

export interface CancelAppointmentRequest {
  reason: string
  additional_details?: string
}

export interface CompleteAppointmentRequest {
  completion_notes?: string
}
