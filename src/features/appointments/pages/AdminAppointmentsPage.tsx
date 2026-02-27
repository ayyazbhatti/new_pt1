import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import type { Appointment, AppointmentStatus, AppointmentType } from '../types'
import { AdminAppointmentsTable } from '../components/AdminAppointmentsTable'
import { MonthCalendar } from '../components/MonthCalendar'
import { ViewAppointmentModal } from '../modals/ViewAppointmentModal'
import { CreateAppointmentModal } from '../modals/CreateAppointmentModal'
import { EditAppointmentModal } from '../modals/EditAppointmentModal'
import { RescheduleModal } from '../modals/RescheduleModal'
import { CancelAppointmentModal } from '../modals/CancelAppointmentModal'
import { CompleteAppointmentModal } from '../modals/CompleteAppointmentModal'
import { SendReminderModal } from '../modals/SendReminderModal'
import {
  getAppointments,
  getAppointmentStats,
  searchUsersForAppointment,
  createAppointment,
  updateAppointment,
  rescheduleAppointment,
  cancelAppointment,
  completeAppointment,
  sendAppointmentReminder,
} from '../api/appointments.api'
import { Calendar, List, Plus, X } from 'lucide-react'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'

const STORAGE_SEARCH_KEY = 'admin-appointments-search'
const PAGE_SIZES = [10, 20, 50, 100, 200]
const QUERY_KEY_ADMIN_APPOINTMENTS = ['admin', 'appointments'] as const
const QUERY_KEY_STATS = ['admin', 'appointments', 'stats'] as const

export function AdminAppointmentsPage() {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [calendarDate, setCalendarDate] = useState(() => new Date())
  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem(STORAGE_SEARCH_KEY) ?? '')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [startDateFilter, setStartDateFilter] = useState('')
  const [endDateFilter, setEndDateFilter] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const openModal = useModalStore((s) => s.openModal)

  useEffect(() => {
    if (searchQuery) localStorage.setItem(STORAGE_SEARCH_KEY, searchQuery)
    else localStorage.removeItem(STORAGE_SEARCH_KEY)
  }, [searchQuery])

  const listParams = useMemo(() => {
    const start = viewMode === 'calendar'
      ? new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1).toISOString().slice(0, 10)
      : startDateFilter || undefined
    const end = viewMode === 'calendar'
      ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0).toISOString().slice(0, 10)
      : endDateFilter || undefined
    return {
      limit: viewMode === 'calendar' ? 500 : pageSize,
      offset: viewMode === 'calendar' ? 0 : pageIndex * pageSize,
      search: searchQuery.trim() || undefined,
      status: statusFilter === 'all' ? undefined : (statusFilter as AppointmentStatus),
      type: typeFilter === 'all' ? undefined : (typeFilter as AppointmentType),
      user_id: userFilter === 'all' ? undefined : userFilter,
      start_date: start,
      end_date: end,
    }
  }, [viewMode, calendarDate, pageIndex, pageSize, searchQuery, statusFilter, typeFilter, userFilter, startDateFilter, endDateFilter])

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [...QUERY_KEY_ADMIN_APPOINTMENTS, listParams],
    queryFn: () => getAppointments(listParams),
    staleTime: 30_000,
  })

  const { data: stats } = useQuery({
    queryKey: QUERY_KEY_STATS,
    queryFn: getAppointmentStats,
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_ADMIN_APPOINTMENTS })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_STATS })
      toast.success('Appointment created.')
      useModalStore.getState().closeModal('create-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateAppointment>[1] }) => updateAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_ADMIN_APPOINTMENTS })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_STATS })
      toast.success('Appointment updated.')
      useModalStore.getState().closeModal('edit-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof rescheduleAppointment>[1] }) => rescheduleAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_ADMIN_APPOINTMENTS })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_STATS })
      toast.success('Appointment rescheduled.')
      useModalStore.getState().closeModal('reschedule-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof cancelAppointment>[1] }) => cancelAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_ADMIN_APPOINTMENTS })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_STATS })
      toast.success('Appointment cancelled.')
      useModalStore.getState().closeModal('cancel-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const completeMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof completeAppointment>[1] }) => completeAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_ADMIN_APPOINTMENTS })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_STATS })
      toast.success('Appointment marked complete.')
      useModalStore.getState().closeModal('complete-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const reminderMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof sendAppointmentReminder>[1] }) => sendAppointmentReminder(id, payload),
    onSuccess: () => {
      toast.success('Reminder sent.')
      useModalStore.getState().closeModal('reminder-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const appointments = listData?.appointments ?? []
  const total = listData?.total ?? 0
  const paginatedAppointments = viewMode === 'list' ? appointments : appointments
  const filteredAppointments = appointments
  const totalPages = viewMode === 'list' && pageSize > 0 ? Math.ceil(total / pageSize) : 1

  const userOptions = useMemo(() => {
    const seen = new Set<string>()
    return appointments
      .filter((a) => {
        if (seen.has(a.user_id)) return false
        seen.add(a.user_id)
        return true
      })
      .map((a) => ({ id: a.user_id, name: a.user_name ?? a.user_email ?? 'Unknown' }))
  }, [appointments])

  const handleView = (apt: Appointment) => {
    openModal(
      'view-apt',
      <ViewAppointmentModal appointment={apt} />,
      { title: 'Appointment details', size: 'md' }
    )
  }

  const handleCreate = () => {
    openModal(
      'create-apt',
      <CreateAppointmentModal
        onSearchUsers={(q, limit) => searchUsersForAppointment(q, limit)}
        onSubmit={(payload) => createMutation.mutate(payload)}
        submitting={createMutation.isPending}
      />,
      { title: 'Create appointment', size: 'lg' }
    )
  }

  const handleEdit = (apt: Appointment) => {
    openModal(
      'edit-apt',
      <EditAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => updateMutation.mutate({ id, payload })}
        submitting={updateMutation.isPending}
      />,
      { title: 'Edit appointment', size: 'lg' }
    )
  }

  const handleReschedule = (apt: Appointment) => {
    openModal(
      'reschedule-apt',
      <RescheduleModal
        appointment={apt}
        onSubmit={(id, payload) => rescheduleMutation.mutate({ id, payload })}
        submitting={rescheduleMutation.isPending}
      />,
      { title: 'Reschedule', size: 'md' }
    )
  }

  const handleCancel = (apt: Appointment) => {
    openModal(
      'cancel-apt',
      <CancelAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => cancelMutation.mutate({ id, payload })}
        submitting={cancelMutation.isPending}
      />,
      { title: 'Cancel appointment', size: 'md' }
    )
  }

  const handleComplete = (apt: Appointment) => {
    openModal(
      'complete-apt',
      <CompleteAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => completeMutation.mutate({ id, payload })}
        submitting={completeMutation.isPending}
      />,
      { title: 'Mark complete', size: 'md' }
    )
  }

  const handleSendReminder = (apt: Appointment) => {
    openModal(
      'reminder-apt',
      <SendReminderModal
        appointment={apt}
        onSubmit={(id, payload) => reminderMutation.mutate({ id, payload })}
        submitting={reminderMutation.isPending}
      />,
      { title: 'Send reminder', size: 'lg' }
    )
  }

  const calendarAppointments = useMemo(() => {
    const start = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
    const end = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0)
    return filteredAppointments.filter((a) => {
      const t = new Date(a.scheduled_at).getTime()
      return t >= start.getTime() && t <= end.getTime() + 86400000
    })
  }, [filteredAppointments, calendarDate])

  return (
    <ContentShell>
      <PageHeader
        title="Appointments Management"
        description="Create and manage user appointments"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium',
                  viewMode === 'list' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                )}
              >
                <List className="h-4 w-4" /> List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium',
                  viewMode === 'calendar' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                )}
              >
                <Calendar className="h-4 w-4" /> Calendar View
              </button>
            </div>
            <Button onClick={handleCreate} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="mr-2 h-4 w-4" /> Create Appointment
            </Button>
          </div>
        }
      />

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Appointments', value: stats?.total_appointments ?? 0 },
          { label: "Today's Appointments", value: stats?.today_appointments ?? 0 },
          { label: 'Upcoming (7 days)', value: stats?.upcoming_7_days ?? 0 },
          { label: 'Overdue', value: stats?.overdue_appointments ?? 0 },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-sm text-slate-400">{card.label}</p>
            <p className="mt-1 text-xl font-bold text-white">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-lg border border-slate-700 bg-slate-800 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="relative flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs text-slate-400">Search</label>
            <div className="relative">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, user..."
                className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs text-slate-400">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled'] as AppointmentStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs text-slate-400">Type</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(['consultation', 'support', 'onboarding', 'review', 'other'] as AppointmentType[]).map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs text-slate-400">User</label>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {userOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Start date</label>
            <Input type="date" value={startDateFilter} onChange={(e) => setStartDateFilter(e.target.value)} className="w-40 border-slate-600 bg-slate-700 text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">End date</label>
            <Input type="date" value={endDateFilter} onChange={(e) => setEndDateFilter(e.target.value)} className="w-40 border-slate-600 bg-slate-700 text-white" />
          </div>
        </div>
      </div>

      {viewMode === 'list' && (
        <>
          {listLoading ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
              Loading appointments...
            </div>
          ) : (
          <>
          <AdminAppointmentsTable
            appointments={paginatedAppointments}
            onView={handleView}
            onEdit={handleEdit}
            onReschedule={handleReschedule}
            onCancel={handleCancel}
            onComplete={handleComplete}
            onSendReminder={handleSendReminder}
          />
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-slate-400">
              Showing {(pageIndex * pageSize) + 1} to {Math.min((pageIndex + 1) * pageSize, total)} of {total} results
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0) }}
                className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => setPageIndex(0)} disabled={pageIndex === 0} className="border-slate-600 bg-slate-700 text-slate-300">
                First
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={pageIndex === 0} className="border-slate-600 bg-slate-700 text-slate-300">
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))} disabled={pageIndex >= totalPages - 1} className="border-slate-600 bg-slate-700 text-slate-300">
                Next
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPageIndex(totalPages - 1)} disabled={pageIndex >= totalPages - 1 || totalPages === 0} className="border-slate-600 bg-slate-700 text-slate-300">
                Last
              </Button>
            </div>
          </div>
          </>
          )}
        </>
      )}

      {viewMode === 'calendar' && (
        <MonthCalendar
          calendarDate={calendarDate}
          appointments={calendarAppointments}
          onPrevMonth={() => setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1))}
          onNextMonth={() => setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1))}
          onToday={() => setCalendarDate(new Date())}
          onAppointmentClick={handleView}
        />
      )}
    </ContentShell>
  )
}
