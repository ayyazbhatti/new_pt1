import type { Appointment, AppointmentStats, UserSearchResult } from '../types'

const now = new Date()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

function iso(date: Date, hour: number, minute: number) {
  const d = new Date(date)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const mockAppointments: Appointment[] = [
  {
    id: 'apt-1',
    user_id: 'user-1',
    admin_id: 'admin-1',
    title: 'Onboarding call',
    description: 'Initial platform walkthrough',
    scheduled_at: iso(today, 10, 0),
    duration_minutes: 30,
    status: 'scheduled',
    type: 'onboarding',
    meeting_link: 'https://meet.example.com/abc',
    location: 'Video call',
    notes: 'Send calendar invite',
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'john@example.com',
    user_name: 'John Doe',
    admin_email: 'admin@platform.com',
  },
  {
    id: 'apt-2',
    user_id: 'user-2',
    admin_id: 'admin-1',
    title: 'Trading support',
    description: 'Leverage and margin questions',
    scheduled_at: iso(today, 14, 30),
    duration_minutes: 45,
    status: 'confirmed',
    type: 'support',
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'jane@example.com',
    user_name: 'Jane Smith',
    admin_email: 'admin@platform.com',
  },
  {
    id: 'apt-3',
    user_id: 'user-1',
    admin_id: 'admin-1',
    title: 'Account review',
    scheduled_at: iso(new Date(today.getTime() + 2 * 86400000), 11, 0),
    duration_minutes: 60,
    status: 'scheduled',
    type: 'review',
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'john@example.com',
    user_name: 'John Doe',
    admin_email: 'admin@platform.com',
  },
  {
    id: 'apt-4',
    user_id: 'user-3',
    admin_id: 'admin-1',
    title: 'Consultation',
    scheduled_at: iso(new Date(today.getTime() + 1 * 86400000), 9, 0),
    duration_minutes: 30,
    status: 'completed',
    type: 'consultation',
    completed_at: iso(new Date(today.getTime() + 1 * 86400000), 9, 30),
    completion_notes: 'All good',
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'bob@example.com',
    user_name: 'Bob Wilson',
    admin_email: 'admin@platform.com',
  },
  {
    id: 'apt-5',
    user_id: 'user-2',
    admin_id: 'admin-1',
    title: 'Follow-up',
    scheduled_at: iso(new Date(today.getTime() - 1 * 86400000), 15, 0),
    duration_minutes: 15,
    status: 'cancelled',
    type: 'other',
    cancelled_at: iso(new Date(today.getTime() - 1 * 86400000), 14, 0),
    cancelled_reason: 'User requested reschedule',
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'jane@example.com',
    user_name: 'Jane Smith',
    admin_email: 'admin@platform.com',
  },
  {
    id: 'apt-6',
    user_id: 'user-1',
    admin_id: 'admin-1',
    title: 'Strategy consultation',
    scheduled_at: iso(new Date(today.getTime() + 5 * 86400000), 16, 0),
    duration_minutes: 45,
    status: 'rescheduled',
    type: 'consultation',
    rescheduled_at: iso(today, 0, 0),
    created_at: iso(today, 0, 0),
    updated_at: iso(today, 0, 0),
    user_email: 'john@example.com',
    user_name: 'John Doe',
    admin_email: 'admin@platform.com',
  },
]

const startOfToday = new Date(today).getTime()
const endOfToday = startOfToday + 86400000 - 1
const in7Days = startOfToday + 7 * 86400000

export const mockStats: AppointmentStats = {
  total_appointments: mockAppointments.length,
  scheduled_appointments: mockAppointments.filter((a) => a.status === 'scheduled').length,
  confirmed_appointments: mockAppointments.filter((a) => a.status === 'confirmed').length,
  completed_appointments: mockAppointments.filter((a) => a.status === 'completed').length,
  cancelled_appointments: mockAppointments.filter((a) => a.status === 'cancelled').length,
  rescheduled_appointments: mockAppointments.filter((a) => a.status === 'rescheduled').length,
  today_appointments: mockAppointments.filter((a) => {
    const t = new Date(a.scheduled_at).getTime()
    return t >= startOfToday && t < endOfToday && a.status !== 'cancelled'
  }).length,
  upcoming_7_days: mockAppointments.filter((a) => {
    const t = new Date(a.scheduled_at).getTime()
    return t >= startOfToday && t < in7Days && a.status !== 'cancelled' && a.status !== 'completed'
  }).length,
  overdue_appointments: mockAppointments.filter((a) => {
    const t = new Date(a.scheduled_at).getTime()
    return t < startOfToday && a.status !== 'completed' && a.status !== 'cancelled'
  }).length,
  avg_duration_minutes: 37,
}

export const mockUserSearchResults: UserSearchResult[] = [
  { id: 'user-1', email: 'john@example.com', first_name: 'John', last_name: 'Doe', full_name: 'John Doe' },
  { id: 'user-2', email: 'jane@example.com', first_name: 'Jane', last_name: 'Smith', full_name: 'Jane Smith' },
  { id: 'user-3', email: 'bob@example.com', first_name: 'Bob', last_name: 'Wilson', full_name: 'Bob Wilson' },
  { id: 'user-4', email: 'alice@example.com', first_name: 'Alice', last_name: 'Brown', full_name: 'Alice Brown' },
]

export function mockSearchUsers(_q: string, _limit?: number): UserSearchResult[] {
  return mockUserSearchResults
}
