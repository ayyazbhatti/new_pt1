import { useState, useEffect } from 'react'
import type { Appointment, SendReminderRequest, ReminderType } from '../types'
import { Button } from '@/shared/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { formatDateTime } from '../utils/format'

const REMINDER_TYPES: ReminderType[] = ['24h', '2h', '1h', '15m', 'custom']

interface SendReminderModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: SendReminderRequest) => void
  submitting?: boolean
}

export function SendReminderModal({ appointment, onSubmit, submitting = false }: SendReminderModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const [reminder_type, setReminderType] = useState<ReminderType>('24h')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setSubject(`Reminder: ${appointment.title} on ${formatDateTime(appointment.scheduled_at)}`)
    setMessage(
      `Hi${appointment.user_name ? ` ${appointment.user_name}` : ''},\n\nThis is a reminder for your appointment "${appointment.title}" scheduled for ${formatDateTime(appointment.scheduled_at)} (${appointment.duration_minutes} min).\n\n${appointment.meeting_link ? `Join here: ${appointment.meeting_link}\n\n` : ''}Best regards`
    )
  }, [appointment])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(appointment.id, { reminder_type, subject, message })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Reminder type</label>
        <Select value={reminder_type} onValueChange={(v) => setReminderType(v as ReminderType)}>
          <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REMINDER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={6}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('reminder-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">Cancel</Button>
        <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">{submitting ? 'Sending...' : 'Send reminder'}</Button>
      </div>
    </form>
  )
}
