import { useState, useEffect } from 'react'
import type { Appointment, UpdateAppointmentRequest, AppointmentType } from '../types'
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
import { fromZonedWallClock, wallClockPartsInTimezone, useEffectiveTimezone } from '@/shared/datetime'
import { getUtcOffsetLabel } from '@/shared/datetime/resolve'

const TYPES: AppointmentType[] = ['consultation', 'support', 'onboarding', 'review', 'other']
const DURATIONS = [15, 30, 45, 60]

interface EditAppointmentModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: UpdateAppointmentRequest) => void
  submitting?: boolean
  /** When set, date/time fields are wall-clock in this IANA zone (e.g. trader effective TZ). Otherwise uses current effective TZ from context. */
  wallClockTimezone?: string | null
}

export function EditAppointmentModal({
  appointment,
  onSubmit,
  submitting = false,
  wallClockTimezone = null,
}: EditAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const effective = useEffectiveTimezone()
  const zone = (wallClockTimezone?.trim() || effective.iana) as string
  const wallClockHint = `${getUtcOffsetLabel(zone)} · ${zone}`

  const [title, setTitle] = useState(appointment.title)
  const [description, setDescription] = useState(appointment.description ?? '')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [duration_minutes, setDurationMinutes] = useState(appointment.duration_minutes)
  const [status, setStatus] = useState(appointment.status)
  const [type, setType] = useState<AppointmentType>(appointment.type)
  const [meeting_link, setMeetingLink] = useState(appointment.meeting_link ?? '')
  const [location, setLocation] = useState(appointment.location ?? '')
  const [notes, setNotes] = useState(appointment.notes ?? '')

  useEffect(() => {
    const parts = wallClockPartsInTimezone(appointment.scheduled_at, zone)
    if (parts) {
      const mm = String(parts.month).padStart(2, '0')
      const dd = String(parts.day).padStart(2, '0')
      setScheduledDate(`${parts.year}-${mm}-${dd}`)
      setScheduledTime(`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`)
    } else {
      setScheduledDate('')
      setScheduledTime('')
    }
  }, [appointment, zone])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const [y, m, day] = scheduledDate.split('-').map(Number)
    const [hour, min] = scheduledTime.split(':').map(Number)
    const scheduled_at = fromZonedWallClock(y, m, day, hour, min, zone).toISOString()
    onSubmit(appointment.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      scheduled_at,
      duration_minutes,
      status,
      type,
      meeting_link: meeting_link.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-amber-100/90 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-2">
        Date and time are in the trader&apos;s / appointment wall-clock timezone: {wallClockHint}
      </p>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Title *</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required className="border-slate-600 bg-slate-700 text-white" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Date *</label>
          <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required className="border-slate-600 bg-slate-700 text-white" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Time *</label>
          <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} required className="border-slate-600 bg-slate-700 text-white" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Duration</label>
          <Select value={String(duration_minutes)} onValueChange={(v) => setDurationMinutes(Number(v))}>
            <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Status</label>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled'] as const).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Type</label>
        <Select value={type} onValueChange={(v) => setType(v as AppointmentType)}>
          <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Meeting link</label>
        <Input value={meeting_link} onChange={(e) => setMeetingLink(e.target.value)} type="url" className="border-slate-600 bg-slate-700 text-white" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Location</label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} className="border-slate-600 bg-slate-700 text-white" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Internal notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('edit-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">Cancel</Button>
        <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">Save changes</Button>
      </div>
    </form>
  )
}
