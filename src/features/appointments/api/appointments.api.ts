import { http } from '@/shared/api/http'
import type {
  Appointment,
  AppointmentStats,
  AppointmentQueryParams,
  AppointmentsResponse,
  UserSearchResult,
  CreateAppointmentRequest,
  UpdateAppointmentRequest,
  SendReminderRequest,
  RescheduleAppointmentRequest,
  CancelAppointmentRequest,
  CompleteAppointmentRequest,
} from '../types'

/** User: list current user's appointments */
export async function getUserAppointments(
  params?: AppointmentQueryParams
): Promise<AppointmentsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.limit != null) searchParams.set('limit', String(params.limit))
  if (params?.offset != null) searchParams.set('offset', String(params.offset))
  if (params?.status) searchParams.set('status', params.status)
  if (params?.type) searchParams.set('type', params.type)
  if (params?.start_date) searchParams.set('start_date', params.start_date)
  if (params?.end_date) searchParams.set('end_date', params.end_date)
  const q = searchParams.toString()
  const data = await http<AppointmentsResponse>(
    `/api/appointments${q ? `?${q}` : ''}`,
    { method: 'GET' }
  )
  return data
}

/** User: get one appointment by id */
export async function getUserAppointment(id: string): Promise<Appointment> {
  return http<Appointment>(`/api/appointments/${id}`, { method: 'GET' })
}

/** Admin: list all appointments with filters */
export async function getAppointments(
  params?: AppointmentQueryParams
): Promise<AppointmentsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.limit != null) searchParams.set('limit', String(params.limit))
  if (params?.offset != null) searchParams.set('offset', String(params.offset))
  if (params?.search) searchParams.set('search', params.search)
  if (params?.status) searchParams.set('status', params.status)
  if (params?.type) searchParams.set('type', params.type)
  if (params?.user_id) searchParams.set('user_id', params.user_id)
  if (params?.admin_id) searchParams.set('admin_id', params.admin_id)
  if (params?.start_date) searchParams.set('start_date', params.start_date)
  if (params?.end_date) searchParams.set('end_date', params.end_date)
  const q = searchParams.toString()
  const data = await http<AppointmentsResponse>(
    `/api/admin/appointments${q ? `?${q}` : ''}`,
    { method: 'GET' }
  )
  return data
}

/** Admin: stats */
export async function getAppointmentStats(): Promise<AppointmentStats> {
  return http<AppointmentStats>('/api/admin/appointments/stats', { method: 'GET' })
}

/** Admin: search users for typeahead */
export async function searchUsersForAppointment(
  q: string,
  limit?: number
): Promise<UserSearchResult[]> {
  const searchParams = new URLSearchParams()
  searchParams.set('q', q)
  if (limit != null) searchParams.set('limit', String(limit))
  const data = await http<UserSearchResult[]>(
    `/api/admin/appointments/search-users?${searchParams.toString()}`,
    { method: 'GET' }
  )
  return data
}

/** Admin: get one appointment */
export async function getAppointment(id: string): Promise<Appointment> {
  return http<Appointment>(`/api/admin/appointments/${id}`, { method: 'GET' })
}

/** Admin: create */
export async function createAppointment(
  payload: CreateAppointmentRequest
): Promise<Appointment> {
  return http<Appointment>('/api/admin/appointments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Admin: update */
export async function updateAppointment(
  id: string,
  payload: UpdateAppointmentRequest
): Promise<Appointment> {
  return http<Appointment>(`/api/admin/appointments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** Admin: delete */
export async function deleteAppointment(id: string): Promise<void> {
  await http<null>(`/api/admin/appointments/${id}`, { method: 'DELETE' })
}

/** Admin: send reminder */
export async function sendAppointmentReminder(
  id: string,
  payload: SendReminderRequest
): Promise<{ message: string }> {
  return http<{ message: string }>(`/api/admin/appointments/${id}/reminder`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Admin: reschedule */
export async function rescheduleAppointment(
  id: string,
  payload: RescheduleAppointmentRequest
): Promise<Appointment> {
  return http<Appointment>(`/api/admin/appointments/${id}/reschedule`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** Admin: cancel */
export async function cancelAppointment(
  id: string,
  payload: CancelAppointmentRequest
): Promise<Appointment> {
  return http<Appointment>(`/api/admin/appointments/${id}/cancel`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** Admin: complete */
export async function completeAppointment(
  id: string,
  payload: CompleteAppointmentRequest
): Promise<Appointment> {
  return http<Appointment>(`/api/admin/appointments/${id}/complete`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
