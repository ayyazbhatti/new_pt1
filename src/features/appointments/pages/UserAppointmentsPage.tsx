import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import type { Appointment, AppointmentStatus, AppointmentType } from '../types'
import { formatDate, formatTime } from '../utils/format'
import { StatusBadge } from '../components/StatusBadge'
import { ViewAppointmentModal } from '../modals/ViewAppointmentModal'
import { getUserAppointments } from '../api/appointments.api'
import { Calendar, MapPin, Video } from 'lucide-react'

const STORAGE_SEARCH_KEY = 'appointments-page-search'

export function UserAppointmentsPage() {
  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem(STORAGE_SEARCH_KEY) ?? '')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const openModal = useModalStore((s) => s.openModal)

  useEffect(() => {
    if (searchQuery) localStorage.setItem(STORAGE_SEARCH_KEY, searchQuery)
    else localStorage.removeItem(STORAGE_SEARCH_KEY)
  }, [searchQuery])

  const listParams = useMemo(() => ({
    limit: 100,
    offset: 0,
    status: statusFilter === 'all' ? undefined : (statusFilter as AppointmentStatus),
    type: typeFilter === 'all' ? undefined : (typeFilter as AppointmentType),
  }), [statusFilter, typeFilter])

  const { data, isLoading } = useQuery({
    queryKey: ['user', 'appointments', listParams],
    queryFn: () => getUserAppointments(listParams),
    staleTime: 30_000,
  })

  const appointments = data?.appointments ?? []
  const filtered = useMemo(() => {
    let list = [...appointments]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((a) => a.title.toLowerCase().includes(q))
    }
    return list.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  }, [appointments, searchQuery])

  const hasActiveFilters = searchQuery || statusFilter !== 'all' || typeFilter !== 'all'

  const handleClearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setTypeFilter('all')
  }

  const handleView = (apt: Appointment) => {
    openModal(
      'user-view-apt',
      <ViewAppointmentModal appointment={apt} />,
      { title: 'Appointment details', size: 'md' }
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Appointments"
        description="View and manage your scheduled appointments"
      />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-slate-400">Search</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search appointments..."
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs text-slate-400">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          >
            <option value="all">All</option>
            {(['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled'] as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs text-slate-400">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          >
            <option value="all">All</option>
            {(['consultation', 'support', 'onboarding', 'review', 'other'] as AppointmentType[]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={handleClearFilters} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">
            Clear
          </Button>
        )}
      </div>

      {/* Card grid */}
      {isLoading ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-12 text-center">
          <p className="text-slate-400">Loading appointments...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-12 text-center">
          <p className="text-slate-400">
            {hasActiveFilters ? 'No appointments match your filters. Try adjusting them.' : 'No appointments found.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((apt) => (
            <div
              key={apt.id}
              className="rounded-lg border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-bold text-white">{apt.title}</h3>
                <StatusBadge status={apt.status} />
              </div>
              {apt.description && (
                <p className="mb-2 text-sm text-slate-400 line-clamp-2">{apt.description}</p>
              )}
              <p className="mb-1 flex items-center gap-2 text-sm text-slate-300">
                <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
                {formatDate(apt.scheduled_at)} · {formatTime(apt.scheduled_at)}
              </p>
              <p className="mb-2 text-xs text-slate-400">{apt.duration_minutes} min · {apt.type}</p>
              {apt.meeting_link && (
                <a
                  href={apt.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                >
                  <Video className="h-3 w-3" /> Meeting link
                </a>
              )}
              {apt.location && (
                <p className="mb-2 flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="h-3 w-3" /> {apt.location}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleView(apt)}
                className="mt-2 w-full border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600"
              >
                View Details
              </Button>
            </div>
          ))}
        </div>
      )}
    </ContentShell>
  )
}
