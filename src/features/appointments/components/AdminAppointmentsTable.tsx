import type { Appointment } from '../types'
import { formatDate, formatTime } from '../utils/format'
import { StatusBadge } from './StatusBadge'
import { Button } from '@/shared/ui/button'
import {
  Eye,
  Mail,
  Pencil,
  Calendar,
  CheckCircle,
  Trash2,
  Video,
} from 'lucide-react'

interface AdminAppointmentsTableProps {
  appointments: Appointment[]
  onView: (apt: Appointment) => void
  onEdit: (apt: Appointment) => void
  onReschedule: (apt: Appointment) => void
  onCancel: (apt: Appointment) => void
  onComplete: (apt: Appointment) => void
  onSendReminder: (apt: Appointment) => void
}

export function AdminAppointmentsTable({
  appointments,
  onView,
  onEdit,
  onReschedule,
  onCancel,
  onComplete,
  onSendReminder,
}: AdminAppointmentsTableProps) {
  const canAct = (apt: Appointment) =>
    apt.status !== 'cancelled' && apt.status !== 'completed'

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full">
        <thead className="border-b border-slate-700 bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">User</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Title</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Scheduled</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Duration</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Created by</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700 bg-slate-800">
          {appointments.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                No appointments found.
              </td>
            </tr>
          ) : (
            appointments.map((apt) => (
              <tr
                key={apt.id}
                onClick={() => onView(apt)}
                className="cursor-pointer hover:bg-slate-700/50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-sm font-medium text-slate-300">
                      {(apt.user_name ?? apt.user_email ?? '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-white">{apt.user_name ?? '—'}</p>
                      <p className="text-xs text-slate-400">{apt.user_email ?? '—'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-200">{apt.title}</p>
                    {apt.meeting_link && (
                      <a
                        href={apt.meeting_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                      >
                        <Video className="h-3 w-3" /> Meeting link
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {formatDate(apt.scheduled_at)} {formatTime(apt.scheduled_at)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">{apt.duration_minutes} min</td>
                <td className="px-4 py-3">
                  <StatusBadge status={apt.status} />
                </td>
                <td className="px-4 py-3 capitalize text-slate-300">{apt.type}</td>
                <td className="px-4 py-3 text-sm text-slate-400">{apt.admin_email ?? '—'}</td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                      onClick={() => onView(apt)}
                      title="View"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canAct(apt) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                          onClick={() => onSendReminder(apt)}
                          title="Send reminder"
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                        {(apt.status === 'scheduled' || apt.status === 'rescheduled') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                            onClick={() => onEdit(apt)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {apt.status === 'scheduled' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                            onClick={() => onReschedule(apt)}
                            title="Reschedule"
                          >
                            <Calendar className="h-4 w-4" />
                          </Button>
                        )}
                        {(apt.status === 'scheduled' || apt.status === 'confirmed') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-green-400"
                            onClick={() => onComplete(apt)}
                            title="Mark complete"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
                          onClick={() => onCancel(apt)}
                          title="Cancel"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
