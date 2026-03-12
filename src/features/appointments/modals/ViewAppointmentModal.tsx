import type { Appointment } from '../types'
import { formatDateTime } from '../utils/format'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { MapPin, Video } from 'lucide-react'

interface ViewAppointmentModalProps {
  appointment: Appointment
}

export function ViewAppointmentModal({ appointment }: ViewAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-bold text-white">{appointment.title}</h3>
        <StatusBadge status={appointment.status} />
      </div>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-slate-400">{appointment.lead_id ? 'Lead' : 'User'}</dt>
          <dd className="font-medium text-slate-300">
            {appointment.lead_id
              ? (appointment.lead_name ?? '—')
              : `${appointment.user_name ?? '—'} (${appointment.user_email ?? '—'})`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Created by (Admin)</dt>
          <dd className="text-slate-300">{appointment.admin_email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Date & time</dt>
          <dd className="text-slate-300">{formatDateTime(appointment.scheduled_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Duration</dt>
          <dd className="text-slate-300">{appointment.duration_minutes} min</dd>
        </div>
        <div>
          <dt className="text-slate-400">Type</dt>
          <dd className="capitalize text-slate-300">{appointment.type}</dd>
        </div>
        {appointment.description && (
          <div>
            <dt className="text-slate-400">Description</dt>
            <dd className="text-slate-300">{appointment.description}</dd>
          </div>
        )}
        {appointment.meeting_link && (
          <div>
            <dt className="text-slate-400 flex items-center gap-1">
              <Video className="h-4 w-4" /> Meeting link
            </dt>
            <dd className="flex items-center gap-2">
              <a
                href={appointment.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Video className="h-4 w-4" /> Join Meeting
              </a>
            </dd>
          </div>
        )}
        {appointment.location && (
          <div>
            <dt className="text-slate-400 flex items-center gap-1">
              <MapPin className="h-4 w-4" /> Location
            </dt>
            <dd className="text-slate-300">{appointment.location}</dd>
          </div>
        )}
        {appointment.notes && (
          <div>
            <dt className="text-slate-400">Internal notes</dt>
            <dd className="text-slate-300">{appointment.notes}</dd>
          </div>
        )}
      </dl>
      <div className="flex justify-end border-t border-slate-700 pt-4">
        <Button onClick={() => closeModal('view-apt')} className="bg-slate-700 hover:bg-slate-600">
          Close
        </Button>
      </div>
    </div>
  )
}
