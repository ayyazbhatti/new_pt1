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

const TYPES: AppointmentType[] = ['consultation', 'support', 'onboarding', 'review', 'other']
const DURATIONS = [15, 30, 45, 60]

interface EditAppointmentModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: UpdateAppointmentRequest) => void
  submitting?: boolean
}

export function EditAppointmentModal({ appointment, onSubmit, submitting = false }: EditAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
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
    const d = new Date(appointment.scheduled_at)
    setScheduledDate(d.toISOString().slice(0, 10))
    setScheduledTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  }, [appointment])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const [y, m, day] = scheduledDate.split('-').map(Number)
    const [hour, min] = scheduledTime.split(':').map(Number)
    const scheduled_at = new Date(y, m - 1, day, hour, min, 0).toISOString()
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
