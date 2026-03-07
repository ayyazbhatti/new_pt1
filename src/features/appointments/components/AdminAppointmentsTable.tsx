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
  canEdit?: boolean
  canReschedule?: boolean
  canCancel?: boolean
  canComplete?: boolean
  canSendReminder?: boolean
}

export function AdminAppointmentsTable({
  appointments,
  onView,
  onEdit,
  onReschedule,
  onCancel,
  onComplete,
  onSendReminder,
  canEdit = true,
  canReschedule = true,
  canCancel = true,
  canComplete = true,
  canSendReminder = true,
}: AdminAppointmentsTableProps) {
  const canAct = (apt: Appointment) =>
    apt.status !== 'cancelled' && apt.status !== 'completed'

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full min-w-[800px]">
        <thead className="border-b border-slate-700 bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">User</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Title</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Scheduled</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Duration</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">Created by</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 whitespace-nowrap">Actions</th>
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
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-0 max-w-[180px] items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-sm font-medium text-slate-300">
                      {(apt.user_name ?? apt.user_email ?? '?')[0].toUpperCase()}
                    </div>
                    <span className="min-w-0 truncate text-sm font-medium text-white" title={`${apt.user_name ?? '—'} ${apt.user_email ?? ''}`}>
                      {apt.user_name ?? apt.user_email ?? '—'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle max-w-[200px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium text-slate-200" title={apt.title}>
                      {apt.title}
                    </span>
                    {apt.meeting_link && (
                      <a
                        href={apt.meeting_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 text-blue-400 hover:underline"
                        title="Meeting link"
                      >
                        <Video className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-sm text-slate-300">
                  {formatDate(apt.scheduled_at)} {formatTime(apt.scheduled_at)}
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-sm text-slate-300">{apt.duration_minutes} min</td>
                <td className="px-4 py-3 align-middle whitespace-nowrap">
                  <StatusBadge status={apt.status} />
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap capitalize text-slate-300">{apt.type}</td>
                <td className="px-4 py-3 align-middle max-w-[160px]">
                  <span className="block min-w-0 truncate text-sm text-slate-400" title={apt.admin_email ?? undefined}>
                    {apt.admin_email ?? '—'}
                  </span>
                </td>
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
                        {canSendReminder && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                            onClick={() => onSendReminder(apt)}
                            title="Send reminder"
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                        {canEdit && (apt.status === 'scheduled' || apt.status === 'rescheduled') && (
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
                        {canReschedule && apt.status === 'scheduled' && (
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
                        {canComplete && (apt.status === 'scheduled' || apt.status === 'confirmed') && (
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
                        {canCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
                            onClick={() => onCancel(apt)}
                            title="Cancel"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
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
