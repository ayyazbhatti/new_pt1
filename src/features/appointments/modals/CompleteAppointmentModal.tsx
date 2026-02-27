import { useState } from 'react'
import type { Appointment, CompleteAppointmentRequest } from '../types'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'

interface CompleteAppointmentModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: CompleteAppointmentRequest) => void
  submitting?: boolean
}

export function CompleteAppointmentModal({ appointment, onSubmit, submitting = false }: CompleteAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const [completion_notes, setCompletionNotes] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(appointment.id, { completion_notes: completion_notes.trim() || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Completion notes (optional)</label>
        <textarea
          value={completion_notes}
          onChange={(e) => setCompletionNotes(e.target.value)}
          rows={3}
          placeholder="Notes about how the appointment went..."
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('complete-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">Back</Button>
        <Button type="submit" disabled={submitting} className="bg-green-600 hover:bg-green-700">{submitting ? 'Completing...' : 'Mark complete'}</Button>
      </div>
    </form>
  )
}
