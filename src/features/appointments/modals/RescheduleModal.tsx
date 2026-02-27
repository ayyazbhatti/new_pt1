import { useState } from 'react'
import type { Appointment, RescheduleAppointmentRequest } from '../types'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useModalStore } from '@/app/store'

interface RescheduleModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: RescheduleAppointmentRequest) => void
  submitting?: boolean
}

export function RescheduleModal({ appointment, onSubmit, submitting = false }: RescheduleModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const d = new Date(appointment.scheduled_at)
  const [scheduledDate, setScheduledDate] = useState(d.toISOString().slice(0, 10))
  const [scheduledTime, setScheduledTime] = useState(
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  )
  const [reason, setReason] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const [y, m, day] = scheduledDate.split('-').map(Number)
    const [hour, min] = scheduledTime.split(':').map(Number)
    const scheduled_at = new Date(y, m - 1, day, hour, min, 0).toISOString()
    onSubmit(appointment.id, { scheduled_at, reason: reason.trim() || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">New date *</label>
          <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required className="border-slate-600 bg-slate-700 text-white" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">New time *</label>
          <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} required className="border-slate-600 bg-slate-700 text-white" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Reason (optional)</label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reschedule" className="border-slate-600 bg-slate-700 text-white" />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('reschedule-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">Cancel</Button>
        <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">{submitting ? 'Rescheduling...' : 'Reschedule'}</Button>
      </div>
    </form>
  )
}
